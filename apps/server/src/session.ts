import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import { config } from "./config";
import { randomId, redis } from "./redis";
import { avatarUrl, getUser, isAdmin, setUserNickname, type User } from "./users";

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

// __Host- stops sibling subdomains from planting a cookie. It needs Secure, so prod only.
const COOKIE = config.production ? "__Host-sid" : "sid";
const DISCORD_TTL = 60 * 60 * 24 * 30;
// Guests are temporary, so their sessions don't pile up in Redis
const GUEST_TTL = 60 * 60 * 24;
const ttlFor = (kind: Session["kind"]) => (kind === "discord" ? DISCORD_TTL : GUEST_TTL);

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
        await redis.expire(key(sid), ttlFor(session.kind));
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

// Checked on every request. The flag is read fresh from the user record.
export const requireAdmin: MiddlewareHandler<SessionEnv> = async (c, next) => {
  const session = c.get("session");
  if (!session) return c.json({ error: "not_logged_in" }, 401);
  if (!isAdmin(session.user)) return c.json({ error: "not_found" }, 404);
  await next();
};

async function createSession(c: Context, fields: Omit<Session, "sid" | "created_at">): Promise<Session> {
  const session: Session = { sid: randomId(24), ...fields, created_at: String(Date.now()) };
  const { sid, user, ...data } = session;
  // Discord nicknames live on the user record
  await redis.hset(key(sid), user ? { ...data, nickname: "" } : data);
  await redis.expire(key(sid), ttlFor(session.kind));
  await setSignedCookie(c, COOKIE, sid, config.sessionSecret, {
    httpOnly: true,
    secure: config.production,
    sameSite: "Lax",
    path: "/",
    maxAge: ttlFor(session.kind),
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
    is_admin: isAdmin(u),
  };
}
