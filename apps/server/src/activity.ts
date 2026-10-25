import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { upgradeWebSocket } from "hono/bun";
import { z } from "zod";
import { config } from "./config";
import { count, hit, ROOM_ID } from "./guard";
import { redis } from "./redis";
import { checkPin, getRoom } from "./rooms";

// Discord Activity test: the calico bot links a Discord channel to a room, and the Activity
// in that channel watches the room through sharr-relay (apps/relay). Discord blocks WebRTC
// in Activities, so the relay sends encoded frames over a websocket instead.

const LINK_TTL_SEC = 12 * 60 * 60;
const CHANNEL_ID = /^\d{1,32}$/;
const linkKey = (channelId: string) => `activity:${channelId}`;
const PIN_TRIES = { max: 30, windowSec: 3600 };

async function linkedRoom(channelId: string) {
  if (!CHANNEL_ID.test(channelId)) return null;
  const roomId = await redis.get(linkKey(channelId));
  return roomId ? getRoom(roomId) : null;
}

// Served on its own port, which only containers on the Docker networks can reach (not the tunnel)
export const internalApp = new Hono().post(
  "/activity",
  zValidator(
    "json",
    z.object({
      channel_id: z.string().regex(CHANNEL_ID),
      room_id: z.string().regex(ROOM_ID),
      pin: z.string().max(12).optional(),
    }),
  ),
  async (c) => {
    const { channel_id, room_id, pin } = c.req.valid("json");
    const room = await getRoom(room_id);
    if (!room) return c.json({ error: "not_found" }, 404);
    if (room.pin_hash) {
      const bucket = `pin:${room.id}`;
      if ((await count(bucket)) >= PIN_TRIES.max) return c.json({ error: "too_many_attempts" }, 429);
      if (!(await checkPin(room, pin))) {
        await hit(bucket, PIN_TRIES.windowSec);
        return c.json({ error: "bad_pin" }, 403);
      }
    }
    await redis.send("SET", [linkKey(channel_id), room.id, "EX", String(LINK_TTL_SEC)]);
    return c.json({ room: { id: room.id, name: room.name } });
  },
);

export const activityRoutes = new Hono()
  // Activities can only load from our own origin (through Discord's proxy), so Discord avatars come through here
  .get("/avatars/:discord_id/:hash", async (c) => {
    const { discord_id, hash } = c.req.param();
    if (!/^\d{1,20}$/.test(discord_id) || !/^(a_)?[0-9a-f]{32}$/.test(hash)) return c.json({ error: "not_found" }, 404);
    const res = await fetch(`https://cdn.discordapp.com/avatars/${discord_id}/${hash}.png?size=128`, {
      signal: AbortSignal.timeout(5000),
    }).catch(() => null);
    if (!res?.ok) return c.json({ error: "not_found" }, 404);
    return c.body(await res.arrayBuffer(), 200, {
      "content-type": "image/png",
      "cache-control": "public, max-age=86400",
    });
  })
  .get("/:channel", async (c) => {
    const room = await linkedRoom(c.req.param("channel"));
    if (!room) return c.json({ error: "not_found" }, 404);
    return c.json({ room: { id: room.id, name: room.name } });
  })
  .get(
    "/:channel/stream",
    async (c, next) => {
      if (!(await linkedRoom(c.req.param("channel")))) return c.json({ error: "not_found" }, 404);
      await next();
    },
    // Passes everything through to the relay, both ways
    upgradeWebSocket(async (c) => {
      const room = await linkedRoom(c.req.param("channel") ?? "");
      let upstream: WebSocket | undefined;
      return {
        onOpen: (_, ws) => {
          upstream = new WebSocket(`${config.relayUrl}/stream?room=${encodeURIComponent(room!.id)}`);
          upstream.binaryType = "arraybuffer";
          upstream.onmessage = (e) => ws.send(e.data);
          upstream.onclose = () => ws.close();
        },
        // Viewers only ask for a keyframe or pick a share
        onMessage: (e) => {
          if (upstream?.readyState !== WebSocket.OPEN || typeof e.data !== "string") return;
          if (e.data === "key" || /^select:\d{1,5}$/.test(e.data)) upstream.send(e.data);
        },
        onClose: () => upstream?.close(),
      };
    }),
  );
