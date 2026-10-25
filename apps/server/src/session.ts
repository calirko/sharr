import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import { config } from "./config";
import { randomId, redis } from "./redis";
import { avatarUrl, getUser, setUserNickname, type User } from "./users";

export type Session = {
  sid: string;
  user_id: string;
  kind: "guest" | "discord";
  nickname: string;
  created_at: string;
  // Discord sessions only, loaded from the user record on every request
  user?: User;
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
      const session = { sid, ...data } as Session;
      if (session.kind === "discord") {
        const user = await getUser(session.user_id);
        if (user) {
          session.user = user;
          session.nickname = user.nickname;
        }
      }
      if (session.kind !== "discord" || session.user) {
        await redis.expire(key(sid), TTL_SECONDS);
        c.set("session", session);
      }
    }
  }
  await next();
};

export const requireSession: MiddlewareHandler<SessionEnv> = async (c, next) => {
  if (!c.get("session")) return c.json({ error: "not_logged_in" }, 401);
  await next();
};

async function createSession(c: Context, fields: Omit<Session, "sid" | "created_at">): Promise<Session> {
  const session: Session = { sid: randomId(24), ...fields, created_at: String(Date.now()) };
  const { sid, user, ...data } = session;
  // Discord nicknames live on the user record
  await redis.hset(key(sid), user ? { ...data, nickname: "" } : data);
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

export function createGuestSession(c: Context, nickname: string) {
  return createSession(c, { user_id: `g_${randomId(9)}`, kind: "guest", nickname });
}

export function createDiscordSession(c: Context, user: User) {
  return createSession(c, { user_id: user.user_id, kind: "discord", nickname: user.nickname, user });
}

export async function setNickname(session: Session, nickname: string) {
  if (session.user) {
    await setUserNickname(session.user_id, nickname);
    session.user.nickname = nickname;
  } else {
    await redis.hset(key(session.sid), { nickname });
  }
  session.nickname = nickname;
}

export async function destroySession(c: Context, session: Session) {
  await redis.del(key(session.sid));
  deleteCookie(c, COOKIE, { path: "/" });
}

// Drops the old session without touching the cookie, for when a new one replaces it
export async function dropSession(session: Session) {
  await redis.del(key(session.sid));
}

export function publicUser(session: Session) {
  const u = session.user;
  return {
    user_id: session.user_id,
    kind: session.kind,
    nickname: session.nickname,
    discord_username: u?.discord_username ?? "",
    avatar_url: u ? avatarUrl(u) : "",
  };
}
