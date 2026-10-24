import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { config } from "./config";
import { startRoomSweeper } from "./expiry";
import { redis } from "./redis";
import { roomRoutes } from "./routes/rooms";
import { sessionRoutes } from "./routes/session";
import { sessionMiddleware, type SessionEnv } from "./session";

const api = new Hono<SessionEnv>();

api.get("/health", async (c) => {
  await redis.send("PING", []);
  return c.json({ ok: true });
});

api.use(sessionMiddleware);
api.route("/session", sessionRoutes);
api.route("/rooms", roomRoutes);
api.all("*", (c) => c.json({ error: "not_found" }, 404));

const app = new Hono();
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
