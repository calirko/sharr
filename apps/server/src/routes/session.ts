import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { discordEnabled } from "../config";
import { cleanName, limitByIp, limitByUser, limitGlobal } from "../guard";
import { createGuestSession, destroySession, publicUser, requireSession, setNickname, type SessionEnv } from "../session";

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
  .delete("/", async (c) => {
    const session = c.get("session");
    if (session) await destroySession(c, session);
    return c.json({ ok: true });
  });
