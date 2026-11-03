import { STREAM } from "./chatlog";
import { listParticipantsSafe, roomService } from "./livekit";
import { redis } from "./redis";
import { listRooms, removeRoom } from "./rooms";
import { dropAllUserSessions } from "./session";

const BATCH = 1000;

// Removes everything we keep about a Discord user
export async function deleteAccount(userId: string) {
  await dropAllUserSessions(userId);
  await redis.del(`sessions:${userId}`, `user:${userId}`);

  // Their rooms close, like when they delete one by hand
  for (const room of await listRooms()) {
    if (room.creator_id !== userId) continue;
    await roomService.deleteRoom(room.id).catch(() => {});
    await removeRoom(room.id);
  }

  // And they leave any other room they're still in
  const live = await roomService.listRooms().catch(() => []);
  for (const room of live) {
    const people = await listParticipantsSafe(room.name);
    if (people.some((p) => p.identity === userId)) {
      await roomService.removeParticipant(room.name, userId).catch(() => {});
    }
  }

  await purgeChat(userId);
}

async function purgeChat(userId: string) {
  let start = "-";
  for (;;) {
    const entries = (await redis.send("XRANGE", [STREAM, start, "+", "COUNT", String(BATCH)])) as [string, string[]][];
    if (!entries?.length) return;
    const mine = entries.filter(([, fields]) => fieldOf(fields, "user_id") === userId).map(([id]) => id);
    if (mine.length) await redis.send("XDEL", [STREAM, ...mine]);
    if (entries.length < BATCH) return;
    start = `(${entries[entries.length - 1][0]}`;
  }
}

function fieldOf(fields: string[], name: string) {
  for (let i = 0; i < fields.length; i += 2) if (fields[i] === name) return fields[i + 1];
  return undefined;
}
