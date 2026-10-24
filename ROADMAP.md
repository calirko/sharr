# Roadmap

Build order: server → deploy to prod → web (tested on prod HTTPS) → polish/admin → desktop. Scope stays as defined in `CLAUDE.md`; nothing outside it goes on this list.

Testing happens on the prod domain (`https://sharr.calirko.com`) from the first working backend onward. `getDisplayMedia` requires a secure context anyway, and real NAT/TURN behavior can't be reproduced on localhost.

## M0 — Scaffold (done)
- [x] Monorepo layout, compose (`dragon` network, NPM pattern), LiveKit config, `.env.example`, `CLAUDE.md`

## M1 — Server core (`apps/server`)
- [x] Hono app on Bun, Redis client, config from env, health endpoint
- [x] Signed-cookie sessions stored in Redis
- [x] Guest session: nickname set, duplicate suffixing per room
- [x] Rooms: create (optional PIN, hashed), join, list, settings (who may share), close
- [x] LiveKit token minting: PIN check, `canPublish` from room settings, nickname/identity in token
- [x] Room expiry after inactivity (uses LiveKit server API to check participants)
- [x] Dockerfile, enable `app` in compose

## M2 — First prod deploy (before any real UI)
- [ ] Open `7882/udp`, `7881/tcp`, `3478/udp` on the host/router
- [ ] NPM entry `sharr.calirko.com` → `sharr:3000` (websockets on), custom location `/rtc` → `sharr-livekit:7880`
- [ ] Set real `.env` on the server (API key/secret, session secret)
- [ ] Smoke test the API and a LiveKit connection from outside the network (also from a phone on mobile data to exercise NAT/TURN)

## M3 — Web app (`apps/web`), tested on prod
- [ ] Vite + React + Tailwind + shadcn, served by the `app` container
- [ ] Nickname entry, room list/create/join (PIN prompt)
- [ ] Room view: share screen (1080p60 cap, quality/bitrate tier picker, audio on), watch streams, several sharers
- [ ] Room settings dialog (creator only)
- [ ] Chat over LiveKit data channels
- [ ] Responsive layout (mobile viewing, desktop sharing)
- [ ] Verify on Windows Chrome/Firefox and Linux Wayland (portal + PipeWire)

## M4 — Discord login + history
- [ ] Discord OAuth2 (`identify` only), identity shown in rooms
- [ ] Persist chat for logged-in users in Redis (backlog)

## M5 — Admin
- [ ] Admin CLI (`grant` / `revoke` `isAdmin`), talks to Redis directly
- [ ] Admin API with server-side flag check on every route
- [ ] `/admin` page: live rooms and participants, kick, close, users

## M6 — Hardening
- [ ] Rate limits on login/join/PIN attempts
- [ ] Quality tuning on real networks (bitrate tiers, codec choice, TURN usage)
- [ ] Decide on TURN/TLS (own hostname) if UDP-blocked networks are a problem

## M7 — Desktop (Tauri, Windows + Linux)
- [ ] Wrap the web app first; check whether webview `getDisplayMedia` is good enough
- [ ] Spike native capture if not: Linux portal + PipeWire, Windows Graphics Capture, publish through LiveKit Rust SDK (verify crate choices first)
- [ ] Signed auto-update via Tauri updater, CI builds + GitHub Releases on this public repo (Linux: AppImage)
