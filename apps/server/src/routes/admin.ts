import { Hono } from "hono";
import { TrackSource, type ParticipantInfo } from "livekit-server-sdk";
import { listParticipantsSafe, roomService } from "../livekit";
import { listRooms, publicRoom, removeRoom } from "../rooms";
import { requireAdmin, type SessionEnv } from "../session";
import { avatarUrl, getUser, isAdmin, listUsers } from "../users";

function publicParticipant(p: ParticipantInfo) {
  return {
    identity: p.identity,
    name: p.name,
    kind: p.identity.startsWith("d_") ? "discord" : "guest",
    discord_username: p.attributes.discord_username ?? "",
    avatar_url: p.attributes.avatar_url ?? "",
    sharing: p.tracks.some((t) => t.source === TrackSource.SCREEN_SHARE),
    joined_at: Number(p.joinedAt) * 1000,
  };
}

export const adminRoutes = new Hono<SessionEnv>()
  .use(requireAdmin)
  // Our rooms plus anything LiveKit has that we don't know about
  .get("/rooms", async (c) => {
    const [rooms, live] = await Promise.all([listRooms(), roomService.listRooms().catch(() => [])]);
    const known = new Set(rooms.map((r) => r.id));
    const ids = [...rooms.map((r) => r.id).reverse(), ...live.map((r) => r.name).filter((id) => !known.has(id))];
    const participants = new Map(
      await Promise.all(ids.map(async (id) => [id, (await listParticipantsSafe(id)).map(publicParticipant)] as const)),
    );
    const creators = new Map(
      await Promise.all(
        [...new Set(rooms.map((r) => r.creator_id))].map(async (id) => [id, await getUser(id)] as const),
      ),
    );
    return c.json({
      rooms: ids.map((id) => {
        const room = rooms.find((r) => r.id === id);
        const people = participants.get(id) ?? [];
        if (!room) return { id, known: false, participants: people };
        const creator = creators.get(room.creator_id);
        return {
          ...publicRoom(room, people.length),
          known: true,
          last_active_at: Number(room.last_active_at),
          creator_name: creator ? creator.nickname : "",
          creator_discord_username: creator?.discord_username ?? "",
          participants: people,
        };
      }),
    });
  })
  .delete("/rooms/:id", async (c) => {
    const id = c.req.param("id");
    await roomService.deleteRoom(id).catch(() => {});
    await removeRoom(id);
    return c.json({ ok: true });
  })
  .delete("/rooms/:id/participants/:identity", async (c) => {
    try {
      await roomService.removeParticipant(c.req.param("id"), c.req.param("identity"));
    } catch {
      return c.json({ error: "not_found" }, 404);
    }
    return c.json({ ok: true });
  })
  .get("/users", async (c) => {
    const users = await listUsers();
    return c.json({
      users: users.map((u) => ({
        user_id: u.user_id,
        discord_id: u.discord_id,
        discord_username: u.discord_username,
        nickname: u.nickname,
        avatar_url: avatarUrl(u),
        is_admin: isAdmin(u),
        created_at: Number(u.created_at),
      })),
    });
  });
