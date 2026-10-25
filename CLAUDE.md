# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Style notes

- Writing (code comments, docs, UI text, commit messages): avoid AI-sounding characters and phrasing. No em dashes, no long obvious sentences, no filler. Keep it short and plain.
- Naming: camelCase for functions and objects, snake_case for data (DB fields, JSON payloads, env-style keys).
- No native `alert`/`confirm`/`prompt` popups. Use a dialog (`ConfirmDialog` for confirmations).
- Errors go to a toast (`toast.error` from `sonner`, bottom center), not inline red text.
- Icons: Lucide icons only. Exception: the Discord logo (`DiscordIcon`, inline SVG from simple-icons), since Lucide has no brand icons.
- Fonts: Inter for everything, Space Grotesk (`font-display`) for the app name, room names and dialog titles only.

## Status

M1 (server core) is done and deployed to prod (M2): `apps/server` has guest sessions, rooms with PINs, LiveKit token minting and idle room expiry. M3 (web app) is done and tested on prod (Chrome, Firefox, iOS Safari). M4 (Discord login, chat backlog) is built and tested locally with a faked Discord API; it still needs a real Discord app and a prod test. M5 (admin CLI, API and `/admin` page) is built and tested locally. M7 (desktop app) is built: Linux system audio and the updater are tested locally, Windows only builds in CI so far (see `ROADMAP.md`).

The server serves the web build (`apps/web/dist`, override with `WEB_DIST`) with an `index.html` fallback for client routes. The Dockerfile builds the web app in its own stage. Web routes: `/` (nickname, room list), `/r/:id` (room), `/admin` (admins only, linked from the user menu). Chat uses LiveKit text streams on topic `lk.chat` through our own hook (`apps/web/src/lib/chat.ts`), not `useChat`: messages can arrive before the sender's participant is known, and `useChat` then loses the sender for good. Spam limits (5 messages per 10s per sender, 1000 chars, collapsed blank lines) are enforced by every receiver in that hook, since the server never sees chat. Shadcn components live in `apps/web/src/components/ui` (add more with `bunx --bun shadcn@latest add <name>` from `apps/web`; check that it imports `cn` from `@/lib/utils`, it once pulled in an unrelated `cn` package).

Server API (all under `/api`, JSON): `GET /health`, `POST /session/guest {nickname}`, `GET /session/me`, `PATCH /session {nickname}` (keeps user_id), `DELETE /session`, `GET /rooms` (own rooms only), `POST /rooms`, `GET|PATCH|DELETE /rooms/:id`, `DELETE /rooms/:id/participants/:identity` (kick, creator only; kicked users can't join again until the room closes, the creator can't be shut out), `POST /rooms/:id/join {pin?}` → `{url, token, name, can_share, is_creator}` (the creator skips the PIN), `POST /rooms/:id/messages {text}` (chat backlog, Discord users only, must be in the room), `GET /auth/discord?next=` and `/auth/discord/callback` (redirect URI is `{origin}/api/auth/discord/callback`), admin only: `GET /admin/rooms` (all rooms with live participants, plus LiveKit rooms we have no record of), `DELETE /admin/rooms/:id`, `DELETE /admin/rooms/:id/participants/:identity` (kick), `GET /admin/users`. Admin routes answer 404 to non-admins. `GET /session/me` also returns `discord_enabled` (false when the `DISCORD_*` env vars are empty). Abuse limits (`apps/server/src/guard.ts`, Redis counters `rl:*`, client IP from `cf-connecting-ip`, IPv6 counted per /64, `x-forwarded-for` trusted in dev only): 600 API requests per IP per minute, 10 guest sessions per IP per hour (1000 in total per hour, then `busy`), 10 nickname changes per user per minute, 20 Discord login starts and 20 callbacks per IP per 10 min, 10 room creations per IP per hour, 2 live rooms per guest (10 per Discord user), 60 joins per IP per minute, 5 wrong PINs per room and IP per 10 min (30 per room per hour). Guest sessions last 1 day after last use, Discord 30, but never longer than 7 and 90 days from login. A Discord user keeps at most 10 sessions; logging in again drops the oldest. Discord calls time out after 10s and the profile is validated before use. Non-GET requests with a foreign `Origin` are rejected, API bodies are capped at 8 KB, nicknames and room names are stripped of control and bidi characters, and prod refuses to start with a short or default `SESSION_SECRET`. Prod cookie is `__Host-sid`. CSP and other headers come from `secureHeaders` in `index.ts`. Redis keys: `session:{sid}`, `sessions:{user_id}` (zset of a Discord user's sids), `user:{id}` (Discord users only, id `d_{discord_id}`, holds nickname, avatar hash and `is_admin`), `room:{id}`, `room:{id}:names` (recent name claims), `room:{id}:kicked` (set of kicked user ids), `rooms` (zset), `chat` (stream, backlog, capped at ~100k).

Discord sessions read `user:{id}` on every request, so nickname and `is_admin` are always current. The join token carries `discord_username` and `avatar_url` as LiveKit participant attributes (`canUpdateOwnMetadata` off, so clients can trust them); the web app shows the Discord avatar, or the first letter of the name, in the participant list, chat and tile labels. The backlog is reported by the sender's client, since chat never reaches the server.

See `ROADMAP.md` for milestones; keep it updated as items complete. Once the backend works it is **deployed to prod early and tested from `https://sharr.calirko.com`**, not just localhost.

**Build order: web first** (server + web, sharing through the browser), then the Tauri desktop app. Desktop native capture is a later spike; don't start it before the web app works end to end.

## What sharr is

A deliberately small screen-sharing app. Scope is **only**:

- **Screen sharing**, capped at **1080p60**. "Higher quality" means a higher bitrate tier within that cap, not a higher resolution. Each sharer can pick a quality (bitrate) tier and 30 or 60 fps. Screen/tab **audio is shared** along with the video; no microphone, no voice calls.
- **Rooms**: create / join / list. The list only shows rooms you created; other rooms are joined by link only (Invite button in the room, copy link in the list). Rooms are ephemeral: they close automatically after a period of inactivity, or when the creator (or an admin) closes them.
- **Room settings dialog** (button in the room, creator only). Includes **who may share**: only the creator, or everyone (several simultaneous sharers are supported). Keep other settings to what is actually needed.
- **Room PIN**: a join PIN, **optional** — the creator may set one when making a room; rooms without a PIN are open to join. The server must check the PIN before minting a LiveKit token (never rely on the client). Likewise, "who may share" is enforced via the LiveKit token's `canPublish` grant, not just hidden in the UI.
- **Chat** per room, with a nickname. Login is via **Discord (identity only — the `identify` scope, no guilds/bot)** or **guest**. Discord login exists only so people can be identified against their Discord identity.
  - The desktop app requires Discord login, no guests.
  - Guests pick any nickname; duplicates in a room get a suffix (e.g. `name`, `name2`) since guests are temporary.
  - Chat is ephemeral by default (LiveKit data channels). **Messages from Discord-logged-in users are also persisted** in Redis as a backlog, for debugging and a history of usage. Guest messages are never stored. (Interpretation of the user's request: if guest messages or room-usage records should be kept too, ask.)
- **Admin page**: admins only, to manage rooms and everything running (live rooms, participants, kick/close, users). Admin status is an `isAdmin` flag on the user record in the DB, **set only through a CLI run on the server** (e.g. `bun run admin grant <discord-id|user>` / `revoke`), never through the web UI or any public API. Admin routes must check the flag server-side on every request.

Do not add features beyond this list. UI is raw/minimal: React + Tailwind + shadcn, responsive (one frontend that adapts to mobile and desktop). Must work behind NAT, so the server side is the media relay.

## Stack

Bun runtime and workspaces, **Hono** for the API, **React + Vite** (Tailwind, shadcn) for the web app, **Redis** for data, **LiveKit** for media, **Tauri** for desktop. Sessions are a **signed cookie** (guests and Discord users alike), with session data in Redis.

## Layout

```
apps/server/   Bun API: Discord OAuth, guest sessions, rooms + PINs, LiveKit token minting, admin API + admin CLI
               (the admin page UI lives in apps/web under an /admin route)
apps/web/      React + Vite + Tailwind + shadcn frontend (mobile + desktop)
apps/desktop/  Tauri shell (Windows + Linux) that loads the web app from prod, plus Linux system audio in src-tauri/ (Rust)
infra/livekit/ livekit-server dev config (prod config is inline in docker-compose.yml `configs:`)
docker-compose.yml, .env.example   (root)
```

Bun workspaces cover `apps/server` and `apps/web`. `apps/desktop/src-tauri` is a standalone Cargo project, not a JS workspace member.

## Architecture decisions (researched 2026-10-24)

**Media relay: self-hosted LiveKit (SFU, Go/Pion) with its embedded TURN.** Chosen over mediasoup (low-level; we'd have to build signaling, room state and TURN ourselves) and raw Pion (library, not an SFU). LiveKit gives room/participant management, JS + Rust client SDKs, simulcast, and built-in TURN/TLS so clients behind strict NAT/firewalls can still connect. Expect a share of clients to be relayed via TURN, which costs server bandwidth.

**Our server never touches media.** It authenticates users, owns room metadata and PINs, and mints short-lived LiveKit access tokens (room-scoped, identity + nickname/Discord info in the token). Clients talk to LiveKit directly.

**Database: Redis (NoSQL, `redis:7-alpine` in compose, AOF persistence on, `REDIS_URL`).** Chosen for speed and minimal ops; holds users (incl. `isAdmin`), rooms and PIN hashes (hash PINs, don't store plaintext). Picked by me, not specified by the user — MongoDB is the alternative if document queries become painful. Live state (who is in a room, tracks) comes from LiveKit's server API (`RoomServiceClient`), not the DB; the admin page reads from both.

**Admin CLI** lives in `apps/server` and talks to the same Redis directly, so it works on the host/container without an authenticated API.

**Chat uses LiveKit data channels**, not a separate websocket service — keeps the stack to server + LiveKit.

**Capture, by client:**
- *Browser (web, mobile viewers):* `getDisplayMedia` via `livekit-client`. On Wayland, Chrome ≥110 and Firefox go through xdg-desktop-portal + PipeWire automatically; the portal backend (`xdg-desktop-portal-gnome`/`-kde`/`-wlr`) must be installed. Set `contentHint` (`motion` vs `detail`) and explicit `screenShareEncoding` (bitrate/fps) for quality; don't rely on defaults.
- *Tauri desktop (built 2026-10-25):* WebKitGTK ships without WebRTC (checked: no `RTCPeerConnection` even with `enable-webrtc`), so the app uses **Tauri 3 alpha with its CEF runtime** (`tauri-runtime-cef`, Chromium 154) on both OSes and loads `https://sharr.calirko.com` in the window. It runs the same web build as the browser; desktop-only behavior is in `apps/web/src/lib/desktop.ts`, which checks for `window.__TAURI__` (IPC is granted to the app origin only). Video comes from Chromium's `getDisplayMedia` (portal + PipeWire on Wayland), so quality tiers and the 1080p60 cap are shared with the web. Linux system audio (`src-tauri/src/sysaudio.rs`): a virtual PipeWire source (`Audio/Source/Virtual`, like Vesktop's venmic) that links every `Stream/Output/Audio` node except our own (any descendant of the app's pid, read from the full node info, the registry leaves the pid out); the page captures it with `getUserMedia` and publishes it as `ScreenShareAudio`. The mic permission is auto-granted only while that source runs. Windows gets system audio from Chromium's own picker, with `restrictOwnAudio` to keep the room's playback out (untested). No LiveKit Rust SDK, no native video capture.

## Desktop releases and auto-update

This repo is **public** and hosts the releases for both Windows and Linux (GitHub Releases). `.github/workflows/desktop.yml` builds on pushes to the `desktop` branch and, on `desktop-v*` tags, publishes a release with the AppImage, the NSIS installer, their `.sig` files and `latest.json`. The tag must match `version` in `tauri.conf.json`. The updater reads `releases/latest/download/latest.json`, downloads in the background, offers a Restart toast in the web app and otherwise installs on quit. Linux auto-update only works for the AppImage (no deb: the bundler can't strip the CEF placeholders). Signing key: `~/.tauri/sharr.key` (+ `.password`) on the dev machine, and the `TAURI_SIGNING_PRIVATE_KEY` / `_PASSWORD` repo secrets; losing it means shipped apps can't update. Never commit `.env`, keys, or Discord secrets.

Known workarounds in the build (Tauri 3 alpha): CEF 154 no longer ships `libEGL`/`libGLESv2`, which the bundler still copies, so CI creates empty placeholders. The AppImage tooling's helper sources moved upstream, so `ANYLINUX_LIB_SOURCE`/`GTK_CLASS_FIX_SOURCE` point at a pinned fork. The AppImage carries its own glibc and libpipewire, so `scripts/appimage-libs.sh` bundles what the bundler misses on Ubuntu: PipeWire client modules (the app points PipeWire at them, `use_bundled_pipewire`), libpulse and NSS's softokn/freebl. Test the CI-built AppImage, not just a local build: the bundler's own rules find these on Arch but not on Ubuntu.

## Commands

Toolchain on the dev machine: bun, node, pnpm, cargo. Docker is being set up locally by the user; local dev runs LiveKit + Redis in containers (the external `dragon` network must exist: `docker network create dragon`).

```
bun install                  # install workspace deps
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d livekit db   # local SFU + Redis; dev override publishes 7880/6379 to localhost and uses infra/livekit/livekit.dev.yaml (loopback ICE, no TURN). Needs the external `dragon` network.
bun run dev:server           # API on :3000, loads the root .env (use localhost values for REDIS_URL, LIVEKIT_API_URL, LIVEKIT_URL=ws://localhost:7880)
cd apps/server && bun run typecheck
bun run admin list|grant|revoke <discord-id|user-id>   # admin CLI; on prod: docker exec sharr bun run admin grant <discord-id>. The user must have logged in with Discord once.
bun run dev:web              # Vite on :5173, proxies /api to :3000
cd apps/web && bun run typecheck && bun run build   # build to apps/web/dist, which the server serves on :3000
cd apps/desktop && bun install && cargo build --manifest-path src-tauri/Cargo.toml   # desktop debug build
SHARR_URL=http://localhost:3000 SHARR_DEVTOOLS_PORT=9222 apps/desktop/src-tauri/target/debug/sharr   # debug only: other server, CDP on 9222 (mock keyring)
```

Copy `.env.example` to `.env` first. LiveKit runs with `use_external_ip: true` so it advertises the server's public IP; without that, clients behind NAT get unusable ICE candidates.

## Deployment (same pattern as sonawr/powerr)

Deployed with **Dokploy** (compose app). Env vars go in Dokploy's Environment tab (it writes `.env`); generate them with `scripts/gen-env.sh`. Don't bind-mount repo files in `docker-compose.yml`: Dokploy's checkout doesn't keep them on disk, and Docker creates an empty directory in their place.

Exposed through a **Cloudflare Tunnel** (cloudflared on the external Docker network `dragon`, which must already exist: `docker network create dragon`). Same conventions as the sibling projects in `~/Projects` (`sonawr/compose.yml`, `powerr/docker-compose.yml`): `container_name` set, each public service joins `dragon` with an `aliases:` entry, no published ports for anything the tunnel fronts, named volumes. Service names also become DNS names on `dragon`, so keep them unique there (`app` is taken by calirko.com).

**Two tunnel routes**, in this order: `sharr.calirko.com` path `^/rtc` → `http://sharr-livekit:7880` (LiveKit's signaling websocket; `LIVEKIT_URL=wss://sharr.calirko.com`), then `sharr.calirko.com` → `http://sharr:3000` (web build + API). The LiveKit server API (twirp) stays internal; the app reaches it at `http://sharr-livekit:7880`.

**The tunnel cannot carry media.** These LiveKit ports are published on the host and forwarded on the router from the public IP: `7882/udp` (all ICE/UDP, single-port mux), `7881/tcp` (ICE/TCP fallback), `3478/udp` (TURN). Clients connect to the IP LiveKit learns via STUN at startup, so no DNS record is needed; restart `sharr-livekit` if the public IP changes. TURN/TLS on 443 would need its own hostname and is not set up yet.

`db` (Redis) is only on the stack's private default network, with no alias on `dragon`. `sharr` is on both `default` (to reach `db`) and `dragon` (tunnel, LiveKit). Compose sets `REDIS_URL` and `LIVEKIT_API_URL` for the container, so `.env` can keep localhost values for dev.

No lint/test setup yet besides `typecheck`; add the commands here when they exist.
