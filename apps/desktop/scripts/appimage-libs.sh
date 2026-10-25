#!/bin/sh
# Prints a Tauri config with libraries the AppImage needs but the bundler misses, all taken from
# the build machine so they match what it bundles (the AppImage carries its own glibc, so host
# copies of these break):
# - PipeWire client modules and plugins, for system audio (the app points PipeWire at them)
# - libpulse, which Chromium loads at runtime for audio output
# - NSS's softokn and freebl, which NSS loads at runtime (Debian keeps them in nss/)
# Usage: tauri build --config "$(scripts/appimage-libs.sh)"
set -e
libdir=$(pkg-config --variable=libdir libpipewire-0.3)
here=$(cd "$(dirname "$0")" && pwd)

# One "dest": "source" pair per line, missing files skipped with a warning
entry() {
  if [ -e "$2" ]; then echo "\"$1\": \"$(readlink -f "$2")\""; else echo "appimage-libs: missing $2" >&2; fi
}

{
  for m in adapter client-device client-node metadata protocol-native rt session-manager; do
    entry "pipewire/pipewire-0.3/libpipewire-module-$m.so" "$libdir/pipewire-0.3/libpipewire-module-$m.so"
  done
  for p in libspa-support libspa-dbus libspa-journal; do
    entry "pipewire/spa-0.2/support/$p.so" "$libdir/spa-0.2/support/$p.so"
  done
  entry pipewire/config/client.conf "$here/pipewire-client.conf"
  entry lib/libpulse.so.0 "$libdir/libpulse.so.0"
  for n in libsoftokn3.so libfreeblpriv3.so; do
    src="$libdir/$n"
    [ -e "$src" ] || src="$libdir/nss/$n"
    entry "lib/$n" "$src"
    # Debian's libnss3 looks in nss/ next to itself
    entry "lib/nss/$n" "$src"
  done
} | paste -sd, - | sed 's/^/{"bundle":{"linux":{"appimage":{"files":{/; s/$/}}}}}/'
