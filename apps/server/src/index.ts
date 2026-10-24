import { Hono } from "hono";
import { config } from "./config";
import { startRoomSweeper } from "./expiry";
import { redis } from "./redis";
import { roomRoutes } from "./routes/rooms";
import { sessionRoutes } from "./routes/session";
import { sessionMiddleware, type SessionEnv } from "./session";

const app = new Hono<SessionEnv>().basePath("/api");

app.get("/health", async (c) => {
  await redis.send("PING", []);
  return c.json({ ok: true });
});

app.use(sessionMiddleware);
app.route("/session", sessionRoutes);
app.route("/rooms", roomRoutes);

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "internal" }, 500);
});

startRoomSweeper();
console.log(`sharr server on :${config.port}`);

export default { port: config.port, fetch: app.fetch };
