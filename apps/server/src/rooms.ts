import { redis, randomId } from "./redis";

export type ShareMode = "creator" | "everyone";

export type Room = {
  id: string;
  name: string;
  creator_id: string;
  pin_hash: string;
  share_mode: ShareMode;
  created_at: string;
  last_active_at: string;
};

const key = (id: string) => `room:${id}`;
const INDEX = "rooms";

export async function createRoom(input: { name: string; creator_id: string; pin?: string; share_mode: ShareMode }) {
  const now = String(Date.now());
  const room: Room = {
    id: randomId(6),
    name: input.name,
    creator_id: input.creator_id,
    pin_hash: input.pin ? await Bun.password.hash(input.pin) : "",
    share_mode: input.share_mode,
    created_at: now,
    last_active_at: now,
  };
  const { id, ...data } = room;
  await redis.hset(key(id), data);
  await redis.zadd(INDEX, Number(now), id);
  return room;
}

export async function getRoom(id: string): Promise<Room | null> {
  const data = await redis.hgetall(key(id));
  return data.creator_id ? ({ id, ...data } as Room) : null;
}

export async function listRooms(): Promise<Room[]> {
  const ids = await redis.zrange(INDEX, 0, -1);
  const rooms = await Promise.all(ids.map(getRoom));
  return rooms.filter((r): r is Room => r !== null);
}

export async function updateRoom(id: string, fields: Partial<Omit<Room, "id">>) {
  await redis.hset(key(id), fields as Record<string, string>);
}

export async function removeRoom(id: string) {
  await redis.del(key(id), namesKey(id));
  await redis.zrem(INDEX, id);
}

export async function checkPin(room: Room, pin: string | undefined) {
  if (!room.pin_hash) return true;
  if (!pin) return false;
  return Bun.password.verify(pin, room.pin_hash);
}

export function canShare(room: Room, userId: string) {
  return room.share_mode === "everyone" || room.creator_id === userId;
}

// name, name2, name3 ... skipping names already taken in the room.
// Names handed out by recent joins (name -> "identity|ms"), so two people joining
// before either shows up in LiveKit don't get the same name. Runs atomically in Redis.
const NAME_HOLD_MS = 60_000;
const namesKey = (id: string) => `room:${id}:names`;

const CLAIM_SCRIPT = `
local me, base, now, hold = ARGV[1], ARGV[2], tonumber(ARGV[3]), tonumber(ARGV[4])
local live = {}
for i = 5, #ARGV do live[ARGV[i]] = true end
local n = 1
while true do
  local name = base
  if n > 1 then name = base .. n end
  if not live[name] then
    local v = redis.call('HGET', KEYS[1], name)
    local free = true
    if v then
      local sep = string.find(v, '|', 1, true)
      local who, at = string.sub(v, 1, sep - 1), tonumber(string.sub(v, sep + 1))
      if who ~= me and now - at < hold then free = false end
    end
    if free then
      redis.call('HSET', KEYS[1], name, me .. '|' .. now)
      return name
    end
  end
  n = n + 1
end
`;

export async function claimName(roomId: string, identity: string, base: string, liveNames: string[]) {
  const args = [identity, base, String(Date.now()), String(NAME_HOLD_MS), ...liveNames];
  const name = (await redis.send("EVAL", [CLAIM_SCRIPT, "1", namesKey(roomId), ...args])) as string;
  // Holds only matter for NAME_HOLD_MS, so the table can go away on its own
  await redis.send("EXPIRE", [namesKey(roomId), "300"]);
  return name;
}

export function publicRoom(room: Room, participants = 0) {
  return {
    id: room.id,
    name: room.name,
    creator_id: room.creator_id,
    has_pin: room.pin_hash !== "",
    share_mode: room.share_mode,
    created_at: Number(room.created_at),
    participants,
  };
}
