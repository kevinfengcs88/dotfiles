#!/usr/bin/env bash
# Playtime statusline wrapper.
#
# Writes the per-session heartbeat, refreshes the playtime union cache in the
# background, then renders the two-line statusline via statusline-render.js.
# The playtime hours are passed to the renderer through $GIELINOR_HOURS.
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCAL="$HOME/.claude/playtime"
CACHE="$LOCAL/total.cache"
RENDER="$DIR/statusline-render.js"
mkdir -p "$LOCAL/heartbeats" 2>/dev/null

# Resolve NODE_BIN (and any other config).
NODE_BIN=""
[ -f "$DIR/statusline.conf" ] && source "$DIR/statusline.conf"

INPUT="$(cat)"

# 1) Heartbeat (fast path; jq if present, sed fallback).
if command -v jq >/dev/null 2>&1; then
  SID="$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)"
else
  SID="$(printf '%s' "$INPUT" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
fi
[ -n "$SID" ] && date +%s > "$LOCAL/heartbeats/$SID" 2>/dev/null

# 2) Refresh union cache in background if stale (>60s).
NOW=$(date +%s)
STALE=1
if [ -f "$CACHE" ]; then
  MT=$(stat -c %Y "$CACHE" 2>/dev/null || echo 0)
  [ $((NOW - MT)) -lt 60 ] && STALE=0
fi
[ "$STALE" = "1" ] && ( python3 "$DIR/playtime.py" refresh-cache >/dev/null 2>&1 & )

PLAY="$(cat "$CACHE" 2>/dev/null || echo '⏱ 0h')"

# 3) Render the two-line statusline, or degrade to a playtime-only line.
OUT=""
if [ -n "${NODE_BIN:-}" ] && [ -x "${NODE_BIN}" ] && [ -f "$RENDER" ]; then
  OUT="$(printf '%s' "$INPUT" | GIELINOR_HOURS="$PLAY" QUOTES_FILE="$DIR/quotes.md" "$NODE_BIN" "$RENDER" 2>/dev/null)"
fi
if [ -n "$OUT" ]; then
  printf '%s' "$OUT"
else
  printf 'Hours spent in Gielinor: %s' "${PLAY#⏱ }"
fi
