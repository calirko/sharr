import { zValidator } from "@hono/zod-validator";
import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { allowMessage, logMessage, MAX_LENGTH } from "../chatlog";
import { config } from "../config";
import { cleanName, clientIp, count, hit, limitByIp, ROOM_ID } from "../guard";
import { listParticipantsSafe, mintToken, permissionFor, roomService } from "../livekit";
import {
  banFromRoom,
  canShare,
  checkPin,
  claimName,
  createRoom,
  getRoom,
  isBanned,
  listRooms,
  publicRoom,
  removeRoom,
  updateRoom,
} from "../rooms";
import { publicUser, requireSession, type SessionEnv } from "../session";

const shareMode = z.enum(["creator", "everyone"]);

// Live rooms one user can own. Guests get fewer to limit abuse.
const MAX_ROOMS = { guest: 2, discord: 10 };

// Wrong PIN guesses allowed per room and client, and per room overall
const PIN_TRIES_IP = { max: 5, windowSec: 600 };
const PIN_TRIES_ROOM = { max: 30, windowSec: 3600 };

const validId: MiddlewareHandler = async (c, next) => {
  if (!ROOM_ID.test(c.req.param("id") ?? "")) return c.json({ error: "not_found" }, 404);
  await next();
};

export const roomRoutes = new Hono<SessionEnv>()
  .use(requireSession)
  .use("/:id/*", validId)
  .use("/:id", validId)
  // Only your own rooms. Other rooms are reached by link.
  .get("/", async (c) => {
    const userId = c.get("session")!.user_id;
    const rooms = (await listRooms()).filter((r) => r.creator_id === userId);
    if (rooms.length === 0) return c.json({ rooms: [] });
    const live = await roomService.listRooms(rooms.map((r) => r.id)).catch(() => []);
    const counts = new Map(live.map((r) => [r.name, r.numParticipants]));
    return c.json({ rooms: rooms.map((r) => publicRoom(r, counts.get(r.id) ?? 0)) });
  })
  .post(
    "/",
    limitByIp("room_create", 10, 3600),
    zValidator(
      "json",
      z.object({
        name: z.string().max(96).transform(cleanName).pipe(z.string().min(1).max(48)),
        pin: z.string().regex(/^\d{4,12}$/).optional(),
        share_mode: shareMode.default("creator"),
      }),
    ),
    async (c) => {
      const body = c.req.valid("json");
      const session = c.get("session")!;
      const owned = (await listRooms()).filter((r) => r.creator_id === session.user_id).length;
      if (owned >= MAX_ROOMS[session.kind]) return c.json({ error: "too_many_rooms" }, 429);
      const room = await createRoom({ ...body, creator_id: session.user_id });
      return c.json({ room: publicRoom(room) }, 201);
    },
  )
  .get("/:id", async (c) => {
    const room = await getRoom(c.req.param("id"));
    if (!room) return c.json({ error: "not_found" }, 404);
    const participants = await listParticipantsSafe(room.id);
    return c.json({ room: publicRoom(room, participants.length) });
  })
  .patch("/:id", zValidator("json", z.object({ share_mode: shareMode })), async (c) => {
    const room = await getRoom(c.req.param("id"));
    if (!room) return c.json({ error: "not_found" }, 404);
    if (room.creator_id !== c.get("session")!.user_id) return c.json({ error: "forbidden" }, 403);

    const { share_mode } = c.req.valid("json");
    await updateRoom(room.id, { share_mode });
    room.share_mode = share_mode;

    // Apply to people already in the room so the change is enforced now, not on next join
    const participants = await listParticipantsSafe(room.id);
    await Promise.all(
      participants.map((p) =>
        roomService
          .updateParticipant(room.id, p.identity, { permission: permissionFor(canShare(room, p.identity)) })
          .catch((err) => console.error(`permission update failed for ${p.identity}:`, err)),
      ),
    );
    return c.json({ room: publicRoom(room, participants.length) });
  })
  .delete("/:id", async (c) => {
    const room = await getRoom(c.req.param("id"));
    if (!room) return c.json({ error: "not_found" }, 404);
    if (room.creator_id !== c.get("session")!.user_id) return c.json({ error: "forbidden" }, 403);
    await roomService.deleteRoom(room.id).catch(() => {});
    await removeRoom(room.id);
    return c.json({ ok: true });
  })
  // Creator only. The person can't join again until the room closes.
  .delete("/:id/participants/:identity", async (c) => {
    const room = await getRoom(c.req.param("id"));
    if (!room) return c.json({ error: "not_found" }, 404);
    const identity = c.req.param("identity");
    if (room.creator_id !== c.get("session")!.user_id || identity === room.creator_id) {
      return c.json({ error: "forbidden" }, 403);
    }
    await banFromRoom(room.id, identity);
    try {
      await roomService.removeParticipant(room.id, identity);
    } catch {
      return c.json({ error: "not_found" }, 404);
    }
    return c.json({ ok: true });
  })
  .post("/:id/join", limitByIp("join", 60, 60), zValidator("json", z.object({ pin: z.string().max(12).optional() })), async (c) => {
    const session = c.get("session")!;
    const room = await getRoom(c.req.param("id"));
    if (!room) return c.json({ error: "not_found" }, 404);
    const isCreator = room.creator_id === session.user_id;
    if (!isCreator && (await isBanned(room.id, session.user_id))) return c.json({ error: "kicked" }, 403);
    if (!isCreator && room.pin_hash) {
      const ipBucket = `pin:${room.id}:${clientIp(c)}`;
      const roomBucket = `pin:${room.id}`;
      if ((await count(ipBucket)) >= PIN_TRIES_IP.max || (await count(roomBucket)) >= PIN_TRIES_ROOM.max) {
        return c.json({ error: "too_many_attempts" }, 429);
      }
      if (!(await checkPin(room, c.req.valid("json").pin))) {
        await hit(ipBucket, PIN_TRIES_IP.windowSec);
        await hit(roomBucket, PIN_TRIES_ROOM.windowSec);
        return c.json({ error: "bad_pin" }, 403);
      }
    }

    const participants = await listParticipantsSafe(room.id);
    const liveNames = participants.filter((p) => p.identity !== session.user_id).map((p) => p.name);
    const name = await claimName(room.id, session.user_id, session.nickname, liveNames);
    const share = canShare(room, session.user_id);

    await updateRoom(room.id, { last_active_at: String(Date.now()) });
    const { discord_username, avatar_url } = publicUser(session);
    const token = await mintToken({
      room: room.id,
      identity: session.user_id,
      name,
      canShare: share,
      attributes: { discord_username, avatar_url },
    });
    return c.json({ url: config.livekit.url, token, name, can_share: share, is_creator: isCreator });
  })
  // Chat backlog, Discord users only. Must be in the room on LiveKit.
  .post("/:id/messages", zValidator("json", z.object({ text: z.string().trim().min(1).max(MAX_LENGTH) })), async (c) => {
    const session = c.get("session")!;
    if (!session.user) return c.json({ ok: true });
    const room = await getRoom(c.req.param("id"));
    if (!room) return c.json({ error: "not_found" }, 404);
    const me = (await listParticipantsSafe(room.id)).find((p) => p.identity === session.user_id);
    if (!me) return c.json({ error: "forbidden" }, 403);
    if (!allowMessage(session.user_id)) return c.json({ error: "rate_limited" }, 429);
    await logMessage({
      room_id: room.id,
      room_name: room.name,
      user_id: session.user_id,
      discord_id: session.user.discord_id,
      name: me.name,
      text: c.req.valid("json").text,
    });
    return c.json({ ok: true });
  });
