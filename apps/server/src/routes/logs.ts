import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { MAX_LINE, MAX_LINES, storeLogs } from "../applog";
import { limitByUser } from "../guard";
import { requireDiscord, type SessionEnv } from "../session";

const text = (max: number) => z.string().max(max * 4).transform((s) => s.replace(/\p{Cc}/gu, " ").slice(0, max));

const body = z.object({
  version: text(32),
  os: text(32),
  lines: z
    .array(z.object({ ts: z.number().int().nonnegative(), level: text(8), target: text(64), msg: text(MAX_LINE) }))
    .min(1)
    .max(MAX_LINES),
});

// The desktop app's own log, uploaded by its page. Desktop sessions are always Discord ones.
export const logRoutes = new Hono<SessionEnv>().post(
  "/",
  requireDiscord,
  limitByUser("logs", 30, 600),
  zValidator("json", body),
  async (c) => {
    const session = c.get("session")!;
    if (session.client !== "desktop") return c.json({ error: "desktop_only" }, 403);
    const { version, os, lines } = c.req.valid("json");
    await storeLogs({ user_id: session.user_id, name: session.nickname, version, os }, lines);
    return c.json({ ok: true });
  },
);
