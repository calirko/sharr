import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import { config } from "./config";
import { limitByIp, sameOrigin } from "./guard";
import { startRoomSweeper } from "./expiry";
import { redis } from "./redis";
import { adminRoutes } from "./routes/admin";
import { authRoutes } from "./routes/auth";
import { roomRoutes } from "./routes/rooms";
import { sessionRoutes } from "./routes/session";
import { sessionMiddleware, type SessionEnv } from "./session";

const api = new Hono<SessionEnv>();
api.use(bodyLimit({ maxSize: 8 * 1024, onError: (c) => c.json({ error: "too_large" }, 413) }));
api.use(sameOrigin);

api.get("/health", async (c) => {
  await redis.send("PING", []);
  return c.json({ ok: true });
});

// Loose cap on everything, well above what the web app polls
api.use(limitByIp("api", 600, 60));
api.use(sessionMiddleware);
api.route("/auth", authRoutes);
api.route("/session", sessionRoutes);
api.route("/rooms", roomRoutes);
api.route("/admin", adminRoutes);
api.all("*", (c) => c.json({ error: "not_found" }, 404));

const app = new Hono();
const livekitOrigin = new URL(config.livekit.url).origin;
app.use(
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:", "https://cdn.discordapp.com"],
      mediaSrc: ["'self'", "blob:", "mediastream:"],
      connectSrc: ["'self'", livekitOrigin, livekitOrigin.replace(/^http/, "ws"), livekitOrigin.replace(/^ws/, "http")],
      workerSrc: ["'self'", "blob:"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      // Discord Activities frame the app (through their discordsays.com proxy)
      frameAncestors: ["https://discord.com", "https://*.discord.com", "https://*.discordsays.com"],
      formAction: ["'self'"],
    },
    xFrameOptions: false,
    permissionsPolicy: { displayCapture: ["self"] },
  }),
);
app.route("/api", api);

// Web build. Unknown paths get index.html so client routes like /r/:id work on reload.
app.use("*", serveStatic({ root: config.webDist }));
app.get("*", serveStatic({ root: config.webDist, path: "index.html" }));

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "internal" }, 500);
});

startRoomSweeper();
console.log(`sharr server on :${config.port}`);

export default { port: config.port, fetch: app.fetch };
