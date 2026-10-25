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
{
  for m in $modules; do
    echo "\"$dest/pipewire-0.3/libpipewire-module-$m.so\": \"$libdir/pipewire-0.3/libpipewire-module-$m.so\""
  done
  for p in $plugins; do
    echo "\"$dest/spa-0.2/support/$p.so\": \"$libdir/spa-0.2/support/$p.so\""
  done
  echo "\"$dest/config/client.conf\": \"/usr/share/pipewire/client.conf\""
  echo "\"lib/libpulse.so.0\": \"$(readlink -f "$libdir/libpulse.so.0")\""
} | paste -sd, - | sed 's/^/{"bundle":{"linux":{"appimage":{"files":{/; s/$/}}}}}/'
