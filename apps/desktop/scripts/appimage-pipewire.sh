#!/bin/sh
# Prints a Tauri config that bundles the PipeWire client modules and plugins of the build machine
# into the AppImage. The AppImage ships its own libpipewire, which must not load the host's copies.
# Also bundles libpulse, which Chromium loads at runtime for audio output.
# Usage: tauri build --config "$(scripts/appimage-pipewire.sh)"
set -e
libdir=$(pkg-config --variable=libdir libpipewire-0.3)
modules="adapter client-device client-node metadata protocol-native rt session-manager"
plugins="libspa-support libspa-dbus libspa-journal"
dest=pipewire
# One "dest": "source" pair per line, missing files skipped with a warning
entry() {
  if [ -e "$2" ]; then echo "\"$1\": \"$2\""; else echo "appimage-pipewire: missing $2" >&2; fi
}
{
  for m in $modules; do
    entry "$dest/pipewire-0.3/libpipewire-module-$m.so" "$libdir/pipewire-0.3/libpipewire-module-$m.so"
  done
  for p in $plugins; do
    entry "$dest/spa-0.2/support/$p.so" "$libdir/spa-0.2/support/$p.so"
  done
  entry "$dest/config/client.conf" "$(cd "$(dirname "$0")" && pwd)/pipewire-client.conf"
  entry lib/libpulse.so.0 "$(readlink -f "$libdir/libpulse.so.0")"
} | paste -sd, - | sed 's/^/{"bundle":{"linux":{"appimage":{"files":{/; s/$/}}}}}/'
