#!/usr/bin/env bash
# Builds the AppImage in an Ubuntu 24.04 container, like CI did. The AppImage tooling picks up
# host files, which breaks on Arch. Bundles land in the directory given as $1.
# Needs TAURI_SIGNING_PRIVATE_KEY and _PASSWORD in the environment.
set -euo pipefail

out=$(realpath "${1:?usage: $0 <out dir>}")
repo=$(cd "$(dirname "$0")/../../.." && pwd)
mkdir -p "$out"

# Caches live in named volumes, so later builds are incremental
docker run --rm \
  -v "$repo":/repo:ro \
  -v "$out":/out \
  -v sharr-build-rustup:/root/.rustup \
  -v sharr-build-cargo:/root/.cargo \
  -v sharr-build-target:/build/apps/desktop/src-tauri/target \
  -v sharr-build-cef:/cef \
  -e TAURI_SIGNING_PRIVATE_KEY -e TAURI_SIGNING_PRIVATE_KEY_PASSWORD \
  -e HOST_UID="$(id -u)" -e HOST_GID="$(id -g)" \
  ubuntu:24.04 bash -euo pipefail -c '
export DEBIAN_FRONTEND=noninteractive CEF_PATH=/cef PATH=/root/.cargo/bin:/root/.bun/bin:$PATH
export ANYLINUX_LIB_SOURCE=https://raw.githubusercontent.com/FabianLars/Anylinux-AppImages/3e280d1b2270fecfcb2c2c823b490c782ecf1277/useful-tools/lib/anylinux.c
export GTK_CLASS_FIX_SOURCE=https://raw.githubusercontent.com/FabianLars/Anylinux-AppImages/3e280d1b2270fecfcb2c2c823b490c782ecf1277/useful-tools/lib/gtk-class-fix.c
apt-get update -qq
apt-get install -y -qq curl unzip git file build-essential pkg-config cmake ninja-build jq rsync \
  libgtk-4-dev libpipewire-0.3-dev libpipewire-0.3-modules libspa-0.2-modules libpulse0 libclang-dev patchelf \
  libgl1 libegl1 libgles2 libgl1-mesa-dri libglx-mesa0 libegl-mesa0 \
  libnss3 libnspr4 libasound2t64 libgbm1 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 \
  libxfixes3 libxext6 libcups2t64 libdbus-1-3 libatk1.0-0t64 libatk-bridge2.0-0t64 libatspi2.0-0t64 \
  libpango-1.0-0 libcairo2 xvfb xauth >/dev/null
command -v cargo >/dev/null || curl -sSf https://sh.rustup.rs | sh -s -- -y -q --profile minimal
command -v bun >/dev/null || curl -fsSL https://bun.sh/install | bash >/dev/null

# A copy of the repo, without the hosts build output
rsync -a --exclude target --exclude node_modules --exclude dist /repo/ /build/
cd /build/apps/desktop
bun install --frozen-lockfile
cargo build -q --release --manifest-path src-tauri/Cargo.toml -p cef-dll-sys
for dir in "$CEF_PATH"/*/cef_*; do
  [ -d "$dir" ] || continue
  case "$dir" in *linux*) for f in libEGL.so libGLESv2.so; do [ -e "$dir/$f" ] || : >"$dir/$f"; done ;; esac
done
rm -rf src-tauri/target/release/bundle/appimage
# The GitHub runner image had these preinstalled; say what is still missing
cargo build -q --release --manifest-path src-tauri/Cargo.toml
for f in src-tauri/target/release/sharr "$CEF_PATH"/*/cef_linux*/libcef.so; do
  ldd "$f" | grep "not found" | sed "s|^|$(basename "$f"): |" || true
done
bun run tauri build --bundles appimage --config "$(scripts/appimage-libs.sh)"
cp src-tauri/target/release/bundle/appimage/*.AppImage src-tauri/target/release/bundle/appimage/*.AppImage.sig /out/
chown "$HOST_UID:$HOST_GID" /out/*
'
