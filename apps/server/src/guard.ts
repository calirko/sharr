import type { Context, MiddlewareHandler } from "hono";
import { redis } from "./redis";

// The server sits behind a Cloudflare tunnel, which sets cf-connecting-ip
export function clientIp(c: Context) {
  return c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

// Fixed window counter in Redis. Returns the count including this hit.
export async function hit(bucket: string, windowSec: number) {
  const key = `rl:${bucket}`;
  const n = Number(await redis.send("INCR", [key]));
  await redis.send("EXPIRE", [key, String(windowSec), "NX"]);
  return n;
}

export async function count(bucket: string) {
  return Number((await redis.send("GET", [`rl:${bucket}`])) ?? 0);
}

// Per client IP limit for a route
export function limitByIp(name: string, max: number, windowSec: number): MiddlewareHandler {
  return async (c, next) => {
    if ((await hit(`${name}:${clientIp(c)}`, windowSec)) > max) return c.json({ error: "rate_limited" }, 429);
    await next();
  };
}

// Rejects state changing requests that come from another origin
export const sameOrigin: MiddlewareHandler = async (c, next) => {
  const method = c.req.method;
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    const origin = c.req.header("origin");
    if (origin) {
      let host = "";
      try {
        host = new URL(origin).host;
      } catch {}
      const allowed = [c.req.header("x-forwarded-host"), c.req.header("host")];
      if (!allowed.includes(host)) return c.json({ error: "forbidden" }, 403);
    }
  }
  await next();
};

// Room ids are random base64url, never anything with a colon
export const ROOM_ID = /^[A-Za-z0-9_-]{1,32}$/;

// Drops control, bidi and zero width characters so names can't be spoofed or hidden
export function cleanName(name: string) {
  return name
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}
