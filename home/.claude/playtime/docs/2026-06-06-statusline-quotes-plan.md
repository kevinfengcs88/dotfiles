# Statusline Quotes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third statusline line that shows one quote, chosen deterministically from `session_id` so it is stable all session and rotates on a new session.

**Architecture:** Extend the existing pure-function renderer `statusline-render.js`. Three new pure helpers — `hash` (stable string hash), `loadQuotes` (parse curated bullets from `quotes.md`), `pickQuote` (deterministic per-session selection) — feed an optional third line through the existing `composeLines`/`buildOutput`/`runStatusline` chain. Every new path is best-effort and degrades to the current two-line output.

**Tech Stack:** Node.js (CommonJS), `node:test` + `node:assert/strict` (already the project's test setup). No new dependencies.

---

## File Structure

- `home/.claude/playtime/statusline-render.js` (modify) — add `hash`, `loadQuotes`, `pickQuote`; extend `composeLines`, `buildOutput`, `runStatusline`; add the three functions to `module.exports`.
- `home/.claude/playtime/statusline-render.test.js` (modify) — add unit tests for the three new functions and the 3-line `composeLines`; update the end-to-end test (it currently asserts exactly two output lines).
- `home/.claude/playtime/quotes.md` (already exists) — runtime data, read by `loadQuotes`. No code changes here.

**Runtime path note:** the statusline runs from the repo by absolute path (`~/.claude/settings.json` → `$HOME/dotfiles/home/.claude/playtime/playtime-statusline.sh`), so inside `statusline-render.js` `__dirname` is `/home/kevin/dotfiles/home/.claude/playtime` and `path.join(__dirname, 'quotes.md')` resolves to the committed file.

**How to run tests** (all tasks use this directory):

```bash
cd /home/kevin/dotfiles/home/.claude/playtime
```

Full suite: `node --test statusline-render.test.js`
Single group: `node --test --test-name-pattern="pickQuote" statusline-render.test.js`

---

## Task 1: Deterministic selection (`hash` + `pickQuote`)

**Files:**
- Modify: `/home/kevin/dotfiles/home/.claude/playtime/statusline-render.js`
- Test: `/home/kevin/dotfiles/home/.claude/playtime/statusline-render.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `statusline-render.test.js` (before the final `runStatusline end-to-end` test is fine; order does not matter):

```javascript
test('hash: deterministic and stable for a given string', () => {
  assert.equal(R.hash('e2e-test'), R.hash('e2e-test'));
  assert.equal(typeof R.hash('abc'), 'number');
  assert.ok(R.hash('abc') >= 0); // unsigned
  assert.notEqual(R.hash('aaa'), R.hash('aab'));
});

test('pickQuote: empty list returns empty string', () => {
  assert.equal(R.pickQuote([], 'sess'), '');
  assert.equal(R.pickQuote(undefined, 'sess'), '');
});

test('pickQuote: deterministic per session, in-range', () => {
  const quotes = ['a', 'b', 'c', 'd', 'e'];
  const first = R.pickQuote(quotes, 'session-123');
  assert.equal(first, R.pickQuote(quotes, 'session-123')); // stable
  assert.ok(quotes.includes(first)); // in range
});

test('pickQuote: missing session falls back to index 0', () => {
  const quotes = ['first', 'second', 'third'];
  assert.equal(R.pickQuote(quotes, ''), 'first');
  assert.equal(R.pickQuote(quotes, undefined), 'first');
});

test('pickQuote: different sessions spread across the list', () => {
  const quotes = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const seen = new Set();
  for (let i = 0; i < 50; i++) seen.add(R.pickQuote(quotes, 'sess-' + i));
  assert.ok(seen.size >= 3); // not all collapsing to one bucket
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test --test-name-pattern="hash:|pickQuote" statusline-render.test.js`
Expected: FAIL — `R.hash is not a function` / `R.pickQuote is not a function`.

- [ ] **Step 3: Implement `hash` and `pickQuote`**

In `statusline-render.js`, add these two functions just above `function formatModel` (any module-scope location works). `hash` is FNV-1a, returned unsigned:

```javascript
// Deterministic 32-bit FNV-1a hash of a string. Stable across runs and
// platforms; used to map session_id to a quote index. Returns an unsigned int.
function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Deterministic per-session quote selection. Empty/absent list => ''.
// Missing session => index 0.
function pickQuote(quotes, session) {
  if (!quotes || quotes.length === 0) return '';
  const idx = hash(session || '') % quotes.length;
  return quotes[idx];
}
```

Then add both to `module.exports` (extend the existing object literal):

```javascript
module.exports = {
  renderBar, formatEffort, formatModel, shortenPath, formatPath,
  formatPlaytime, composeLines, buildOutput, detectBranch,
  readActiveTask, getGsdMiddle, writeBridge,
  hash, loadQuotes, pickQuote,
};
```

> Note: `loadQuotes` is added in Task 2. Listing it in `module.exports` now would throw `ReferenceError` because the function does not exist yet. So in THIS task add only `hash, pickQuote` to the exports line:
>
> ```javascript
>   hash, pickQuote,
> ```
>
> Task 2 changes it to `hash, loadQuotes, pickQuote,`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test --test-name-pattern="hash:|pickQuote" statusline-render.test.js`
Expected: PASS (all 5 new tests).

- [ ] **Step 5: Commit**

```bash
cd /home/kevin/dotfiles
git add home/.claude/playtime/statusline-render.js home/.claude/playtime/statusline-render.test.js
git commit -m "feat(statusline): add hash + pickQuote for per-session quote selection"
```

---

## Task 2: Quote parser (`loadQuotes`)

**Files:**
- Modify: `/home/kevin/dotfiles/home/.claude/playtime/statusline-render.js`
- Test: `/home/kevin/dotfiles/home/.claude/playtime/statusline-render.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `statusline-render.test.js`:

```javascript
test('loadQuotes: parses "- \\"..\\"" bullets, ignores headings/prose', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-quotes-'));
  try {
    const f = path.join(tmp, 'quotes.md');
    fs.writeFileSync(f,
      '# Title\n\nSome prose.\n\n## Source\n\n' +
      '- "First quote." —A\n' +
      '- "Second quote." —B\n' +
      '- a non-quote bullet\n');
    assert.deepEqual(R.loadQuotes(f), ['"First quote." —A', '"Second quote." —B']);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('loadQuotes: stops at the Recommended additional sources heading', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-quotes-cut-'));
  try {
    const f = path.join(tmp, 'quotes.md');
    fs.writeFileSync(f,
      '## Live\n- "Live one." —X\n\n' +
      '# Recommended additional sources\n' +
      '### Seneca\n- "Sample do not show." —Seneca\n');
    assert.deepEqual(R.loadQuotes(f), ['"Live one." —X']);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('loadQuotes: missing or unreadable file returns []', () => {
  assert.deepEqual(R.loadQuotes('/nonexistent/dir/quotes.md'), []);
  assert.deepEqual(R.loadQuotes(undefined), []);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test --test-name-pattern="loadQuotes" statusline-render.test.js`
Expected: FAIL — `R.loadQuotes is not a function`.

- [ ] **Step 3: Implement `loadQuotes`**

In `statusline-render.js`, add this function next to `hash`/`pickQuote`:

```javascript
// Parse curated quote bullets from quotes.md. Only the region BEFORE the
// "# Recommended additional sources" heading is read, so staging samples never
// reach the statusline. Returns [] on any error (missing/unreadable file).
function loadQuotes(quotesPath) {
  try {
    const raw = fs.readFileSync(quotesPath, 'utf8');
    const cutoff = raw.indexOf('# Recommended additional sources');
    const region = cutoff === -1 ? raw : raw.slice(0, cutoff);
    return region
      .split('\n')
      .filter((line) => /^- "/.test(line))
      .map((line) => line.replace(/^- /, '').trim())
      .filter(Boolean);
  } catch (e) {
    return [];
  }
}
```

Then update the `module.exports` line to include `loadQuotes`:

```javascript
  hash, loadQuotes, pickQuote,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test --test-name-pattern="loadQuotes" statusline-render.test.js`
Expected: PASS (all 3 new tests).

- [ ] **Step 5: Commit**

```bash
cd /home/kevin/dotfiles
git add home/.claude/playtime/statusline-render.js home/.claude/playtime/statusline-render.test.js
git commit -m "feat(statusline): add loadQuotes parser (cuts at Recommended marker)"
```

---

## Task 3: Third line in `composeLines`

**Files:**
- Modify: `/home/kevin/dotfiles/home/.claude/playtime/statusline-render.js:83-89`
- Test: `/home/kevin/dotfiles/home/.claude/playtime/statusline-render.test.js`

- [ ] **Step 1: Write the failing test**

Append to `statusline-render.test.js`:

```javascript
test('composeLines: appends quote as a third line when present', () => {
  const out = R.composeLines({
    model: '\x1b[2mOpus 4.8' + RESET,
    effort: '',
    branch: '',
    pathSeg: '\x1b[2m~/x' + RESET,
    middle: '',
    ctxBar: 'CTX',
    usageBar: '',
    playtime: 'Hours spent in Gielinor: 66h',
    quote: '\x1b[2m"Be one." —Marcus Aurelius' + RESET,
  });
  const line1 = '\x1b[2mOpus 4.8' + RESET + ' │ \x1b[2m~/x' + RESET;
  const line2 = 'ctx CTX │ Hours spent in Gielinor: 66h';
  const line3 = '\x1b[2m"Be one." —Marcus Aurelius' + RESET;
  assert.equal(out, line1 + '\n' + line2 + '\n' + line3);
});

test('composeLines: no quote key => unchanged two-line output', () => {
  const out = R.composeLines({
    model: '\x1b[2mOpus 4.8' + RESET,
    effort: '',
    branch: '',
    pathSeg: '\x1b[2m~/x' + RESET,
    middle: '',
    ctxBar: 'CTX',
    usageBar: '',
    playtime: 'Hours spent in Gielinor: 66h',
  });
  const line1 = '\x1b[2mOpus 4.8' + RESET + ' │ \x1b[2m~/x' + RESET;
  const line2 = 'ctx CTX │ Hours spent in Gielinor: 66h';
  assert.equal(out, line1 + '\n' + line2);
});
```

- [ ] **Step 2: Run the tests to verify the new one fails**

Run: `node --test --test-name-pattern="composeLines" statusline-render.test.js`
Expected: the "appends quote as a third line" test FAILS (quote ignored, only two lines). The other three `composeLines` tests still PASS.

- [ ] **Step 3: Implement the third line**

Replace the body of `composeLines` (currently `statusline-render.js:83-89`):

```javascript
function composeLines({ model, effort, branch, pathSeg, middle, ctxBar, usageBar, playtime, quote }) {
  const line1 = [model, effort, branch, pathSeg, middle].filter(Boolean).join(' │ ');
  const ctxSeg = ctxBar ? `ctx ${ctxBar}` : '';
  const usageSeg = usageBar ? `5h ${usageBar}` : '';
  const line2 = [ctxSeg, usageSeg, playtime].filter(Boolean).join(' │ ');
  const lines = [line1];
  if (line2) lines.push(line2);
  if (quote) lines.push(quote);
  return lines.join('\n');
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test --test-name-pattern="composeLines" statusline-render.test.js`
Expected: PASS (all four `composeLines` tests).

- [ ] **Step 5: Commit**

```bash
cd /home/kevin/dotfiles
git add home/.claude/playtime/statusline-render.js home/.claude/playtime/statusline-render.test.js
git commit -m "feat(statusline): composeLines emits optional third (quote) line"
```

---

## Task 4: Wire quotes into `buildOutput` + `runStatusline`

**Files:**
- Modify: `/home/kevin/dotfiles/home/.claude/playtime/statusline-render.js:92-113` (`buildOutput`) and `:199-227` (`runStatusline`)
- Test: `/home/kevin/dotfiles/home/.claude/playtime/statusline-render.test.js` (new buildOutput test + update the end-to-end test)

- [ ] **Step 1: Write the failing tests**

First, add a unit test for the wiring (uses a temp quotes file):

```javascript
test('buildOutput: appends a deterministic dim quote third line', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-bo-quote-'));
  try {
    const qf = path.join(tmp, 'quotes.md');
    fs.writeFileSync(qf, '## S\n- "Only quote." —Z\n');
    const data = {
      model: { display_name: 'Opus 4.8' },
      workspace: { current_dir: '/home/kevin/proj' },
      context_window: { used_percentage: 10 },
    };
    const out = R.buildOutput(data, {
      homeDir: '/home/kevin', playtimeRaw: '⏱ 5h', branch: '', task: null,
      gsdMiddle: '', quotesPath: qf, session: 'whatever',
    });
    const lines = out.split('\n');
    assert.equal(lines.length, 3);
    assert.equal(lines[2], '\x1b[2m"Only quote." —Z' + RESET);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('buildOutput: no quotesPath => unchanged two-line output', () => {
  const data = {
    model: { display_name: 'Opus 4.8' },
    workspace: { current_dir: '/home/kevin/proj' },
    context_window: { used_percentage: 10 },
  };
  const out = R.buildOutput(data, {
    homeDir: '/home/kevin', playtimeRaw: '⏱ 5h', branch: '', task: null, gsdMiddle: '',
  });
  assert.equal(out.split('\n').length, 2);
});
```

Next, **update the existing end-to-end test** (currently `statusline-render.test.js:335-354`). It pipes `session_id: 'e2e-test'` through the real `statusline-render.js`, which now reads the committed `quotes.md` and emits a third line. Replace its assertions so it expects three lines:

```javascript
test('runStatusline end-to-end: pipes JSON in, prints three lines incl. quote', () => {
  const input = JSON.stringify({
    model: { display_name: 'Opus 4.8' },
    effort: { level: 'high' },
    workspace: { current_dir: os.homedir() },
    context_window: { used_percentage: 30, remaining_percentage: 70 },
    session_id: 'e2e-test',
  });
  const out = execSync(`${JSON.stringify(process.execPath)} statusline-render.js`, {
    cwd: __dirname,
    input,
    env: { ...process.env, GIELINOR_HOURS: '⏱ 66h' },
  }).toString();
  const lines = out.split('\n');
  assert.equal(lines.length, 3);
  assert.ok(lines[0].includes('Opus 4.8'));
  assert.ok(lines[0].includes('effort: high'));
  assert.ok(lines[1].includes('ctx '));
  assert.ok(lines[1].includes('Hours spent in Gielinor: 66h'));
  assert.ok(lines[2].includes('"')); // a quote on line 3
});
```

> This test couples to the committed `quotes.md` having at least one live quote (above the Recommended marker). That file is committed with eight populated sources, so the coupling is intentional and stable.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test --test-name-pattern="buildOutput: appends|buildOutput: no quotesPath|end-to-end" statusline-render.test.js`
Expected: FAIL — the new buildOutput quote test sees two lines (wiring absent), and the end-to-end test sees two lines while expecting three.

- [ ] **Step 3: Wire `buildOutput`**

Replace `buildOutput` (currently `statusline-render.js:92-113`):

```javascript
// Pure assembler: `data` is parsed stdin JSON; `ctx` carries all I/O results.
function buildOutput(data, ctx) {
  const { homeDir, playtimeRaw, branch, task, gsdMiddle, quotesPath, session } = ctx;
  const model = formatModel(data.model && data.model.display_name);
  const effort = formatEffort(data.effort && data.effort.level);
  const dir = (data.workspace && data.workspace.current_dir) || '';
  const pathSeg = formatPath(dir, homeDir);

  const ctxPct = data.context_window && data.context_window.used_percentage;
  const ctxBar = ctxPct == null ? '' : renderBar(ctxPct);

  const usagePct = data.rate_limits && data.rate_limits.five_hour &&
    data.rate_limits.five_hour.used_percentage;
  const usageBar = usagePct == null ? '' : renderBar(usagePct);

  const middle = task ? `${BOLD}${task}${RESET}` : (gsdMiddle || '');
  const playtime = formatPlaytime(playtimeRaw);

  const picked = pickQuote(loadQuotes(quotesPath), session);
  const quote = picked ? `${DIM}${picked}${RESET}` : '';

  return composeLines({
    model, effort, branch: branch || '', pathSeg,
    middle, ctxBar, usageBar, playtime, quote,
  });
}
```

- [ ] **Step 4: Wire `runStatusline`**

In `runStatusline`, extend the `buildOutput(data, { ... })` call (currently `statusline-render.js:216-222`) to pass `quotesPath` and `session`. `session` is already declared earlier in the function (`const session = data.session_id || '';`):

```javascript
      process.stdout.write(buildOutput(data, {
        homeDir,
        playtimeRaw: process.env.GIELINOR_HOURS,
        branch,
        task,
        gsdMiddle,
        quotesPath: path.join(__dirname, 'quotes.md'),
        session,
      }));
```

- [ ] **Step 5: Run the full suite to verify everything passes**

Run: `node --test statusline-render.test.js`
Expected: PASS — all tests, including the new buildOutput tests and the updated end-to-end test. The pre-existing `buildOutput` tests (no `quotesPath` in ctx) still pass because `loadQuotes(undefined)` returns `[]` → `pickQuote` returns `''` → no third line.

- [ ] **Step 6: Smoke-test the real statusline**

Run:

```bash
cd /home/kevin/dotfiles/home/.claude/playtime
echo '{"model":{"display_name":"Opus 4.8"},"effort":{"level":"high"},"workspace":{"current_dir":"'"$HOME"'"},"context_window":{"used_percentage":30,"remaining_percentage":70},"rate_limits":{"five_hour":{"used_percentage":22}},"session_id":"smoke-1"}' | bash playtime-statusline.sh
```

Expected: three lines printed — identity, meters + Gielinor, then a dim quote. Run again with `"session_id":"smoke-2"` and confirm the quote line is stable within each id (re-run smoke-1, same quote) and generally differs across ids.

- [ ] **Step 7: Commit**

```bash
cd /home/kevin/dotfiles
git add home/.claude/playtime/statusline-render.js home/.claude/playtime/statusline-render.test.js
git commit -m "feat(statusline): render per-session quote as third line"
```

---

## Final commit: spec, plan, and quotes data

After all four tasks are green, commit the design artifacts and curated quote data together.

- [ ] **Step 1: Commit docs + quotes**

```bash
cd /home/kevin/dotfiles
git add home/.claude/playtime/quotes.md \
        home/.claude/playtime/docs/2026-06-06-statusline-quotes-design.md \
        home/.claude/playtime/docs/2026-06-06-statusline-quotes-plan.md
git commit -m "docs(statusline): quotes spec, plan, and curated quote list"
```

---

## Self-Review (completed during planning)

- **Spec coverage:** rotation (Task 1 `pickQuote`), data source incl. Recommended cutoff (Task 2 `loadQuotes`), third-line composition (Task 3), dim styling + wiring + `__dirname` quotes path (Task 4), graceful degradation when no quotes (Task 4 Step 5 reasoning + `buildOutput: no quotesPath` test), tests for all three dimensions (Tasks 1–4). No "curate short only / own line" overflow code needed — matches spec's no-truncation decision.
- **Placeholder scan:** none — every code and test step contains full content; commands have expected output.
- **Type consistency:** `hash(str)→number`, `loadQuotes(path)→string[]`, `pickQuote(quotes, session)→string`, `composeLines({…, quote})→string`, `buildOutput(data, {…, quotesPath, session})→string` are used identically across tasks. Exports staged correctly (`hash, pickQuote` in Task 1; `loadQuotes` added in Task 2) to avoid a `ReferenceError` on a not-yet-defined function.
- **Known coupling:** the end-to-end test depends on the committed `quotes.md` having ≥1 live quote — intentional, documented in Task 4.
