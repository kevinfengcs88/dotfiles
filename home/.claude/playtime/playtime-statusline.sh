#!/usr/bin/env bash
# Playtime statusline wrapper.
#
# Runs your configured base statusline (statusline.conf -> INNER_STATUSLINE) and
# appends a "⏱ hours played" segment. Swap base statuslines by editing the conf;
# the playtime segment persists either way.
#
# Also doubles as the heartbeat writer (keeps the live counter accurate and
# bounds crashed sessions), and refreshes the union total cache in the
# background so renders stay fast.
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCAL="$HOME/.claude/playtime"
CACHE="$LOCAL/total.cache"
mkdir -p "$LOCAL/heartbeats" 2>/dev/null

INNER_STATUSLINE=""
[ -f "$DIR/statusline.conf" ] && source "$DIR/statusline.conf"

INPUT="$(cat)"

# 1) Base statusline (delegated). Empty config => playtime-only line.
BASE=""
if [ -n "${INNER_STATUSLINE:-}" ]; then
  BASE="$(printf '%s' "$INPUT" | eval "$INNER_STATUSLINE" 2>/dev/null)"
fi

# 2) Heartbeat (fast path; jq if present, sed fallback).
if command -v jq >/dev/null 2>&1; then
  SID="$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)"
else
  SID="$(printf '%s' "$INPUT" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
fi
[ -n "$SID" ] && date +%s > "$LOCAL/heartbeats/$SID" 2>/dev/null

# 3) Refresh union cache in background if stale (>60s).
NOW=$(date +%s)
STALE=1
if [ -f "$CACHE" ]; then
  MT=$(stat -c %Y "$CACHE" 2>/dev/null || echo 0)
  [ $((NOW - MT)) -lt 60 ] && STALE=0
fi
[ "$STALE" = "1" ] && ( python3 "$DIR/playtime.py" refresh-cache >/dev/null 2>&1 & )

PLAY="$(cat "$CACHE" 2>/dev/null || echo '⏱ 0h')"

if [ -n "$BASE" ]; then
  printf '%s | %s' "$BASE" "$PLAY"
else
  printf '%s' "$PLAY"
fi
