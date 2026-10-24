#!/usr/bin/env sh
# Writes a prod .env with fresh secrets. Refuses to overwrite an existing one.
set -eu

cd "$(dirname "$0")/.."

if [ -e .env ]; then
  echo ".env already exists, not touching it" >&2
  exit 1
fi

rand() { openssl rand -hex "$1"; }

umask 077
cat > .env <<EOF
LIVEKIT_URL=wss://sharr.calirko.com
LIVEKIT_API_KEY=API$(rand 6)
LIVEKIT_API_SECRET=$(rand 32)
LIVEKIT_API_URL=http://localhost:7880

DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
DISCORD_REDIRECT_URI=https://sharr.calirko.com/auth/discord/callback

REDIS_URL=redis://localhost:6379
PORT=3000
SESSION_SECRET=$(rand 32)
ROOM_IDLE_MINUTES=30
EOF

echo "wrote .env"
