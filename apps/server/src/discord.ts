import { config } from "./config";

const API = "https://discord.com/api/v10";
// A slow Discord shouldn't pile up open requests here
const TIMEOUT_MS = 10_000;

export function authorizeUrl(state: string) {
  const params = new URLSearchParams({
    client_id: config.discord.clientId,
    redirect_uri: config.discord.redirectUri,
    response_type: "code",
    scope: "identify",
    state,
    prompt: "none",
  });
  return `https://discord.com/oauth2/authorize?${params}`;
}

export type DiscordProfile = { id: string; username: string; global_name: string | null; avatar: string | null };

// Code for profile. The access token is used once and not kept.
export async function fetchProfile(code: string): Promise<DiscordProfile> {
  const tokenRes = await fetch(`${API}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.discord.clientId,
      client_secret: config.discord.clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: config.discord.redirectUri,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!tokenRes.ok) throw new Error(`discord token exchange failed: ${tokenRes.status} ${(await tokenRes.text()).slice(0, 200)}`);
  const { access_token } = (await tokenRes.json()) as { access_token: string };

  const meRes = await fetch(`${API}/users/@me`, {
    headers: { authorization: `Bearer ${access_token}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!meRes.ok) throw new Error(`discord profile fetch failed: ${meRes.status}`);
  const me = (await meRes.json()) as DiscordProfile;
  // The id ends up in Redis keys, so make sure it is a plain snowflake
  if (!/^\d{1,20}$/.test(String(me.id)) || typeof me.username !== "string") throw new Error("discord profile looks wrong");
  return {
    id: me.id,
    username: me.username.slice(0, 64),
    global_name: typeof me.global_name === "string" ? me.global_name.slice(0, 64) : null,
    avatar: typeof me.avatar === "string" && /^[\w]{1,64}$/.test(me.avatar) ? me.avatar : null,
  };
}
