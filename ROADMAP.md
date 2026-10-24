# Roadmap

Build order: server → deploy to prod → web (tested on prod HTTPS) → polish/admin → desktop. Scope stays as defined in `CLAUDE.md`; nothing outside it goes on this list.

Testing happens on the prod domain (`https://sharr.calirko.com`) from the first working backend onward. `getDisplayMedia` requires a secure context anyway, and real NAT/TURN behavior can't be reproduced on localhost.

## M0 — Scaffold (done)
- [x] Monorepo layout, compose (`dragon` network), LiveKit config, `.env.example`, `CLAUDE.md`

## M1 — Server core (`apps/server`)
- [x] Hono app on Bun, Redis client, config from env, health endpoint
- [x] Signed-cookie sessions stored in Redis
- [x] Guest session: nickname set, duplicate suffixing per room
- [x] Rooms: create (optional PIN, hashed), join, list, settings (who may share), close
- [x] LiveKit token minting: PIN check, `canPublish` from room settings, nickname/identity in token
- [x] Room expiry after inactivity (uses LiveKit server API to check participants)
- [x] Dockerfile, enable the app service in compose (now named `sharr`)

## M2 — First prod deploy (before any real UI)
- [x] Deploy via Dokploy (compose app); prod LiveKit config inlined in compose
- [x] Cloudflare Tunnel routes: `sharr.calirko.com` `^/rtc` → `sharr-livekit:7880`, then `sharr.calirko.com` → `sharr:3000`
- [x] Real `.env` in Dokploy, generated with `scripts/gen-env.sh`
- [x] Smoke test from outside: `/api/health` ok, `/rtc/validate` reaches LiveKit
- [x] Router forwards `7882/udp`, `7881/tcp`, `3478/udp` from `177.126.154.73` to dragon (7881/tcp open, 3478/udp answers STUN; no host firewall)
- [ ] Media test from outside the network, incl. a phone on mobile data for NAT/TURN (needs M3)

## M3 — Web app (`apps/web`), tested on prod
- [x] Vite + React + Tailwind + shadcn, served by the `sharr` container
- [x] Nickname entry, room list/create/join (PIN prompt)
- [x] Room view: share screen (1080p60 cap, quality/bitrate tier picker, audio on), watch streams, several sharers
- [x] Room settings dialog (creator only)
- [x] Chat over LiveKit data channels
- [x] Responsive layout (mobile viewing, desktop sharing)
- [x] Local headless test (two browsers): PIN, share, receive 1080p, chat, live share permission change, stop, close room
- [ ] Deploy and test on `https://sharr.calirko.com` (incl. the M2 phone-on-mobile-data media test)
- [ ] Verify on Windows Chrome/Firefox and Linux Wayland (portal + PipeWire), incl. tab/system audio
  - Firefox on Hyprland: picture goes green or the share stops after switching workspaces, portal bug (see `docs/known-issues/hyprland-portal-green-frames.md`)
  - Firefox publishes no audio track with the share (seen in LiveKit logs); Chrome does. Retest Chrome tab vs whole-screen audio on Linux

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
