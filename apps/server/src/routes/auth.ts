import { Hono } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import { config, discordEnabled } from "../config";
import { authorizeUrl, fetchProfile } from "../discord";
import { randomId } from "../redis";
import { createDiscordSession, dropSession, type SessionEnv } from "../session";
import { upsertDiscordUser } from "../users";

// Holds state and the page to return to while the user is on Discord
const COOKIE = "oauth";

// Only paths on this site. Parsed the way a browser does, so "/<tab>/evil.com" is caught too.
function safeNext(next: string | undefined) {
  if (!next || !next.startsWith("/")) return "/";
  try {
    const base = "http://sharr.invalid";
    const url = new URL(next, base);
    return url.origin === base ? url.pathname + url.search : "/";
  } catch {
    return "/";
  }
}

export const authRoutes = new Hono<SessionEnv>()
  .get("/discord", async (c) => {
    if (!discordEnabled) return c.json({ error: "not_found" }, 404);
    const state = randomId(16);
    await setSignedCookie(c, COOKIE, `${state}|${safeNext(c.req.query("next"))}`, config.sessionSecret, {
      httpOnly: true,
      secure: config.production,
      sameSite: "Lax",
      path: "/api/auth",
      maxAge: 600,
    });
    return c.redirect(authorizeUrl(state));
  })
  .get("/discord/callback", async (c) => {
    if (!discordEnabled) return c.json({ error: "not_found" }, 404);
    const saved = await getSignedCookie(c, config.sessionSecret, COOKIE);
    deleteCookie(c, COOKIE, { path: "/api/auth" });
    if (!saved) {
      console.error("discord login: no oauth cookie (expired, or blocked by the browser)");
      return c.redirect("/?login=failed");
    }
    const sep = saved.indexOf("|");
    const state = saved.slice(0, sep);
    const next = safeNext(saved.slice(sep + 1));

    // Cancelled on Discord's side
    if (c.req.query("error")) {
      console.log(`discord login: ${c.req.query("error")} ${c.req.query("error_description") ?? ""}`);
      return c.redirect(next);
    }
    const code = c.req.query("code");
    if (!code || c.req.query("state") !== state) {
      console.error(`discord login: ${code ? "state mismatch" : "no code"}`);
      return c.redirect("/?login=failed");
    }

    try {
      const user = await upsertDiscordUser(await fetchProfile(code));
      const old = c.get("session");
      if (old) await dropSession(old);
      await createDiscordSession(c, user);
      return c.redirect(next);
    } catch (err) {
      console.error(err);
      return c.redirect("/?login=failed");
    }
  });
