import { redis } from "./redis";

// Backlog of messages from Discord users, for debugging and usage history.
// Guests are never stored. Clients report their own messages, since chat
// never passes through this server.
const STREAM = "chat";
const KEEP = 100_000;
export const MAX_LENGTH = 1000;
const RATE_MAX = 5;
const RATE_WINDOW_MS = 10_000;

const hits = new Map<string, number[]>();

// Same limit every client applies to what it receives
export function allowMessage(userId: string) {
  const now = Date.now();
  const recent = (hits.get(userId) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  const ok = recent.length < RATE_MAX;
  if (ok) recent.push(now);
  if (recent.length) hits.set(userId, recent);
  else hits.delete(userId);
  return ok;
}

export async function logMessage(entry: {
  room_id: string;
  room_name: string;
  user_id: string;
  discord_id: string;
  name: string;
  text: string;
}) {
  const fields = Object.entries(entry).flat();
  await redis.send("XADD", [STREAM, "MAXLEN", "~", String(KEEP), "*", ...fields]);
}
