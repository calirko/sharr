function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var ${name}`);
  return value;
}

const sessionSecret = required("SESSION_SECRET");
const production = process.env.NODE_ENV === "production";
if (production && (sessionSecret.length < 32 || sessionSecret === "change-me")) {
  throw new Error("SESSION_SECRET must be at least 32 characters in production");
}
if (production && process.env.LIVEKIT_API_KEY === "devkey") {
  throw new Error("LIVEKIT_API_KEY is still the dev default");
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  // For the calico bot (Discord Activity test). Not routed through the tunnel.
  internalPort: Number(process.env.INTERNAL_PORT ?? 3001),
  relayUrl: process.env.RELAY_URL ?? "ws://localhost:7890",
  production,
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  sessionSecret,
  livekit: {
    // Public signaling URL handed to clients
    url: required("LIVEKIT_URL"),
    // Internal server API URL, used by this server only
    apiUrl: process.env.LIVEKIT_API_URL ?? "http://localhost:7880",
    apiKey: required("LIVEKIT_API_KEY"),
    apiSecret: required("LIVEKIT_API_SECRET"),
  },
  // Relative to the server's working dir (apps/server)
  webDist: process.env.WEB_DIST ?? "../web/dist",
  // Optional. Without it only guest login is offered.
  discord: {
    clientId: process.env.DISCORD_CLIENT_ID ?? "",
    clientSecret: process.env.DISCORD_CLIENT_SECRET ?? "",
    redirectUri: process.env.DISCORD_REDIRECT_URI ?? "",
  },
  roomIdleMinutes: Number(process.env.ROOM_IDLE_MINUTES ?? 30),
};

export const discordEnabled = Boolean(config.discord.clientId && config.discord.clientSecret && config.discord.redirectUri);
