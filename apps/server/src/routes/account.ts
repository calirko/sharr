import { Hono } from "hono";
import { deleteAccount } from "../account";
import { limitByUser } from "../guard";
import {
  destroySession,
  dropAllUserSessions,
  dropUserSession,
  listUserSessions,
  requireDiscord,
  type SessionEnv,
} from "../session";

// Discord users only. Guests have nothing to manage.
export const accountRoutes = new Hono<SessionEnv>()
  .use(requireDiscord)
  .get("/sessions", async (c) => {
    const current = c.get("session")!;
    const sessions = await listUserSessions(current.user_id);
    return c.json({
      sessions: sessions.map((s) => ({
        id: s.sid,
        client: s.client ?? "web",
        user_agent: s.user_agent ?? "",
        created_at: Number(s.created_at),
        last_seen: Number(s.last_seen || s.created_at),
        is_current: s.sid === current.sid,
      })),
    });
  })
  .delete("/sessions/:id", limitByUser("account", 30, 600), async (c) => {
    const current = c.get("session")!;
    const sid = c.req.param("id");
    if (sid === current.sid) return c.json({ error: "current_session" }, 400);
    if (!(await dropUserSession(current.user_id, sid))) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true });
  })
  .delete("/sessions", limitByUser("account", 30, 600), async (c) => {
    const current = c.get("session")!;
    await dropAllUserSessions(current.user_id, current.sid);
    return c.json({ ok: true });
  })
  .delete("/", limitByUser("account", 30, 600), async (c) => {
    const current = c.get("session")!;
    await deleteAccount(current.user_id);
    await destroySession(c, current);
    return c.json({ ok: true });
  });
