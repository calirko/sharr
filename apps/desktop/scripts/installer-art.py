#!/usr/bin/env python3
# Draws the NSIS installer bitmaps (sidebar and header) from the app icon.
# Run from the repo root: python3 apps/desktop/scripts/installer-art.py
# Needs Pillow and numpy, and `bun install` for the fonts.
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parents[3]
icon = Image.open(root / "apps/desktop/src-tauri/icons/icon.png").convert("RGBA")
fonts = root / "apps/web/node_modules/@fontsource-variable"
out = root / "apps/desktop/src-tauri/nsis"
out.mkdir(exist_ok=True)

BG = (10, 10, 10)  # dark --background, oklch(0.145 0 0)
FG = (250, 250, 250)
MUTED = (161, 161, 161)
S = 4  # supersampling


def font(name, size, weight):
    f = ImageFont.truetype(str(fonts / name / f"files/{name}-latin-wght-normal.woff2"), size * S)
    f.set_variation_by_axes([weight])
    return f


def grain(w, h, seed=7):
    # Same idea as --grain in index.css: fractal noise, alpha = 1.6 * n - 0.55, at 12%
    rng = np.random.default_rng(seed)
    n = np.zeros((h, w))
    amp, total = 1.0, 0.0
    for scale in (1, 2, 4):
        layer = rng.random((h // scale + 1, w // scale + 1))
        layer = np.kron(layer, np.ones((scale, scale)))[:h, :w]
        n += layer * amp
        total += amp
        amp /= 2
    n /= total
    return np.clip(1.6 * n - 0.55, 0, 1) * 0.12


def finish(img, noise):
    w, h = img.size[0] // S, img.size[1] // S
    px = np.asarray(img.resize((w, h), Image.LANCZOS).convert("RGB"), dtype=float)
    if noise:
        a = grain(w, h)[..., None]
        px = px * (1 - a) + 255 * a
    return Image.fromarray(px.round().astype(np.uint8), "RGB")


def sidebar():
    w, h = 164, 314
    img = Image.new("RGB", (w * S, h * S), BG)
    d = ImageDraw.Draw(img)
    size = 56
    x, y = 24, 120
    img.paste(icon.resize((size * S, size * S), Image.LANCZOS), (x * S, y * S), icon.resize((size * S, size * S), Image.LANCZOS))
    d.text((x * S, (y + size + 14) * S), "sharr", font=font("space-grotesk", 26, 600), fill=FG)
    d.text((x * S, (y + size + 48) * S), "screen sharing", font=font("inter", 11, 400), fill=MUTED)
    finish(img, True).save(out / "sidebar.bmp")


def header():
    w, h = 150, 57
    img = Image.new("RGB", (w * S, h * S), (255, 255, 255))
    d = ImageDraw.Draw(img)
    size = 32
    x, y = 12, (h - size) // 2
    ic = icon.resize((size * S, size * S), Image.LANCZOS)
    img.paste(ic, (x * S, y * S), ic)
    f = font("space-grotesk", 18, 600)
    top = f.getbbox("sharr")
    d.text(((x + size + 10) * S, h * S / 2 - (top[1] + top[3]) / 2), "sharr", font=f, fill=(38, 38, 38))
    finish(img, False).save(out / "header.bmp")


sidebar()
header()
