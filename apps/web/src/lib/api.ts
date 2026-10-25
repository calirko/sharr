export type User = {
  user_id: string;
  kind: "guest" | "discord";
  nickname: string;
  discord_username: string;
  avatar_url: string;
  is_admin: boolean;
};

export type ShareMode = "creator" | "everyone";

export type Room = {
  id: string;
  name: string;
  creator_id: string;
  has_pin: boolean;
  share_mode: ShareMode;
  created_at: number;
  participants: number;
};

export type JoinInfo = { url: string; token: string; name: string; can_share: boolean; is_creator: boolean };

export type AdminParticipant = {
  identity: string;
  name: string;
  kind: "guest" | "discord";
  discord_username: string;
  avatar_url: string;
  sharing: boolean;
  joined_at: number;
};

// Rooms LiveKit has but we don't (known: false) only carry id and participants
export type AdminRoom = { id: string; known: false; participants: AdminParticipant[] } | (Omit<Room, "participants"> & {
  known: true;
  last_active_at: number;
  creator_name: string;
  creator_discord_username: string;
  participants: AdminParticipant[];
});

export type AdminUser = {
  user_id: string;
  discord_id: string;
  discord_username: string;
  nickname: string;
  avatar_url: string;
  is_admin: boolean;
  created_at: number;
};

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? "request_failed");
  return data as T;
}

export const api = {
  me: () => call<{ user: User | null; discord_enabled: boolean }>("GET", "/session/me"),
  guest: (nickname: string) => call<{ user: User }>("POST", "/session/guest", { nickname }),
  rename: (nickname: string) => call<{ user: User }>("PATCH", "/session", { nickname }),
  logout: () => call<{ ok: true }>("DELETE", "/session"),
  desktopCode: () => call<{ code: string }>("POST", "/session/desktop-code"),
  desktopRedeem: (code: string) => call<{ user: User }>("POST", "/session/desktop-redeem", { code }),
  rooms: () => call<{ rooms: Room[] }>("GET", "/rooms"),
  room: (id: string) => call<{ room: Room }>("GET", `/rooms/${id}`),
  createRoom: (body: { name: string; pin?: string; share_mode: ShareMode }) =>
    call<{ room: Room }>("POST", "/rooms", body),
  updateRoom: (id: string, body: { share_mode: ShareMode }) => call<{ room: Room }>("PATCH", `/rooms/${id}`, body),
  closeRoom: (id: string) => call<{ ok: true }>("DELETE", `/rooms/${id}`),
  kick: (id: string, identity: string) =>
    call<{ ok: true }>("DELETE", `/rooms/${id}/participants/${encodeURIComponent(identity)}`),
  join: (id: string, pin?: string) => call<JoinInfo>("POST", `/rooms/${id}/join`, { pin }),
  logMessage: (id: string, text: string) => call<{ ok: true }>("POST", `/rooms/${id}/messages`, { text }),
  admin: {
    rooms: () => call<{ rooms: AdminRoom[] }>("GET", "/admin/rooms"),
    closeRoom: (id: string) => call<{ ok: true }>("DELETE", `/admin/rooms/${id}`),
    kick: (id: string, identity: string) =>
      call<{ ok: true }>("DELETE", `/admin/rooms/${id}/participants/${encodeURIComponent(identity)}`),
    users: () => call<{ users: AdminUser[] }>("GET", "/admin/users"),
  },
};

// Full page navigation, Discord sends the user back to `next`
export function discordLoginUrl(next = location.pathname) {
  return `/api/auth/discord?next=${encodeURIComponent(next)}`;
}
