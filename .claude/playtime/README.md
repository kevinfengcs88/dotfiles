# Claude Code Playtime Tracker

RuneScape-style "hours played" for Claude Code. Counts wall-clock time you have
Claude Code open — **AFK included** — measured as the **union** of all open
intervals, never a sum. Five CLIs idling for 24h = **24h**, not 120h. Overlap
across multiple CLIs and multiple machines collapses to real wall-clock.

## Usage

```sh
playtime              # total / today / this week
playtime --by-day 14  # last 14 days, bar chart
playtime --by-week 8  # last 8 weeks
playtime backfill     # reconstruct from ~/.claude/history.jsonl (idempotent)
```

`playtime` is a symlink in `~/.local/bin` → `playtime.py`.

## How it works

- **Forward (exact):** `SessionStart` opens an interval, `SessionEnd` finalizes
  `[start, end]`. Pure wall-clock, so AFK between open and quit/clear counts.
  Wired via hooks in `~/.claude/settings.json`.
- **Backfill (estimate):** reconstructs history from `~/.claude/history.jsonl`,
  which only has prompt timestamps — no open/close events. So it splits each
  session into activity bursts wherever prompts are >30min apart (assumes the
  app was closed during big gaps) and pads each burst by 5min. This is a
  conservative floor; forward tracking is exact. Runs automatically on every
  `SessionStart`, so a **late dotfiles install on a new machine catches up by
  itself**. Tune `BACKFILL_GAP_SEC` in `playtime.py` upward to count large AFK
  gaps as playtime.
- **Crashes:** the statusline writes a heartbeat per render. If a terminal is
  killed with no `SessionEnd`, the next `SessionStart` sweeps the dangling
  marker and finalizes it at the last heartbeat (bounded, never runaway).

## Storage

- `data/sessions-<host>.jsonl` — append-only finalized intervals, **one file per
  machine**. Committed to dotfiles → synced across machines automatically. The
  report globs `sessions-*.jsonl` and unions across all hosts.
- `~/.claude/playtime/` — local, ephemeral runtime state (heartbeats, open
  markers, `total.cache`). Not synced.

Env overrides: `PLAYTIME_DATA_DIR`, `PLAYTIME_LOCAL_DIR`.

## Cross-machine sync

Each machine writes only its own `sessions-<host>.jsonl`, so there are no merge
conflicts. To combine playtime across machines, just commit + push your dotfiles
on each, and pull on the others — the union report does the rest.

## New machine setup

The engine files are referenced in-place from the repo, so paths are portable
(`$HOME` / relative to the script). After `git pull`:

1. **CLI** — the `playtime` alias lives in `.zshrc` (synced). Just open a new
   shell (or `source ~/.zshrc`). No per-machine symlink needed.

2. **Hooks + statusline** — only needed if you want live/forward tracking on
   that machine. If its `~/.claude/settings.json` is *not* symlinked to this
   repo (e.g. the Mac uses a separate per-machine file), add these entries to
   that machine's settings.json:

   ```jsonc
   // under "hooks":
   "SessionStart": [
     { "hooks": [ { "type": "command",
       "command": "python3 \"$HOME/dotfiles/.claude/playtime/playtime.py\" session-start",
       "timeout": 15 } ] }
   ],
   "SessionEnd": [
     { "hooks": [ { "type": "command",
       "command": "python3 \"$HOME/dotfiles/.claude/playtime/playtime.py\" session-end",
       "timeout": 10 } ] }
   ],
   // top level:
   "statusLine": { "type": "command",
     "command": "bash \"$HOME/dotfiles/.claude/playtime/playtime-statusline.sh\"" }
   ```

   `backfill` still runs even without hooks (it's invoked on session-start, and
   you can run `playtime backfill` manually any time), so the CLI report works
   on a new machine immediately after the first `git pull`.

Requires `python3` (present on macOS and Linux).

## Statusline

`playtime-statusline.sh` is the configured statusline command. It runs your
**base** statusline, then appends `⏱ <hours>`. To swap base statuslines, edit
the single `INNER_STATUSLINE` line in `statusline.conf` — the playtime segment
persists. Set it to `''` to show only the tracker.
