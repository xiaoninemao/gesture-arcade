#!/bin/zsh

cd "$(dirname "$0")" || exit 1

PORT=4173
URL="http://localhost:${PORT}"

if ! lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  python3 -m http.server "$PORT" >/tmp/gesture-arcade.log 2>&1 &
  sleep 1
fi

open "$URL"
