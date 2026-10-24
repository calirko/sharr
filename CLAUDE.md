# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Style notes

- Writing (code comments, docs, UI text, commit messages): avoid AI-sounding characters and phrasing. No em dashes, no long obvious sentences, no filler. Keep it short and plain.
- Naming: camelCase for functions and objects, snake_case for data (DB fields, JSON payloads, env-style keys).
- Icons: Lucide icons only.
- Fonts: Inter only, for now.

## Status

M1 (server core) is done: `apps/server` has guest sessions, rooms with PINs, LiveKit token minting and idle room expiry. `apps/web` and `apps/desktop` are still empty. `apps/web` is not in the root `workspaces` yet; add it back when it gets a `package.json`. Commands below marked *(planned)* do not work yet.

Server API (all under `/api`, JSON): `GET /health`, `POST /session/guest {nickname}`, `GET /session/me`, `DELETE /session`, `GET|POST /rooms`, `GET|PATCH|DELETE /rooms/:id`, `POST /rooms/:id/join {pin?}` → `{url, token, name, can_share, is_creator}`. Redis keys: `session:{sid}`, `room:{id}`, `room:{id}:names` (recent name claims), `rooms` (zset).

See `ROADMAP.md` for milestones; keep it updated as items complete. Once the backend works it is **deployed to prod early and tested from `https://sharr.calirko.com`**, not just localhost.

**Build order: web first** (server + web, sharing through the browser), then the Tauri desktop app. Desktop native capture is a later spike; don't start it before the web app works end to end.

## What sharr is

A deliberately small screen-sharing app. Scope is **only**:

- **Screen sharing**, capped at **1080p60**. "Higher quality" means a higher bitrate tier within that cap, not a higher resolution. Each sharer can pick a quality (bitrate) tier. Screen/tab **audio is shared** along with the video; no microphone, no voice calls.
- **Rooms**: create / join / list. Rooms are ephemeral: they close automatically after a period of inactivity, or when the creator (or an admin) closes them.
- **Room settings dialog** (button in the room, creator only). Includes **who may share**: only the creator, or everyone (several simultaneous sharers are supported). Keep other settings to what is actually needed.
- **Room PIN**: a join PIN, **optional** — the creator may set one when making a room; rooms without a PIN are open to join. The server must check the PIN before minting a LiveKit token (never rely on the client). Likewise, "who may share" is enforced via the LiveKit token's `canPublish` grant, not just hidden in the UI.
- **Chat** per room, with a nickname. Login is via **Discord (identity only — the `identify` scope, no guilds/bot)** or **guest**. Discord login exists only so people can be identified against their Discord identity.
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
apps/desktop/  Tauri shell (Windows + Linux) wrapping the web app, plus native capture in src-tauri/ (Rust)
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
- *Tauri desktop:* do not assume WebKitGTK's `getDisplayMedia` works on Linux (portal-dependent, historically unreliable in wry). Plan is native capture in Rust and publishing frames through the LiveKit Rust SDK (`NativeVideoSource`, I420 frames — convert from BGRA with its `yuv_helper`). Linux: xdg-desktop-portal ScreenCast + PipeWire (`ashpd` + `pipewire` crates are the likely candidates). Windows: Windows Graphics Capture (via the `windows` crate or a wrapper). **These crate choices are unverified — check current versions/maintenance before adopting.** Wayland cannot be captured any other way than portal + PipeWire; there is no X11-style fallback.

## Desktop releases and auto-update

This repo is **public** and hosts the releases for both Windows and Linux (GitHub Releases). Auto-update is required: use Tauri's updater plugin with signed update artifacts (a signing keypair is needed; the private key and password live in CI secrets, never in the repo) and a CI workflow (e.g. `tauri-action`) that builds Windows + Linux on tag and publishes the release plus the updater manifest. Linux auto-update is believed to work only for the AppImage bundle — verify against current Tauri docs when setting it up. Since the repo is public, never commit `.env`, keys, or Discord secrets.

## Commands

Toolchain on the dev machine: bun, node, pnpm, cargo. Docker is being set up locally by the user; local dev runs LiveKit + Redis in containers (the external `dragon` network must exist: `docker network create dragon`).

```
bun install                  # install workspace deps
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d livekit db   # local SFU + Redis; dev override publishes 7880/6379 to localhost and uses infra/livekit/livekit.dev.yaml (loopback ICE, no TURN). Needs the external `dragon` network.
bun run dev:server           # API on :3000, loads the root .env (use localhost values for REDIS_URL, LIVEKIT_API_URL, LIVEKIT_URL=ws://localhost:7880)
cd apps/server && bun run typecheck
bun run dev:web              # (planned)
cd apps/desktop && cargo tauri dev   # (planned)
```

Copy `.env.example` to `.env` first. LiveKit runs with `use_external_ip: true` so it advertises the server's public IP; without that, clients behind NAT get unusable ICE candidates.

## Deployment (same pattern as sonawr/powerr)

Deployed with **Dokploy** (compose app). Env vars go in Dokploy's Environment tab (it writes `.env`); generate them with `scripts/gen-env.sh`. Don't bind-mount repo files in `docker-compose.yml`: Dokploy's checkout doesn't keep them on disk, and Docker creates an empty directory in their place.

Deployed behind **Nginx Proxy Manager (NPM)** on the existing external Docker network `dragon` (must already exist: `docker network create dragon`). Same conventions as the sibling projects in `~/Projects` (`sonawr/compose.yml`, `powerr/docker-compose.yml`): `container_name` set, each public service joins `dragon` with an `aliases:` entry, no published ports for anything NPM fronts, named volumes. (`backupr` itself wasn't on this machine; these siblings were used as the reference.)

**One NPM entry** for the whole stack: `sharr.calirko.com` → `http://sharr:3000` (the `app` container, which serves the web build + API), TLS via NPM, **Websockets Support on**. Add one custom location on that same host: `/rtc` → `sharr-livekit:7880` (LiveKit's signaling websocket; `LIVEKIT_URL=wss://sharr.calirko.com`). The LiveKit server API (twirp) stays internal; the app reaches it at `http://sharr-livekit:7880`.

**NPM cannot carry media.** These LiveKit ports are published directly on the host and must be open in the firewall/router: `7882/udp` (all ICE/UDP, single-port mux), `7881/tcp` (ICE/TCP fallback), `3478/udp` (TURN). If `sharr.calirko.com` sits behind Cloudflare, the proxy is fine for the web/`/rtc` traffic but the media ports bypass it, since the clients connect to the server IP learned via ICE. TURN/TLS on 443 would need its own hostname and is not set up yet.

`db` (Redis) is only on the stack's private default network, with no alias on `dragon`. `app` is on both `default` (to reach `db`) and `dragon` (NPM, LiveKit). Compose sets `REDIS_URL` and `LIVEKIT_API_URL` for the container, so `.env` can keep localhost values for dev.

No lint/test setup yet besides `typecheck`; add the commands here when they exist.
