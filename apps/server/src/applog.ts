import { redis } from "./redis";

// Log lines the desktop app uploads, so we can see what went wrong on someone's machine.
export const LOG_STREAM = "applog";
const KEEP = 50_000;
export const MAX_LINES = 50;
export const MAX_LINE = 1000;

export type AppLogLine = { ts: number; level: string; target: string; msg: string };

export async function storeLogs(
  meta: { user_id: string; name: string; version: string; os: string },
  lines: AppLogLine[],
) {
  for (const l of lines) {
    const fields = Object.entries({ ...meta, ts: String(l.ts), level: l.level, target: l.target, msg: l.msg }).flat();
    await redis.send("XADD", [LOG_STREAM, "MAXLEN", "~", String(KEEP), "*", ...fields]);
  }
}

export type StoredLog = Record<string, string> & { id: string };

// Newest last. userId filters to one user.
export async function readLogs(count: number, userId?: string): Promise<StoredLog[]> {
  const out: StoredLog[] = [];
  let end = "+";
  while (out.length < count) {
    const batch = (await redis.send("XREVRANGE", [LOG_STREAM, end, "-", "COUNT", "1000"])) as [string, string[]][];
    if (!batch?.length) break;
    for (const [id, fields] of batch) {
      const entry: StoredLog = { id };
      for (let i = 0; i < fields.length; i += 2) entry[fields[i]] = fields[i + 1];
      if (!userId || entry.user_id === userId) out.push(entry);
      if (out.length >= count) break;
    }
    if (batch.length < 1000) break;
    end = `(${batch[batch.length - 1][0]}`;
  }
  return out.reverse();
}
