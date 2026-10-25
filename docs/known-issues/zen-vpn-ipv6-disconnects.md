# Zen keeps disconnecting with a VPN up on an IPv6 network

Status: open, local network setup, not a sharr bug as far as we can tell. Found 2026-10-24
while testing M3 on prod.

## Symptom

In Zen, joining a room on `https://sharr.calirko.com` never gets a media connection while
a VPN (WireGuard) interface is up. The join ends after about 15 seconds with
`SIGNAL_SOURCE_CLOSE`, and the room shows "Disconnected". Rejoining does the same thing.
Chrome on the same machine connects fine, with the VPN up or down. Zen connects fine once
the VPN is down.

## Environment

| | |
|---|---|
| OS | Arch Linux, kernel 7.2.8-arch1-2 |
| Browser | Zen 1.23b (Firefox 157) |
| Network | LAN with native IPv6 (global address and default route via router advertisement) plus IPv4 behind NAT |
| VPN | WireGuard interface up |
| Server | LiveKit on prod, ICE over UDP 7882 / TCP 7881, TURN on UDP 3478. Only IPv4 is forwarded to it (`use_external_ip` advertises the IPv4 found through STUN) |

## What we think happens

Not verified yet. LiveKit only offers IPv4 candidates, and the router only forwards IPv4.
With the VPN up, Firefox's ICE seems to gather candidates on the VPN interface and on IPv6,
and to try those first. None of them can reach the server, so the connection never comes
up and LiveKit gives up after its 15 second timeout. Chrome orders and filters candidates
differently and still finds the plain IPv4 path. The signaling websocket goes through the
Cloudflare tunnel, which is why the page loads and the join starts at all.

## Workaround

In Zen, open `about:config` and set `media.peerconnection.ice.force_interface` to the LAN
interface (here `enp7s0`). Firefox then gathers ICE candidates only on that interface.
Alternatives: turn the VPN off while in a room, or use Chrome or the desktop app (Chromium).

## Repro

1. Machine on a network with native IPv6, WireGuard interface up.
2. Zen: open a room on `https://sharr.calirko.com`.
3. The join hangs and ends after about 15 seconds with `SIGNAL_SOURCE_CLOSE`.
4. Bring the VPN down, or set `media.peerconnection.ice.force_interface`, and it connects.

## Still to check

- [ ] Capture `about:webrtc` in Zen during a failed join: which candidate pairs were tried and which interface they came from
- [ ] IPv6 off with the VPN up (`network.dns.disableIPv6`, or IPv6 off on the interface), to tell whether the VPN or IPv6 is the trigger
- [ ] Same steps in plain Firefox, to rule out Zen itself
- [ ] Whether giving LiveKit an IPv6 address (and forwarding it) makes the problem go away

## Where to report

If it reproduces in plain Firefox with a bare WebRTC page, Mozilla's bug tracker
(Core :: WebRTC: Networking). Otherwise Zen's GitHub issues.
