import { cleanName } from "./guard";
import { redis } from "./redis";

// Only Discord users get a record. Guests live in their session alone.
export type User = {
  user_id: string;
  discord_id: string;
  discord_username: string;
  // Discord avatar hash, empty when they have none
  avatar: string;
  nickname: string;
  is_admin: string;
  created_at: string;
};

const key = (id: string) => `user:${id}`;

export async function getUser(id: string): Promise<User | null> {
  const data = await redis.hgetall(key(id));
  return data.discord_id ? ({ user_id: id, ...data } as User) : null;
}

// Keeps the nickname they picked here, refreshes the rest from Discord
export async function upsertDiscordUser(profile: { id: string; username: string; global_name: string | null; avatar: string | null }) {
  const id = `d_${profile.id}`;
  const fields = { discord_id: profile.id, discord_username: profile.username, avatar: profile.avatar ?? "" };
  const existing = await getUser(id);
  if (existing) {
    await redis.hset(key(id), fields);
    return { ...existing, ...fields };
  }
  const user: User = {
    user_id: id,
    ...fields,
    nickname: cleanName(profile.global_name || profile.username).slice(0, 32) || "user",
    is_admin: "0",
    created_at: String(Date.now()),
  };
  const { user_id, ...data } = user;
  await redis.hset(key(user_id), data);
  return user;
}

export async function setUserNickname(id: string, nickname: string) {
  await redis.hset(key(id), { nickname });
}

export function avatarUrl(user: Pick<User, "discord_id" | "avatar">) {
  return user.avatar ? `https://cdn.discordapp.com/avatars/${user.discord_id}/${user.avatar}.png?size=128` : "";
}

export function isAdmin(user: User | undefined) {
  return user?.is_admin === "1";
}

export async function setAdmin(id: string, admin: boolean) {
  await redis.hset(key(id), { is_admin: admin ? "1" : "0" });
}

export async function listUsers(): Promise<User[]> {
  const ids: string[] = [];
  let cursor = "0";
  do {
    const [next, keys] = (await redis.send("SCAN", [cursor, "MATCH", "user:*", "COUNT", "500"])) as [string, string[]];
    cursor = next;
    ids.push(...keys.map((k) => k.slice("user:".length)));
  } while (cursor !== "0");
  const users = await Promise.all(ids.map(getUser));
  return users.filter((u): u is User => u !== null).sort((a, b) => Number(b.created_at) - Number(a.created_at));
}
