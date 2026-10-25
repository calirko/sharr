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
// Activity keeps a session alive, but never past this, so a stolen cookie stops working eventually
const MAX_AGE_MS = { guest: 7 * 24 * 3600 * 1000, discord: 90 * 24 * 3600 * 1000 };
// Each login makes a new session. Past this many, the oldest are logged out.
const MAX_DISCORD_SESSIONS = 10;

const key = (sid: string) => `session:${sid}`;
// Zset of a Discord user's session ids, scored by creation time
const userSessionsKey = (userId: string) => `sessions:${userId}`;

export const sessionMiddleware: MiddlewareHandler<SessionEnv> = async (c, next) => {
  c.set("session", null);
  const sid = await getSignedCookie(c, config.sessionSecret, COOKIE);
  if (sid) {
    const session = await loadSession(sid);
    if (session) c.set("session", session);
    // Gone or expired, so the browser can stop sending it
    else deleteCookie(c, COOKIE, { path: "/" });
  }
  await next();
};

async function loadSession(sid: string): Promise<Session | null> {
  const data = await redis.hgetall(key(sid));
  if (!data.user_id) return null;
  const session = { sid, ...data } as Session;
  const kind = session.kind === "discord" ? "discord" : "guest";
  if (!(Date.now() - Number(session.created_at) < MAX_AGE_MS[kind])) {
    await dropSession(session);
    return null;
  }
  if (kind === "discord") {
    const user = await getUser(session.user_id);
    if (!user) {
      await dropSession(session);
      return null;
    }
    session.user = user;
    session.nickname = user.nickname;
  }
  await redis.expire(key(sid), ttlFor(kind));
  return session;
}

// Keeps a Discord user's session list short and drops the oldest past the cap
async function trackDiscordSession(userId: string, sid: string, createdAt: number) {
  const list = userSessionsKey(userId);
  await redis.send("ZADD", [list, String(createdAt), sid]);
  await redis.send("ZREMRANGEBYSCORE", [list, "-inf", String(createdAt - MAX_AGE_MS.discord)]);
  const extra = (await redis.send("ZRANGE", [list, "0", String(-MAX_DISCORD_SESSIONS - 1)])) as string[];
  if (extra.length) {
    await redis.del(...extra.map(key));
    await redis.send("ZREM", [list, ...extra]);
  }
  await redis.expire(list, DISCORD_TTL);
}

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
  if (session.kind === "discord") await trackDiscordSession(session.user_id, sid, Number(session.created_at));
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
  await dropSession(session);
  deleteCookie(c, COOKIE, { path: "/" });
}

// Drops the old session without touching the cookie, for when a new one replaces it
export async function dropSession(session: Pick<Session, "sid" | "user_id" | "kind">) {
  await redis.del(key(session.sid));
  if (session.kind === "discord") await redis.send("ZREM", [userSessionsKey(session.user_id), session.sid]);
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
