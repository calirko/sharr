# Green frames when sharing on Hyprland (xdg-desktop-portal-hyprland)

Status: open, not reported upstream yet. Found 2026-10-24 while testing M3 locally.

## Symptom

Sharing the whole screen from Firefox works at first. After switching to another
Hyprland workspace and coming back to the one being shared, the shared picture
turns solid green and breaks. Screen recording also stops working at the same
time. Recorders like OBS use the same portal, so this points below the browser.

The share can also stop on its own. Each time, the portal log shows the stream
being torn down right after the errors (`Stream destroyed`, `Session destroyed`,
then a new session). When the portal destroys the stream, the browser ends the
capture track, which looks exactly like pressing the browser's own "Stop sharing",
so LiveKit unpublishes the share. A web page can't restart capture without the
user picking a source again. Seen at 20:24:36 and 20:31:09.

## Environment

| | |
|---|---|
| OS | Arch Linux, kernel 7.2.8-arch1-2 |
| Compositor | Hyprland 0.56.2-4 (Wayland) |
| Portal | xdg-desktop-portal 1.22.1-2, xdg-desktop-portal-hyprland 1.4.1-2, xdg-desktop-portal-gtk 1.15.3-1 |
| PipeWire | pipewire 1.6.9-1, wireplumber 0.5.18-1 |
| GPU | AMD Radeon RX 7600 (Navi 33), mesa 26.2.4-1 |
| Browser | Firefox 157.0 |
| Source | whole output `HDMI-A-1` |

## Portal log

From `journalctl --user`, at the moment sharing started:

```
[LOG] [sc] Selection: /screen:HDMI-A-1
[ERR] [screencopy] tried scheduling on already scheduled cb (type 0)
[ERR] [pw] DMA-BUF fixation failed after 2 attempts, falling back to SHM
[WARN] [pw] DMA-BUF allocation failed, falling back to SHM
[WARN] [pipewire] Asked for a wl_shm buffer which is legacy.   (x4)
[ERR] [screencopy] tried scheduling on already scheduled cb (type 0)
[LOG] [screencopy] Stream destroyed
[LOG] [screencopy] New session:
[LOG] [sc] Selection: /screen:HDMI-A-1
```

Reading: Firefox and the portal fail to agree on a DMA-BUF format, the portal
falls back to SHM buffers, and its frame scheduling hits a double-schedule error.
Solid green is what an empty or misread YUV frame looks like. Leaving and
returning to the workspace stops and restarts frame delivery, which is when the
picture breaks.

## Why it's not sharr

On Wayland the browser gets frames from the portal over PipeWire, and the page only
calls `getDisplayMedia`. sharr never touches the capture buffers. Recording
breaking at the same time also rules out the app.

## Repro

1. Hyprland session with xdg-desktop-portal-hyprland.
2. Firefox: open a sharr room, Share, pick the whole screen (`HDMI-A-1`).
3. Switch to another workspace, then back.
4. The shared picture goes green.

## Still to check before reporting

- [ ] Same steps in Chrome/Chromium (different PipeWire buffer negotiation)
- [ ] Sharing a single window instead of the whole output
- [ ] Latest xdg-desktop-portal-hyprland; search its issues for "DMA-BUF fixation failed" / green frames
- [ ] Repro with a plain WebRTC test page (e.g. a bare `getDisplayMedia` preview) to show it without sharr
- [ ] Repro with OBS PipeWire capture, to report without any browser involved

## Where to report

xdg-desktop-portal-hyprland's GitHub issues, with the environment, log and repro
above. If it only happens in Firefox, also Mozilla's bug tracker (WebRTC / Wayland).
