import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { discordEnabled } from "../config";
import { cleanName, limitByIp, limitByUser, limitGlobal } from "../guard";
import { randomId, redis } from "../redis";
import {
  createDiscordSession,
  createGuestSession,
  destroySession,
  dropSession,
  publicUser,
  requireSession,
  setNickname,
  type SessionEnv,
} from "../session";
import { getUser } from "../users";

// Desktop login: the app can't share the browser's cookies, so a logged in browser hands it a
// one-time code through the app's loopback listener, and the app trades it for its own session
const HANDOFF_TTL = 120;
const handoffKey = (code: string) => `handoff:${code}`;

export const nicknameSchema = z.string().max(64).transform(cleanName).pipe(z.string().min(1).max(32));

export const sessionRoutes = new Hono<SessionEnv>()
  .post("/guest", limitByIp("guest", 10, 3600), limitGlobal("guest_all", 1000, 3600), zValidator("json", z.object({ nickname: nicknameSchema })), async (c) => {
    const old = c.get("session");
    if (old) await destroySession(c, old);
    const session = await createGuestSession(c, c.req.valid("json").nickname);
    return c.json({ user: publicUser(session) });
  })
  // Keeps user_id, so rooms the user created stay theirs
  .patch("/", requireSession, limitByUser("rename", 10, 60), zValidator("json", z.object({ nickname: nicknameSchema })), async (c) => {
    const session = c.get("session")!;
    await setNickname(session, c.req.valid("json").nickname);
    return c.json({ user: publicUser(session) });
  })
  .get("/me", (c) => {
    const session = c.get("session");
    return c.json({ user: session ? publicUser(session) : null, discord_enabled: discordEnabled });
  })
  .post("/desktop-code", requireSession, limitByUser("desktop_code", 20, 600), async (c) => {
    const session = c.get("session")!;
    if (session.kind !== "discord") return c.json({ error: "discord_only" }, 403);
    const code = randomId(24);
    await redis.send("SET", [handoffKey(code), session.user_id, "EX", String(HANDOFF_TTL)]);
    return c.json({ code });
  })
  .post("/desktop-redeem", limitByIp("desktop_redeem", 20, 600), zValidator("json", z.object({ code: z.string().min(1).max(64) })), async (c) => {
    // GETDEL, so a code works once
    const userId = (await redis.send("GETDEL", [handoffKey(c.req.valid("json").code)])) as string | null;
    const user = userId ? await getUser(userId) : null;
    if (!user) return c.json({ error: "bad_code" }, 400);
    const old = c.get("session");
    if (old) await dropSession(old);
    return c.json({ user: publicUser(await createDiscordSession(c, user)) });
  })
  .delete("/", async (c) => {
    const session = c.get("session");
    if (session) await destroySession(c, session);
    return c.json({ ok: true });
  });
