#!/usr/bin/env bash
# Builds the desktop app here instead of on GitHub Actions and publishes the release.
#
#   scripts/release.sh            AppImage + Windows installer, then a GitHub release for the
#                                 version in tauri.conf.json (tag desktop-v<version>)
#   scripts/release.sh --build    same builds, no release
#   scripts/release.sh --debug    Windows debug installer only (console with the app log)
#
# Windows is cross-compiled with cargo-xwin. Needs: cargo-xwin (cargo install --locked cargo-xwin),
# the x86_64-pc-windows-msvc rust target, clang-cl, lld, cmake, ninja, makensis (AUR nsis), and
# for the release gh plus the signing key in ~/.tauri.
set -euo pipefail

cd "$(dirname "$0")/.."
mode=release
case "${1:-}" in
  "") ;;
  --build) mode=build ;;
  --debug) mode=debug ;;
  *) echo "usage: $0 [--build|--debug]" >&2; exit 1 ;;
esac

for t in cargo-xwin makensis clang-cl lld-link cmake ninja; do
  command -v "$t" >/dev/null || { echo "missing $t" >&2; exit 1; }
done

export CEF_PATH="${CEF_PATH:-$HOME/.cache/sharr-cef}"
export ANYLINUX_LIB_SOURCE=https://raw.githubusercontent.com/FabianLars/Anylinux-AppImages/3e280d1b2270fecfcb2c2c823b490c782ecf1277/useful-tools/lib/anylinux.c
export GTK_CLASS_FIX_SOURCE=https://raw.githubusercontent.com/FabianLars/Anylinux-AppImages/3e280d1b2270fecfcb2c2c823b490c782ecf1277/useful-tools/lib/gtk-class-fix.c
if [ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]; then
  TAURI_SIGNING_PRIVATE_KEY=$(cat ~/.tauri/sharr.key)
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD=$(cat ~/.tauri/sharr.key.password)
  export TAURI_SIGNING_PRIVATE_KEY TAURI_SIGNING_PRIVATE_KEY_PASSWORD
fi

version=$(jq -r .version src-tauri/tauri.conf.json)
tag="desktop-v$version"
if [ "$mode" = release ]; then
  command -v gh >/dev/null || { echo "missing gh" >&2; exit 1; }
  if gh release view "$tag" >/dev/null 2>&1; then
    echo "release $tag exists already, bump the version in tauri.conf.json" >&2
    exit 1
  fi
  # The tag goes on HEAD, which has to be on GitHub
  head=$(git rev-parse HEAD)
  git fetch -q origin
  git branch -r --contains "$head" | grep -q . || { echo "push $head first" >&2; exit 1; }
fi

bun install --frozen-lockfile

# CEF 154 no longer ships the ANGLE libraries the bundler still copies. Chromium doesn't load
# them, so empty files are enough. Runs after a build too, since that's when CEF gets downloaded.
placeholders() {
  for dir in "$CEF_PATH"/*/cef_*; do
    [ -d "$dir" ] || continue
    for f in libEGL.so libGLESv2.so libEGL.dll libGLESv2.dll; do
      case "$dir:$f" in *linux*:*.so | *windows*:*.dll) [ -e "$dir/$f" ] || : >"$dir/$f" ;; esac
    done
  done
}

win=x86_64-pc-windows-msvc
build_windows() {
  # Downloads CEF for Windows
  cargo xwin build --release --manifest-path src-tauri/Cargo.toml --target $win -p cef-dll-sys
  placeholders
  bun run tauri build --runner cargo-xwin --target $win --bundles nsis "$@"
}

build_linux() {
  cargo build --release --manifest-path src-tauri/Cargo.toml -p cef-dll-sys
  placeholders
  bun run tauri build --bundles appimage --config "$(scripts/appimage-libs.sh)"
}

if [ "$mode" = debug ]; then
  build_windows --debug
  ls -1 src-tauri/target/$win/debug/bundle/nsis/*-setup.exe
  exit 0
fi

build_linux
build_windows

dist=$(mktemp -d)
cp src-tauri/target/release/bundle/appimage/*.AppImage{,.sig} "$dist"/
cp src-tauri/target/$win/release/bundle/nsis/*-setup.exe{,.sig} "$dist"/
appimage=$(cd "$dist" && ls *.AppImage)
setup=$(cd "$dist" && ls *-setup.exe)
case "$appimage $setup" in *"$version"*"$version"*) ;; *) echo "bundles don't match $version: $appimage $setup" >&2; exit 1 ;; esac

if [ "$mode" = build ]; then
  ls -1 "$dist"/*
  exit 0
fi

base="https://github.com/calirko/sharr/releases/download/$tag"
jq -n \
  --arg v "$version" \
  --arg date "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg lsig "$(cat "$dist/$appimage.sig")" --arg lurl "$base/$appimage" \
  --arg wsig "$(cat "$dist/$setup.sig")" --arg wurl "$base/$setup" \
  '{version: $v, pub_date: $date, platforms: {
    "linux-x86_64": {signature: $lsig, url: $lurl},
    "windows-x86_64": {signature: $wsig, url: $wurl}}}' >"$dist/latest.json"
# Unversioned copies, for the web app's download links (releases/latest/download/...)
cp "$dist/$appimage" "$dist/sharr_amd64.AppImage"
cp "$dist/$setup" "$dist/sharr_x64-setup.exe"

gh release create "$tag" --target "$head" --title "sharr desktop $version" --notes "Desktop app $version" "$dist"/*
rm -rf "$dist"
