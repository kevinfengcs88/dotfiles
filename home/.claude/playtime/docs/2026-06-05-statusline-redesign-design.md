# Statusline Redesign — Design

**Date:** 2026-06-05
**Status:** Approved, ready for implementation planning

## Goal

Enrich the current minimalist GSD-based statusline with more at-a-glance
information (git branch, reasoning effort, 5-hour usage) while preserving its
minimalism, and add a RuneScape-flavored text label to the existing playtime
counter. The well-loved context bar and its color thresholds are preserved
(with one threshold tweak).

## Current state

`settings.json` points `statusLine.command` at the user-owned wrapper:

```
bash "$HOME/dotfiles/home/.claude/playtime/playtime-statusline.sh"
```

The wrapper (`playtime-statusline.sh`) currently:
1. Sources `statusline.conf`, which sets `INNER_STATUSLINE` to
   `node ~/.claude/hooks/gsd-statusline.js` (when GSD + node are present).
2. Runs the inner statusline, captures its single-line output as `BASE`.
3. Writes a per-session heartbeat and refreshes the playtime union cache in the
   background.
4. Appends ` | ⏱ <N>h` (read from `~/.claude/playtime/total.cache`).

`gsd-statusline.js` renders a single line:
`model │ (todo task OR GSD milestone·status·phase) │ dirname [context bar]`
with the context bar colored green `<50` / yellow `<65` / orange `<80` /
blinking 💀 red `>=80`.

### Directory ownership (verified)

- **GSD-owned, overwritten on `/gsd-update`:** `~/.claude/hooks/gsd-statusline.js`
  (it is in GSD's `BUNDLED_GSD_HOOK_FILES` set).
- **User-owned, invisible to GSD:** everything under
  `~/dotfiles/home/.claude/playtime/` (scripts, conf, `playtime.py`) — outside
  GSD's managed `hooks/` directory. GSD's installer explicitly refuses to remove
  non-whitelisted files ("silent data loss" guard).
- **Runtime data (separate real dir):** `~/.claude/playtime/`
  (`total.cache`, `heartbeats/`, `open/`). Not a symlink to dotfiles.
- **`settings.json` statusLine pointer:** the GSD installer contains no code that
  writes the `statusLine` key; it only ever manages commands whose basename is
  one of its own (e.g. `gsd-statusline.js`). The user's pointer
  (`playtime-statusline.sh`) is not managed and is left untouched. It has
  already survived prior updates.

## Final layout (two lines)

Full state (git repo, effort active, Pro/Max usage available):

```
Opus 4.8 │ main │ ~/dotfiles/home/.claude            effort: high
executing · auth (2/5) │ ctx ▓▓▓░░░░░░░ 38% │ 5h ▓▓░░░░░░░░ 22% │ Hours spent in Gielinor: 66h
```

Degraded state (not a git repo, no effort param, not Pro/Max, no task/GSD):

```
Opus 4.8 │ ~/some/dir
ctx ▓▓▓░░░░░░░ 38% │ Hours spent in Gielinor: 66h
```

- **Line 1 — identity + location:** `model │ branch │ path` with **`effort` flush-right** (padded to the terminal edge via the `COLUMNS` env var; falls back to ` │ effort` at end-of-line when width is unknown)
- **Line 2 — meters + playtime:** `middle │ ctx-bar │ 5h-bar │ Hours spent in Gielinor: Nh`
- Separator is ` │ ` (matches current style). Any absent segment is dropped
  cleanly — never render an empty ` │ │ `.

## Segments and data sources

| Segment | Source | Style / behavior |
|---|---|---|
| Model | `model.display_name` | dim |
| Effort | `effort.level` | `effort: <level>`, **color-coded by level**, **flush-right on line 1** (via `COLUMNS`; end-of-line fallback); hidden when absent (model without effort param) |
| Branch | `git rev-parse --abbrev-ref HEAD` in cwd | **bare branch name, no glyph/marker**; hidden outside a repo and on detached HEAD |
| Path | `workspace.current_dir` | `$HOME` collapsed to `~`; if deeper than 3 segments show `…/last/two/three`; dim |
| Middle | active todo (bold) **or** GSD state (dim) | reuses GSD parsers via guarded require; hidden when neither present |
| ctx bar | `context_window.used_percentage` | existing 10-segment bar; thresholds below; labeled `ctx` |
| 5h bar | `rate_limits.five_hour.used_percentage` | same bar shape + same thresholds; labeled `5h`; hidden when absent (free tier / pre-first-response) |
| Playtime | `~/.claude/playtime/total.cache` (icon stripped) | `Hours spent in Gielinor: Nh` |

### Effort color mapping

| Level | Color |
|---|---|
| low / medium | green |
| high | yellow |
| xhigh | orange |
| max | red |

(`xhigh` also covers Ultracode, which reports as `xhigh`.)

## Threshold colors (shared by ctx and 5h bars)

| Used % | Color |
|---|---|
| `< 40` | green |
| `40–64` | yellow |
| `65–79` | orange |
| `>= 80` | blinking red, prefixed with 💀 |

The only change from the current statusline is the green cutoff moving from
`< 50` to `< 40`. The same threshold logic is reused for the new 5h usage bar.

ANSI codes (preserved from the current implementation):
- green `\x1b[32m`, yellow `\x1b[33m`, orange `\x1b[38;5;208m`,
  blinking red `\x1b[5;31m` (with leading `💀 `), reset `\x1b[0m`, dim `\x1b[2m`,
  bold `\x1b[1m`.

## Architecture

### New renderer (user-owned)

`~/dotfiles/home/.claude/playtime/statusline-render.js` — a Node script that
reads the Claude Code statusline JSON on stdin and prints the two lines. It owns:

- model / effort / branch / path formatting
- todo-task detection (newest matching `~/.claude/todos/<session>-agent-*.json`,
  picking the `in_progress` item's `activeForm`)
- context bar (with the new `< 40` green threshold)
- 5h usage bar (same bar + thresholds)
- the context-monitor **bridge-file write** — replicated from
  `gsd-statusline.js` so the existing low-context PostToolUse warning keeps
  firing. Writes `os.tmpdir()/claude-ctx-<session>.json` with
  `{ session_id, remaining_percentage, used_pct: round(100 - remaining), timestamp }`,
  guarding against session IDs containing path separators or `..`.

### Guarded require of GSD parsers

The renderer obtains the GSD milestone/phase middle segment by `require()`-ing
`~/.claude/hooks/gsd-statusline.js` and calling its exported `readGsdState(dir)`
and `formatGsdState(state)`. Because that file is overwritten on every
`/gsd-update`, the require is defensive:

1. `try/catch` around the `require` and every call.
2. Feature-detect: only use it when
   `typeof mod.readGsdState === 'function' && typeof mod.formatGsdState === 'function'`.
3. Check the `// gsd-hook-version:` header in the file; if the major version is
   beyond a known-good ceiling we have not validated, skip the GSD middle.
4. On any failure, **degrade to "no GSD middle"** — the todo-task path (which is
   entirely ours) still works, so the middle simply falls back to the active
   todo or nothing.

This keeps the design DRY (no duplicated parser) while ensuring a GSD update can
at worst remove the milestone/phase text, never break the statusline.

### Wrapper changes

`playtime-statusline.sh` keeps its existing responsibilities — read stdin once,
write the per-session heartbeat, refresh the union cache in the background — and
changes how it renders:

- Instead of running `INNER_STATUSLINE` and appending playtime to a single line,
  it pipes the captured stdin JSON into `statusline-render.js`.
- It passes the playtime string (cache value with the `⏱ ` icon stripped) to the
  renderer via an environment variable (e.g. `GIELINOR_HOURS`).
- It prints the renderer's two-line output verbatim.

### Portability / degradation

`statusline.conf` is repurposed for portability:
- node present, GSD present → full two-line output.
- node present, GSD absent or API changed → two lines, GSD middle omitted.
- node absent entirely → fall back to a playtime-only single line (preserving
  today's clean Mac-without-GSD behavior).

### Rejected alternatives

- **Edit `gsd-statusline.js` directly** — wiped on every `/gsd-update`; not
  user-owned.
- **String-munge the inner statusline's rendered ANSI output in the wrapper** —
  brittle; cannot cleanly split into two lines or inject new segments.
- **Vendor (copy) GSD's STATE.md parser** — fully decouples from GSD code but
  duplicates ~100 lines that would silently drift if GSD changes the STATE.md
  format. Rejected in favor of the guarded require.
- **Drop the GSD middle entirely** — simplest, but loses the milestone/phase
  at-a-glance the user values.

## Edge cases

- `used_percentage` is `null` early in a session and right after `/compact` →
  context bar hidden (do not render `0%`).
- `rate_limits` absent (free tier, or before the first API response) →
  5h bar hidden.
- Line 2 empty except playtime → still print the playtime segment.
- Branch detection failure / detached HEAD / not a repo → branch hidden, no
  error output.
- Renderer must never emit anything to stderr that would corrupt the statusline;
  all failures degrade silently.

## Out of scope

- 7-day usage window (only 5-hour was requested).
- Rate-limit reset countdowns.
- Changing the playtime tracker logic in `playtime.py`.
- Any change to GSD-owned files.
