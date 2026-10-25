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
- [x] Media test from outside the network, incl. a phone on mobile data for NAT/TURN (needs M3)

## M3 — Web app (`apps/web`), tested on prod
- [x] Vite + React + Tailwind + shadcn, served by the `sharr` container
- [x] Nickname entry, room list/create/join (PIN prompt)
- [x] Room view: share screen (1080p60 cap, quality/bitrate tier picker, audio on), watch streams, several sharers
- [x] Room settings dialog (creator only)
- [x] Chat over LiveKit data channels
- [x] Responsive layout (mobile viewing, desktop sharing)
- [x] Local headless test (two browsers): PIN, share, receive 1080p, chat, live share permission change, stop, close room
- [x] Deploy and test on `https://sharr.calirko.com` (incl. the M2 phone-on-mobile-data media test)
- [x] Verify on Chrome, Firefox and iOS Safari, incl. tab/system audio where the browser supports it
  - Firefox on Hyprland: picture goes green or the share stops after switching workspaces, portal bug (see `docs/known-issues/hyprland-portal-green-frames.md`)
  - Firefox publishes no audio track with the share (seen in LiveKit logs); Chrome does. Retest Chrome tab vs whole-screen audio on Linux
  - Zen (Firefox 157, Linux) never got a media connection on prod while a WireGuard interface was up (joins ended after 15s with `SIGNAL_SOURCE_CLOSE`); Chrome was fine. Works with the VPN down. Local setup, not a sharr bug; workaround is `media.peerconnection.ice.force_interface` (see `docs/known-issues/zen-vpn-ipv6-disconnects.md`)
  - iOS Safari in Low Power Mode leaves video paused without telling livekit-client; tiles now show a play button (fixed)

## M4 — Discord login + history
- [x] Discord OAuth2 (`identify` only), identity shown in rooms (`@username`, avatar; guests get their first letter)
- [x] Persist chat for logged-in users in Redis (backlog, `chat` stream)
- [ ] Create the Discord app, add `https://sharr.calirko.com/api/auth/discord/callback` as redirect, set `DISCORD_*` in Dokploy, test login on prod

## M5 — Admin
- [x] Admin CLI (`list`, `grant` / `revoke` `is_admin`), talks to Redis directly
- [x] Admin API with server-side flag check on every route
- [x] `/admin` page: live rooms and participants, kick, close, users (tested locally with a faked Discord session)
- [ ] Grant the first admin on prod and check the page there

## M6 — Hardening
- [x] Rate limits on login/join/PIN attempts
- [ ] Quality tuning on real networks (bitrate tiers, codec choice, TURN usage)
- [ ] Decide on TURN/TLS (own hostname) if UDP-blocked networks are a problem

## M7 — Desktop app (Tauri, Linux + Windows)
Main reason it exists: share system audio on Linux, which no browser can do (`getDisplayMedia` there only gives tab audio in Chrome, none in Firefox). Discord login is required, no guests.
- [x] Tauri shell in `apps/desktop` loading the web app from `https://sharr.calirko.com`. WebKitGTK has no WebRTC, so it's Tauri 3 alpha with the CEF runtime (Chromium) on both OSes
- [x] Discord login in the app: done in the system browser, which hands the app a one-time code over a `127.0.0.1` listener (`/desktop-login`). Guests are not offered. Needs the real Discord app (M4) to test end to end
- [x] Server side: nothing needed. The web app only uses `window.__TAURI__` to adjust its UI
- [x] Linux video: Chromium's `getDisplayMedia` (portal + PipeWire). Still needs a real share through the Hyprland portal picker
- [x] Linux system audio: virtual PipeWire source fed by every app except sharr itself, captured by the page and published as the share's audio (tested locally: links, exclusion, cleanup, a viewer receives stereo 48 kHz)
- [ ] Windows: system audio from Chromium's picker with `restrictOwnAudio`. Builds in CI, not run on Windows yet
- [x] ~~Publish through the LiveKit Rust SDK~~ not needed: the app publishes through the same web code, so the 1080p60 cap and bitrate tiers are shared
- [x] Webview `getDisplayMedia` is enough for video on both OSes (Chromium)
- [ ] Signed auto-update via Tauri updater, CI builds + GitHub Releases on this public repo (Linux: AppImage)
- [ ] Deploy the web changes (`lib/desktop.ts`, share audio path) to prod, then test the app against prod
