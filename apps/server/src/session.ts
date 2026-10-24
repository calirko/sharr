import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import { config } from "./config";
import { randomId, redis } from "./redis";

export type Session = {
  sid: string;
  user_id: string;
  kind: "guest";
  nickname: string;
  created_at: string;
};

export type SessionEnv = { Variables: { session: Session | null } };

const COOKIE = "sid";
const TTL_SECONDS = 60 * 60 * 24 * 30;

const key = (sid: string) => `session:${sid}`;

export const sessionMiddleware: MiddlewareHandler<SessionEnv> = async (c, next) => {
  c.set("session", null);
  const sid = await getSignedCookie(c, config.sessionSecret, COOKIE);
  if (sid) {
    const data = await redis.hgetall(key(sid));
    if (data.user_id) {
      await redis.expire(key(sid), TTL_SECONDS);
      c.set("session", { sid, ...data } as Session);
    }
  }
  await next();
};

export const requireSession: MiddlewareHandler<SessionEnv> = async (c, next) => {
  if (!c.get("session")) return c.json({ error: "not_logged_in" }, 401);
  await next();
};

export async function createGuestSession(c: Context, nickname: string): Promise<Session> {
  const session: Session = {
    sid: randomId(24),
    user_id: `g_${randomId(9)}`,
    kind: "guest",
    nickname,
    created_at: String(Date.now()),
  };
  const { sid, ...data } = session;
  await redis.hset(key(sid), data);
  await redis.expire(key(sid), TTL_SECONDS);
  await setSignedCookie(c, COOKIE, sid, config.sessionSecret, {
    httpOnly: true,
    secure: config.production,
    sameSite: "Lax",
    path: "/",
    maxAge: TTL_SECONDS,
  });
  return session;
}

export async function destroySession(c: Context, session: Session) {
  await redis.del(key(session.sid));
  deleteCookie(c, COOKIE, { path: "/" });
}

export function publicUser(session: Session) {
  return { user_id: session.user_id, kind: session.kind, nickname: session.nickname };
}
