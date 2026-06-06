# Statusline Quotes — Design

Date: 2026-06-06
Status: Approved (pending implementation)
Related: `2026-06-05-statusline-redesign-design.md`

## Goal

Add a third statusline line carrying a rotating quote from the user's favorite
media, books, and philosophy. The quote is chosen deterministically per session
so it is stable for the whole session and changes when a new session starts.

## Non-goals

- No per-render randomness (would flicker on every redraw).
- No changes to Line 1 (identity) or Line 2 (`ctx │ 5h │ Gielinor`).

## Overflow (revised 2026-06-06)

The earlier "curate short only" decision is reversed. A long quote is
**word-wrapped** onto additional rows (a 4th line, 5th, …) rather than
truncated — the full quote is always shown:

- Width source: `process.env.COLUMNS`, which Claude Code sets to the current
  terminal width before running the statusline command (v2.1.153+). The
  `playtime-statusline.sh` wrapper inherits the environment, so the renderer
  sees it. The statusline input JSON does NOT carry terminal width.
- `runStatusline` parses `COLUMNS` to an integer and subtracts a 1-column safety
  margin (built-in UI spacing). When `COLUMNS` is unset/invalid, width is
  unknown → the quote is emitted as a single line and the terminal wraps it
  naturally.
- `wrapText(text, maxWidth)` greedily word-wraps the plain (ANSI-free) quote to
  `maxWidth` columns and returns one array element per row; a word longer than a
  full line is hard-broken. Wrapping happens on the raw picked quote BEFORE
  color-wrapping, then each row is `DIM`/`RESET`-wrapped individually so the
  color never bleeds across line breaks and ANSI codes never count toward width.

## Behavior

- **Line 1** (identity + location + task): unchanged.
- **Line 2** (`ctx <bar> │ 5h <bar> │ Hours spent in Gielinor: <h>`): unchanged.
- **Line 3 (new)**: one dim-styled quote, e.g. `"What stands in the way becomes the way." —Marcus Aurelius`.
- If no quote is available (missing/empty/unparsable `quotes.md`), Line 3 is
  omitted and the statusline renders as two lines exactly as today.

## Rotation

Deterministic selection seeded by `session_id` (present in the statusline input
JSON):

- `index = hash(session_id) % quotes.length`
- Same session → same index on every redraw → zero flicker.
- New session → (very likely) a different quote.
- Missing/empty `session_id` → index `0`.

`hash` is a small deterministic string hash (e.g. FNV-1a or a char-code
accumulator). Cryptographic quality is not required; only stable distribution.

## Data source: `quotes.md`

`quotes.md` lives in the same directory as `statusline-render.js`
(`home/.claude/playtime/`, installed at `~/.claude/playtime/`). Path resolution
(revised 2026-06-06): the `playtime-statusline.sh` wrapper — which already
resolves its own dir (`DIR`) to locate `statusline-render.js` and
`statusline.conf` — passes `QUOTES_FILE="$DIR/quotes.md"` to the renderer.
`runStatusline` uses `process.env.QUOTES_FILE`, falling back to
`path.join(__dirname, 'quotes.md')` for direct invocation (e.g. tests). This
keeps quote resolution correct whether the statusline runs from the repo by
absolute path or from a stowed `~/.claude/playtime/`, since `quotes.md` is
always a sibling of the wrapper.

`loadQuotes(quotesPath)`:

1. Read the file as UTF-8. On any error → return `[]`.
2. Consider only the region **before** the line `# Recommended additional sources`.
   This keeps the staging samples in the recommendations section from ever
   appearing on the statusline, regardless of curation state.
3. From that region, take every line matching `^- "` (a curated quote bullet),
   strip the leading `- `, and trim. Return the resulting array.

This makes `quotes.md` a single human-editable source of truth: the user curates
by deleting bullet lines. Approved recommended sources get promoted above the
`# Recommended additional sources` marker before they go live.

## Selection: `pickQuote(quotes, session)`

- `quotes` empty → return `''`.
- Otherwise return `quotes[hash(session || '') % quotes.length]`.

## Composition

`composeLines` gains an optional `quote` field:

- `line1` and `line2` built exactly as today.
- `line3 = quote` (dim-wrapped) when non-empty.
- Output joins present lines with `\n`. With a quote and a Line 2 present:
  `line1\nline2\nline3`. Line 3 is dropped when `quote` is `''`; Line 2 is
  dropped when empty (existing behavior preserved).

## Wiring

`buildOutput(data, ctx)` and `runStatusline()`:

- `runStatusline` passes `quotesPath = process.env.QUOTES_FILE || path.join(__dirname, 'quotes.md')`
  (see Data source) and the existing `session` into `ctx`.
- `buildOutput` calls `loadQuotes(quotesPath)` then `pickQuote(quotes, session)`,
  passes the result to `composeLines` as `quote` (dim-wrapped, like `playtime`).

## Styling

Dim (`\x1b[2m … \x1b[0m`), matching the playtime segment. No icon/prefix.

## Error handling

Every new code path is best-effort and never throws:

- File missing/unreadable → `[]` → no Line 3.
- Empty quote list → `pickQuote` returns `''` → no Line 3.
- Missing `session_id` → index `0`.

The overall `runStatusline` already swallows errors so the bar never breaks.

## Testing (`statusline-render.test.js`)

- `loadQuotes`:
  - Parses `- "..."` bullets into trimmed strings.
  - Ignores headings, prose, and non-quote bullets.
  - **Stops at `# Recommended additional sources`** — samples below the marker
    are excluded.
  - Missing file → `[]`.
- `pickQuote`:
  - Deterministic: same `session_id` → same quote across calls.
  - Different `session_id` values map across the list (distribution sanity).
  - Empty array → `''`.
  - Missing/empty session → index `0` quote.
- `composeLines`:
  - With a quote → three lines, quote last.
  - Without a quote → unchanged two-line / one-line output.

## Files touched

- `home/.claude/playtime/statusline-render.js` — add `loadQuotes`, `pickQuote`,
  `hash`; extend `composeLines` and `buildOutput`; wire `quotesPath`/`session`.
- `home/.claude/playtime/statusline-render.test.js` — new tests above.
- `home/.claude/playtime/quotes.md` — already created; curation surface.

## Quote sources (curated in `quotes.md`)

Named by user: The Lord of the Rings, Tengen Toppa Gurren Lagann, Troy (2004),
300, The Matrix, Project Hail Mary, Meditations (Marcus Aurelius), Gladiator
(2000). Plus a recommendations staging section (Seneca, Epictetus, Musashi,
Henry V, Dune, Beowulf/Hávamál, Berserk, Attack on Titan, Old School RuneScape,
Dark Souls/Elden Ring, Halo) pending user approval.
