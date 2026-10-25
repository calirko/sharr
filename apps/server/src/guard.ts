import type { Context, MiddlewareHandler } from "hono";
import { config } from "./config";
import { redis } from "./redis";
import type { SessionEnv } from "./session";

// The server sits behind a Cloudflare tunnel, which sets cf-connecting-ip.
// x-forwarded-for can be set by anyone, so it is only used in dev.
// IPv6 is cut to its /64, since one host usually gets a whole /64 to rotate through.
export function clientIp(c: Context) {
  const raw = c.req.header("cf-connecting-ip") ?? (config.production ? undefined : c.req.header("x-forwarded-for")?.split(",")[0]);
  const ip = raw?.trim().toLowerCase();
  if (!ip) return "unknown";
  if (!ip.includes(":")) return ip;
  // IPv4 mapped, like ::ffff:1.2.3.4
  if (ip.includes(".")) return ip.slice(ip.lastIndexOf(":") + 1);
  return v6Prefix(ip);
}

function v6Prefix(ip: string) {
  const [head = "", tail = ""] = ip.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = ip.includes("::") ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right] : left;
  return `${groups
    .slice(0, 4)
    .map((g) => (parseInt(g, 16) || 0).toString(16))
    .join(":")}::/64`;
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

// Per user limit, for routes that need a session
export function limitByUser(name: string, max: number, windowSec: number): MiddlewareHandler<SessionEnv> {
  return async (c, next) => {
    const session = c.get("session");
    if (session && (await hit(`${name}:${session.user_id}`, windowSec)) > max) return c.json({ error: "rate_limited" }, 429);
    await next();
  };
}

// Cap across all clients, so a flood from many addresses can't fill Redis
export function limitGlobal(name: string, max: number, windowSec: number): MiddlewareHandler {
  return async (c, next) => {
    if ((await hit(name, windowSec)) > max) return c.json({ error: "busy" }, 503);
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
