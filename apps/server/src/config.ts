function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var ${name}`);
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  production: process.env.NODE_ENV === "production",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  sessionSecret: required("SESSION_SECRET"),
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
