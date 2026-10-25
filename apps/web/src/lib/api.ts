export type User = {
  user_id: string;
  kind: "guest" | "discord";
  nickname: string;
  discord_username: string;
  avatar_url: string;
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
  rooms: () => call<{ rooms: Room[] }>("GET", "/rooms"),
  room: (id: string) => call<{ room: Room }>("GET", `/rooms/${id}`),
  createRoom: (body: { name: string; pin?: string; share_mode: ShareMode }) =>
    call<{ room: Room }>("POST", "/rooms", body),
  updateRoom: (id: string, body: { share_mode: ShareMode }) => call<{ room: Room }>("PATCH", `/rooms/${id}`, body),
  closeRoom: (id: string) => call<{ ok: true }>("DELETE", `/rooms/${id}`),
  join: (id: string, pin?: string) => call<JoinInfo>("POST", `/rooms/${id}/join`, { pin }),
  logMessage: (id: string, text: string) => call<{ ok: true }>("POST", `/rooms/${id}/messages`, { text }),
};

// Full page navigation, Discord sends the user back to `next`
export function discordLoginUrl(next = location.pathname) {
  return `/api/auth/discord?next=${encodeURIComponent(next)}`;
}
