import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { config } from "../config";
import { listParticipantsSafe, mintToken, permissionFor, roomService } from "../livekit";
import {
  canShare,
  checkPin,
  claimName,
  createRoom,
  getRoom,
  listRooms,
  publicRoom,
  removeRoom,
  updateRoom,
} from "../rooms";
import { requireSession, type SessionEnv } from "../session";

const shareMode = z.enum(["creator", "everyone"]);

export const roomRoutes = new Hono<SessionEnv>()
  .use(requireSession)
  .get("/", async (c) => {
    const rooms = await listRooms();
    const live = await roomService.listRooms(rooms.map((r) => r.id)).catch(() => []);
    const counts = new Map(live.map((r) => [r.name, r.numParticipants]));
    return c.json({ rooms: rooms.map((r) => publicRoom(r, counts.get(r.id) ?? 0)) });
  })
  .post(
    "/",
    zValidator(
      "json",
      z.object({
        name: z.string().trim().min(1).max(48),
        pin: z.string().regex(/^\d{4,12}$/).optional(),
        share_mode: shareMode.default("creator"),
      }),
    ),
    async (c) => {
      const body = c.req.valid("json");
      const room = await createRoom({ ...body, creator_id: c.get("session")!.user_id });
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
  .post("/:id/join", zValidator("json", z.object({ pin: z.string().optional() })), async (c) => {
    const session = c.get("session")!;
    const room = await getRoom(c.req.param("id"));
    if (!room) return c.json({ error: "not_found" }, 404);
    if (!(await checkPin(room, c.req.valid("json").pin))) return c.json({ error: "bad_pin" }, 403);

    const participants = await listParticipantsSafe(room.id);
    const liveNames = participants.filter((p) => p.identity !== session.user_id).map((p) => p.name);
    const name = await claimName(room.id, session.user_id, session.nickname, liveNames);
    const share = canShare(room, session.user_id);

    await updateRoom(room.id, { last_active_at: String(Date.now()) });
    const token = await mintToken({ room: room.id, identity: session.user_id, name, canShare: share });
    return c.json({ url: config.livekit.url, token, name, can_share: share, is_creator: room.creator_id === session.user_id });
  });
