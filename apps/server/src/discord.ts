import { config } from "./config";

const API = "https://discord.com/api/v10";

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
  });
  if (!tokenRes.ok) throw new Error(`discord token exchange failed: ${tokenRes.status} ${await tokenRes.text()}`);
  const { access_token } = (await tokenRes.json()) as { access_token: string };

  const meRes = await fetch(`${API}/users/@me`, { headers: { authorization: `Bearer ${access_token}` } });
  if (!meRes.ok) throw new Error(`discord profile fetch failed: ${meRes.status}`);
  return (await meRes.json()) as DiscordProfile;
}
