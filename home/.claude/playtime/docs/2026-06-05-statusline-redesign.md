# Statusline Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-line GSD-based statusline with a two-line, user-owned renderer that adds git branch, reasoning effort, and a 5-hour usage bar, keeps the existing context bar (with the green cutoff moved to <40), and labels the playtime counter "Hours spent in Gielinor:".

**Architecture:** A new Node module `statusline-render.js` (user-owned, in `~/dotfiles/home/.claude/playtime/`, invisible to `/gsd-update`) does all rendering as small pure functions plus a thin stdin/stdout `main`. It obtains the GSD milestone/phase middle segment by a **guarded require** of the GSD-owned `~/.claude/hooks/gsd-statusline.js` (try/catch + `typeof` feature-detect + `gsd-hook-version` ceiling), degrading to "no GSD middle" on any failure. The existing `playtime-statusline.sh` wrapper keeps writing the heartbeat and refreshing the playtime cache, then pipes the stdin JSON into the renderer (passing the playtime string via `$GIELINOR_HOURS`) and prints its two-line output. `statusline.conf` is reduced to resolving the node binary.

**Tech Stack:** Node.js v22.6.0 (built-in `node:test` + `node:assert`), Bash, ANSI escape codes.

---

## Conventions for every task

- **Working dir for all commands:** `cd ~/dotfiles/home/.claude/playtime`
- **Node binary:** `$HOME/.nvm/versions/node/v22.6.0/bin/node` (this box's pinned node; falls back to `node` on PATH elsewhere). The plan abbreviates it as `NODE` — set it once per shell:
  ```bash
  NODE="$HOME/.nvm/versions/node/v22.6.0/bin/node"; [ -x "$NODE" ] || NODE="$(command -v node)"
  ```
- **Test runner:** `"$NODE" --test statusline-render.test.js`
- All tests live in one growing file `statusline-render.test.js`; each task appends a new block.
- The module is `statusline-render.js`. It builds up exported functions task by task; `runStatusline()` is wired last.
- **ANSI constants** (used throughout — defined once in Task 1):
  `RESET=\x1b[0m`, `DIM=\x1b[2m`, `BOLD=\x1b[1m`, green=`\x1b[32m`, yellow=`\x1b[33m`, orange=`\x1b[38;5;208m`, blink-red=`\x1b[5;31m`.
- The progress bar uses **`█` (U+2588) filled and `░` (U+2591) empty**, 10 segments — identical to the current implementation (the design previews used `▓` only for illustration; the code must use `█`/`░`).

---

## File Structure

- **Create:** `~/dotfiles/home/.claude/playtime/statusline-render.js` — the renderer module + `main`.
- **Create:** `~/dotfiles/home/.claude/playtime/statusline-render.test.js` — node:test suite.
- **Modify:** `~/dotfiles/home/.claude/playtime/statusline.conf` — reduce to node-binary resolution.
- **Modify:** `~/dotfiles/home/.claude/playtime/playtime-statusline.sh` — pipe stdin into the renderer instead of running the inner statusline and appending playtime.
- **Never touch:** `~/.claude/hooks/gsd-statusline.js` (GSD-owned, overwritten on update), `playtime.py`, `settings.json`.

---

## Task 1: Scaffold module + `renderBar`

**Files:**
- Create: `statusline-render.js`
- Create: `statusline-render.test.js`

- [ ] **Step 1: Write the failing test**

Create `statusline-render.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('./statusline-render.js');

const RESET = '\x1b[0m';

test('renderBar: green below 40', () => {
  assert.equal(R.renderBar(38), '\x1b[32m███░░░░░░░ 38%' + RESET);
});

test('renderBar: yellow 40-64', () => {
  assert.equal(R.renderBar(50), '\x1b[33m█████░░░░░ 50%' + RESET);
});

test('renderBar: orange 65-79', () => {
  assert.equal(R.renderBar(70), '\x1b[38;5;208m███████░░░ 70%' + RESET);
});

test('renderBar: blinking red + skull at 80+', () => {
  assert.equal(R.renderBar(80), '\x1b[5;31m💀 ████████░░ 80%' + RESET);
});

test('renderBar: clamps and rounds', () => {
  assert.equal(R.renderBar(120), '\x1b[5;31m💀 ██████████ 100%' + RESET);
  assert.equal(R.renderBar(37.6), '\x1b[32m███░░░░░░░ 38%' + RESET);
});

test('renderBar: empty string for null/NaN', () => {
  assert.equal(R.renderBar(null), '');
  assert.equal(R.renderBar(undefined), '');
  assert.equal(R.renderBar(NaN), '');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `"$NODE" --test statusline-render.test.js`
Expected: FAIL — `Cannot find module './statusline-render.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `statusline-render.js`:

```js
#!/usr/bin/env node
// Playtime two-line statusline renderer (user-owned; see docs/2026-06-05-statusline-redesign-design.md).
// Reads Claude Code statusline JSON on stdin, prints two lines on stdout.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const ORANGE = '\x1b[38;5;208m';
const BLINK_RED = '\x1b[5;31m';

// Shared threshold color for both the context and 5h usage bars.
function colorFor(pct) {
  if (pct < 40) return GREEN;
  if (pct < 65) return YELLOW;
  if (pct < 80) return ORANGE;
  return BLINK_RED;
}

// 10-segment bar identical to the legacy context meter (█ filled / ░ empty).
function renderBar(pct) {
  if (pct == null || Number.isNaN(Number(pct))) return '';
  const p = Math.max(0, Math.min(100, Math.round(Number(pct))));
  const filled = Math.floor(p / 10);
  const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);
  const skull = p >= 80 ? '💀 ' : '';
  return `${colorFor(p)}${skull}${bar} ${p}%${RESET}`;
}

module.exports = { renderBar };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `"$NODE" --test statusline-render.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add home/.claude/playtime/statusline-render.js home/.claude/playtime/statusline-render.test.js
git commit -m "feat(statusline): add renderBar with <40 green threshold

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `formatEffort`

**Files:**
- Modify: `statusline-render.js`
- Test: `statusline-render.test.js`

- [ ] **Step 1: Write the failing test** (append to test file)

```js
test('formatEffort: color-coded by level', () => {
  assert.equal(R.formatEffort('low'), '\x1b[32meffort: low' + RESET);
  assert.equal(R.formatEffort('medium'), '\x1b[32meffort: medium' + RESET);
  assert.equal(R.formatEffort('high'), '\x1b[33meffort: high' + RESET);
  assert.equal(R.formatEffort('xhigh'), '\x1b[38;5;208meffort: xhigh' + RESET);
  assert.equal(R.formatEffort('max'), '\x1b[31meffort: max' + RESET);
});

test('formatEffort: empty when absent or unknown', () => {
  assert.equal(R.formatEffort(undefined), '');
  assert.equal(R.formatEffort(null), '');
  assert.equal(R.formatEffort('weird'), '');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `"$NODE" --test statusline-render.test.js`
Expected: FAIL — `R.formatEffort is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to `statusline-render.js` (above `module.exports`):

```js
const RED = '\x1b[31m';
const EFFORT_COLORS = { low: GREEN, medium: GREEN, high: YELLOW, xhigh: ORANGE, max: RED };

// effort.level is one of low|medium|high|xhigh|max, or absent when the model
// does not support the effort parameter. Unknown/absent => no segment.
function formatEffort(level) {
  if (!level || !(level in EFFORT_COLORS)) return '';
  return `${EFFORT_COLORS[level]}effort: ${level}${RESET}`;
}
```

Update exports:

```js
module.exports = { renderBar, formatEffort };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `"$NODE" --test statusline-render.test.js`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add home/.claude/playtime/statusline-render.js home/.claude/playtime/statusline-render.test.js
git commit -m "feat(statusline): add color-coded formatEffort

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `formatModel` + `formatPath`

**Files:**
- Modify: `statusline-render.js`
- Test: `statusline-render.test.js`

- [ ] **Step 1: Write the failing test** (append)

```js
test('formatModel: dim, defaults to Claude', () => {
  assert.equal(R.formatModel('Opus 4.8'), '\x1b[2mOpus 4.8' + RESET);
  assert.equal(R.formatModel(''), '\x1b[2mClaude' + RESET);
  assert.equal(R.formatModel(undefined), '\x1b[2mClaude' + RESET);
});

test('shortenPath: home-collapsed, kept when <=3 segments deep', () => {
  assert.equal(R.shortenPath('/home/kevin/dotfiles/home/.claude', '/home/kevin'),
    '~/dotfiles/home/.claude');
  assert.equal(R.shortenPath('/home/kevin/proj', '/home/kevin'), '~/proj');
  assert.equal(R.shortenPath('/home/kevin', '/home/kevin'), '~');
});

test('shortenPath: truncates deep paths to last 3 segments', () => {
  assert.equal(R.shortenPath('/home/kevin/a/b/c/d', '/home/kevin'), '…/b/c/d');
  assert.equal(R.shortenPath('/var/log/syslog/deep/path', '/home/kevin'),
    '…/syslog/deep/path');
});

test('shortenPath: non-home absolute path kept when shallow', () => {
  assert.equal(R.shortenPath('/usr/local/bin', '/home/kevin'), '/usr/local/bin');
});

test('formatPath: wraps shortenPath in dim', () => {
  assert.equal(R.formatPath('/home/kevin/proj', '/home/kevin'),
    '\x1b[2m~/proj' + RESET);
  assert.equal(R.formatPath('', '/home/kevin'), '');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `"$NODE" --test statusline-render.test.js`
Expected: FAIL — `R.formatModel is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to `statusline-render.js`:

```js
function formatModel(name) {
  return `${DIM}${name || 'Claude'}${RESET}`;
}

// Collapse $HOME to ~, then if the path is deeper than 3 segments show
// "…/last/two/three". Returns a plain (un-styled) string.
function shortenPath(dir, home) {
  if (!dir) return '';
  let p = dir;
  if (home && (p === home || p.startsWith(home + '/'))) {
    p = '~' + p.slice(home.length); // '~' or '~/sub/...'
  }
  const isHome = p.startsWith('~');
  const body = (isHome ? p.slice(1) : p).replace(/^\/+/, '');
  const segs = body.split('/').filter(Boolean);
  if (segs.length > 3) {
    return '…/' + segs.slice(-3).join('/');
  }
  const root = isHome ? '~' : '';
  if (segs.length === 0) return root || '/';
  return `${root}/${segs.join('/')}`;
}

function formatPath(dir, home) {
  if (!dir) return '';
  return `${DIM}${shortenPath(dir, home)}${RESET}`;
}
```

Update exports:

```js
module.exports = { renderBar, formatEffort, formatModel, shortenPath, formatPath };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `"$NODE" --test statusline-render.test.js`
Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add home/.claude/playtime/statusline-render.js home/.claude/playtime/statusline-render.test.js
git commit -m "feat(statusline): add formatModel and path shortening

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: `formatPlaytime`

**Files:**
- Modify: `statusline-render.js`
- Test: `statusline-render.test.js`

- [ ] **Step 1: Write the failing test** (append)

```js
test('formatPlaytime: strips stopwatch icon, adds Gielinor label', () => {
  assert.equal(R.formatPlaytime('⏱ 66h'), 'Hours spent in Gielinor: 66h');
  assert.equal(R.formatPlaytime('66h'), 'Hours spent in Gielinor: 66h');
});

test('formatPlaytime: defaults to 0h when empty', () => {
  assert.equal(R.formatPlaytime(''), 'Hours spent in Gielinor: 0h');
  assert.equal(R.formatPlaytime(undefined), 'Hours spent in Gielinor: 0h');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `"$NODE" --test statusline-render.test.js`
Expected: FAIL — `R.formatPlaytime is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to `statusline-render.js`:

```js
// The cache value looks like "⏱ 66h"; strip the icon and relabel.
function formatPlaytime(raw) {
  const v = String(raw || '').replace(/^⏱\s*/, '').trim() || '0h';
  return `Hours spent in Gielinor: ${v}`;
}
```

Update exports to include `formatPlaytime`.

- [ ] **Step 4: Run test to verify it passes**

Run: `"$NODE" --test statusline-render.test.js`
Expected: PASS (15 tests).

- [ ] **Step 5: Commit**

```bash
git add home/.claude/playtime/statusline-render.js home/.claude/playtime/statusline-render.test.js
git commit -m "feat(statusline): add formatPlaytime Gielinor label

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: `composeLines`

**Files:**
- Modify: `statusline-render.js`
- Test: `statusline-render.test.js`

- [ ] **Step 1: Write the failing test** (append)

```js
test('composeLines: full two-line output', () => {
  const out = R.composeLines({
    model: '\x1b[2mOpus 4.8' + RESET,
    effort: '\x1b[33meffort: high' + RESET,
    branch: 'main',
    path: '\x1b[2m~/x' + RESET,
    middle: '\x1b[1mtask' + RESET,
    ctxBar: 'CTX',
    usageBar: 'USE',
    playtime: 'Hours spent in Gielinor: 66h',
  });
  const line1 = '\x1b[2mOpus 4.8' + RESET + ' · \x1b[33meffort: high' + RESET +
    ' │ main │ \x1b[2m~/x' + RESET;
  const line2 = '\x1b[1mtask' + RESET + ' │ ctx CTX │ 5h USE │ Hours spent in Gielinor: 66h';
  assert.equal(out, line1 + '\n' + line2);
});

test('composeLines: degraded (no effort/branch/middle/usage)', () => {
  const out = R.composeLines({
    model: '\x1b[2mOpus 4.8' + RESET,
    effort: '',
    branch: '',
    path: '\x1b[2m~/x' + RESET,
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

- [ ] **Step 2: Run test to verify it fails**

Run: `"$NODE" --test statusline-render.test.js`
Expected: FAIL — `R.composeLines is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to `statusline-render.js`:

```js
// Line 1 = identity + location; Line 2 = meters + playtime.
// Absent segments are dropped so separators never collapse to " │ │ ".
function composeLines({ model, effort, branch, path, middle, ctxBar, usageBar, playtime }) {
  const id = effort ? `${model} · ${effort}` : model;
  const line1 = [id, branch, path].filter(Boolean).join(' │ ');
  const ctxSeg = ctxBar ? `ctx ${ctxBar}` : '';
  const usageSeg = usageBar ? `5h ${usageBar}` : '';
  const line2 = [middle, ctxSeg, usageSeg, playtime].filter(Boolean).join(' │ ');
  return line2 ? `${line1}\n${line2}` : line1;
}
```

Update exports to include `composeLines`.

- [ ] **Step 4: Run test to verify it passes**

Run: `"$NODE" --test statusline-render.test.js`
Expected: PASS (17 tests).

- [ ] **Step 5: Commit**

```bash
git add home/.claude/playtime/statusline-render.js home/.claude/playtime/statusline-render.test.js
git commit -m "feat(statusline): add composeLines two-line layout

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: `buildOutput` (integration of pure pieces)

**Files:**
- Modify: `statusline-render.js`
- Test: `statusline-render.test.js`

`buildOutput` takes the parsed stdin `data` plus a `ctx` object carrying the
results of all I/O (playtime string, branch, active task, gsd middle, homeDir),
so it is fully pure and testable. The `main` runner (Task 10) computes `ctx` via
I/O and calls it.

- [ ] **Step 1: Write the failing test** (append)

```js
test('buildOutput: assembles full line from data + injected I/O', () => {
  const data = {
    model: { display_name: 'Opus 4.8' },
    effort: { level: 'high' },
    workspace: { current_dir: '/home/kevin/proj' },
    context_window: { used_percentage: 38 },
    rate_limits: { five_hour: { used_percentage: 22 } },
  };
  const out = R.buildOutput(data, {
    homeDir: '/home/kevin',
    playtimeRaw: '⏱ 66h',
    branch: 'main',
    task: null,
    gsdMiddle: '\x1b[2mexecuting · auth (2/5)' + RESET,
  });
  const line1 = '\x1b[2mOpus 4.8' + RESET + ' · \x1b[33meffort: high' + RESET +
    ' │ main │ \x1b[2m~/proj' + RESET;
  const line2 = '\x1b[2mexecuting · auth (2/5)' + RESET +
    ' │ ctx \x1b[32m███░░░░░░░ 38%' + RESET +
    ' │ 5h \x1b[32m██░░░░░░░░ 22%' + RESET +
    ' │ Hours spent in Gielinor: 66h';
  assert.equal(out, line1 + '\n' + line2);
});

test('buildOutput: active task (bold) takes precedence over gsd middle', () => {
  const data = {
    model: { display_name: 'Opus 4.8' },
    workspace: { current_dir: '/home/kevin/proj' },
    context_window: { used_percentage: 10 },
  };
  const out = R.buildOutput(data, {
    homeDir: '/home/kevin',
    playtimeRaw: '⏱ 5h',
    branch: '',
    task: 'Refactoring auth',
    gsdMiddle: '\x1b[2mSHOULD NOT APPEAR' + RESET,
  });
  assert.ok(out.includes('\x1b[1mRefactoring auth' + RESET));
  assert.ok(!out.includes('SHOULD NOT APPEAR'));
});

test('buildOutput: hides ctx bar when used_percentage is null', () => {
  const data = {
    model: { display_name: 'Opus 4.8' },
    workspace: { current_dir: '/home/kevin/proj' },
    context_window: { used_percentage: null },
  };
  const out = R.buildOutput(data, {
    homeDir: '/home/kevin', playtimeRaw: '⏱ 1h', branch: '', task: null, gsdMiddle: '',
  });
  assert.ok(!out.includes('ctx '));
  assert.ok(out.includes('Hours spent in Gielinor: 1h'));
});

test('buildOutput: hides 5h bar when rate_limits absent', () => {
  const data = {
    model: { display_name: 'Opus 4.8' },
    workspace: { current_dir: '/home/kevin/proj' },
    context_window: { used_percentage: 30 },
  };
  const out = R.buildOutput(data, {
    homeDir: '/home/kevin', playtimeRaw: '⏱ 1h', branch: '', task: null, gsdMiddle: '',
  });
  assert.ok(!out.includes('5h '));
  assert.ok(out.includes('ctx '));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `"$NODE" --test statusline-render.test.js`
Expected: FAIL — `R.buildOutput is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to `statusline-render.js`:

```js
// Pure assembler: `data` is parsed stdin JSON; `ctx` carries all I/O results.
function buildOutput(data, ctx) {
  const { homeDir, playtimeRaw, branch, task, gsdMiddle } = ctx;
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

  return composeLines({
    model, effort, branch: branch || '', path: pathSeg,
    middle, ctxBar, usageBar, playtime,
  });
}
```

Update exports to include `buildOutput`.

- [ ] **Step 4: Run test to verify it passes**

Run: `"$NODE" --test statusline-render.test.js`
Expected: PASS (21 tests).

- [ ] **Step 5: Commit**

```bash
git add home/.claude/playtime/statusline-render.js home/.claude/playtime/statusline-render.test.js
git commit -m "feat(statusline): add buildOutput pure assembler

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: `detectBranch` (git I/O)

**Files:**
- Modify: `statusline-render.js`
- Test: `statusline-render.test.js`

- [ ] **Step 1: Write the failing test** (append)

```js
test('detectBranch: empty string for non-repo dir', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-norepo-'));
  try {
    assert.equal(R.detectBranch(tmp), '');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('detectBranch: returns branch name inside a git repo', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-repo-'));
  try {
    execSync('git init -q -b testbranch', { cwd: tmp });
    assert.equal(R.detectBranch(tmp), 'testbranch');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
```

(`fs`, `path`, `os`, `execSync` are already required at the top of the test file? They are not — add these requires at the very top of `statusline-render.test.js` if not present:)

```js
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `"$NODE" --test statusline-render.test.js`
Expected: FAIL — `R.detectBranch is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to `statusline-render.js`:

```js
// Current branch name, or '' outside a repo / on detached HEAD. Never throws.
function detectBranch(dir) {
  try {
    const out = execSync(`git -C ${JSON.stringify(dir)} rev-parse --abbrev-ref HEAD`, {
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
    if (!out || out === 'HEAD') return '';
    return out;
  } catch (e) {
    return '';
  }
}
```

Update exports to include `detectBranch`.

- [ ] **Step 4: Run test to verify it passes**

Run: `"$NODE" --test statusline-render.test.js`
Expected: PASS (23 tests).

- [ ] **Step 5: Commit**

```bash
git add home/.claude/playtime/statusline-render.js home/.claude/playtime/statusline-render.test.js
git commit -m "feat(statusline): add detectBranch git lookup

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: `readActiveTask` (todos I/O)

**Files:**
- Modify: `statusline-render.js`
- Test: `statusline-render.test.js`

Mirrors the legacy logic: scan `todosDir` for the newest file beginning with
`<session>` and containing `-agent-`, parse JSON, return the `activeForm` of the
first `in_progress` item (or '').

- [ ] **Step 1: Write the failing test** (append)

```js
test('readActiveTask: returns activeForm of in_progress item', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-todos-'));
  try {
    const session = 'sess123';
    const file = path.join(tmp, `${session}-agent-abc.json`);
    fs.writeFileSync(file, JSON.stringify([
      { status: 'completed', activeForm: 'Done thing' },
      { status: 'in_progress', activeForm: 'Building widget' },
    ]));
    assert.equal(R.readActiveTask(session, tmp), 'Building widget');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('readActiveTask: empty when no matching file or no in_progress', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-todos2-'));
  try {
    assert.equal(R.readActiveTask('nope', tmp), '');
    const file = path.join(tmp, 'sess9-agent-x.json');
    fs.writeFileSync(file, JSON.stringify([{ status: 'pending', activeForm: 'Later' }]));
    assert.equal(R.readActiveTask('sess9', tmp), '');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('readActiveTask: empty when todosDir missing', () => {
  assert.equal(R.readActiveTask('s', '/nonexistent/dir/xyz'), '');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `"$NODE" --test statusline-render.test.js`
Expected: FAIL — `R.readActiveTask is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to `statusline-render.js`:

```js
// Newest <session>*-agent-*.json in todosDir; first in_progress item's activeForm.
function readActiveTask(session, todosDir) {
  if (!session || !fs.existsSync(todosDir)) return '';
  try {
    let latest = null;
    for (const entry of fs.readdirSync(todosDir)) {
      if (!entry.startsWith(session) || !entry.includes('-agent-') || !entry.endsWith('.json')) continue;
      const mtime = fs.statSync(path.join(todosDir, entry)).mtime;
      if (!latest || mtime > latest.mtime) latest = { name: entry, mtime };
    }
    if (!latest) return '';
    const todos = JSON.parse(fs.readFileSync(path.join(todosDir, latest.name), 'utf8'));
    const inProgress = todos.find((t) => t.status === 'in_progress');
    return (inProgress && inProgress.activeForm) || '';
  } catch (e) {
    return '';
  }
}
```

Update exports to include `readActiveTask`.

- [ ] **Step 4: Run test to verify it passes**

Run: `"$NODE" --test statusline-render.test.js`
Expected: PASS (26 tests).

- [ ] **Step 5: Commit**

```bash
git add home/.claude/playtime/statusline-render.js home/.claude/playtime/statusline-render.test.js
git commit -m "feat(statusline): add readActiveTask todo lookup

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: `getGsdMiddle` (guarded require)

**Files:**
- Modify: `statusline-render.js`
- Test: `statusline-render.test.js`

Guarded require of the GSD-owned `gsd-statusline.js`: existence check, version
ceiling from the `// gsd-hook-version:` header, `typeof` feature-detect, and
try/catch everywhere. Any failure => '' (degrade to no GSD middle).

- [ ] **Step 1: Write the failing test** (append)

```js
test('getGsdMiddle: empty when module path missing', () => {
  assert.equal(R.getGsdMiddle('/some/dir', '/nonexistent/gsd.js'), '');
});

test('getGsdMiddle: dim-wrapped state from a compatible stub module', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-gsd-'));
  try {
    const stub = path.join(tmp, 'gsd-statusline.js');
    fs.writeFileSync(stub,
      '// gsd-hook-version: 1.2.0\n' +
      'module.exports = {\n' +
      '  readGsdState: () => ({ ok: true }),\n' +
      '  formatGsdState: (s) => s.ok ? "executing · auth (2/5)" : "",\n' +
      '};\n');
    assert.equal(R.getGsdMiddle('/whatever', stub),
      '\x1b[2mexecuting · auth (2/5)' + RESET);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('getGsdMiddle: empty when version major exceeds ceiling', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-gsd-hi-'));
  try {
    const stub = path.join(tmp, 'gsd-statusline.js');
    fs.writeFileSync(stub,
      '// gsd-hook-version: 9.0.0\n' +
      'module.exports = { readGsdState: () => ({}), formatGsdState: () => "X" };\n');
    assert.equal(R.getGsdMiddle('/whatever', stub), '');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('getGsdMiddle: empty when exports are not functions', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-gsd-bad-'));
  try {
    const stub = path.join(tmp, 'gsd-statusline.js');
    fs.writeFileSync(stub, '// gsd-hook-version: 1.0.0\nmodule.exports = { nope: 1 };\n');
    assert.equal(R.getGsdMiddle('/whatever', stub), '');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('getGsdMiddle: empty string (not crash) when formatGsdState returns empty', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-gsd-empty-'));
  try {
    const stub = path.join(tmp, 'gsd-statusline.js');
    fs.writeFileSync(stub,
      '// gsd-hook-version: 1.2.0\n' +
      'module.exports = { readGsdState: () => ({}), formatGsdState: () => "" };\n');
    assert.equal(R.getGsdMiddle('/whatever', stub), '');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `"$NODE" --test statusline-render.test.js`
Expected: FAIL — `R.getGsdMiddle is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to `statusline-render.js`:

```js
// Highest gsd-hook-version MAJOR we have validated the export API against.
// If a /gsd-update ships a higher major, skip the GSD middle rather than risk
// calling a changed API.
const GSD_MAX_MAJOR = 2;

// Guarded require of the GSD-owned statusline module for its STATE.md parsers.
// Returns a dim-wrapped milestone/phase string, or '' on any incompatibility.
function getGsdMiddle(dir, gsdPath) {
  try {
    if (!gsdPath || !fs.existsSync(gsdPath)) return '';
    const head = fs.readFileSync(gsdPath, 'utf8').slice(0, 2000);
    const m = head.match(/gsd-hook-version:\s*(\d+)\./);
    if (m && parseInt(m[1], 10) > GSD_MAX_MAJOR) return '';
    const mod = require(gsdPath);
    if (typeof mod.readGsdState !== 'function' || typeof mod.formatGsdState !== 'function') {
      return '';
    }
    const state = mod.readGsdState(dir);
    if (!state) return '';
    const s = mod.formatGsdState(state);
    return s ? `${DIM}${s}${RESET}` : '';
  } catch (e) {
    return '';
  }
}
```

Update exports to include `getGsdMiddle`.

- [ ] **Step 4: Run test to verify it passes**

Run: `"$NODE" --test statusline-render.test.js`
Expected: PASS (31 tests).

- [ ] **Step 5: Commit**

```bash
git add home/.claude/playtime/statusline-render.js home/.claude/playtime/statusline-render.test.js
git commit -m "feat(statusline): add guarded-require getGsdMiddle

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: `writeBridge` + `runStatusline` main wiring

**Files:**
- Modify: `statusline-render.js`
- Test: `statusline-render.test.js`

`writeBridge` replicates the context-monitor bridge write so the existing
low-context PostToolUse warning keeps firing. `runStatusline` reads stdin,
computes all I/O, and prints `buildOutput`. The main is verified by an
end-to-end stdin test (spawning the script as a child process).

- [ ] **Step 1: Write the failing test** (append)

```js
test('writeBridge: writes used_pct = round(100 - remaining)', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-bridge-'));
  const session = 'sessBridge1';
  try {
    R.writeBridge({ context_window: { remaining_percentage: 92 } }, session, tmpHome);
    const f = path.join(tmpHome, `claude-ctx-${session}.json`);
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    assert.equal(j.session_id, session);
    assert.equal(j.remaining_percentage, 92);
    assert.equal(j.used_pct, 8);
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('writeBridge: skips unsafe session ids and missing remaining', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-bridge2-'));
  try {
    R.writeBridge({ context_window: {} }, 'noremaining', tmpHome);
    assert.ok(!fs.existsSync(path.join(tmpHome, 'claude-ctx-noremaining.json')));
    R.writeBridge({ context_window: { remaining_percentage: 50 } }, '../evil', tmpHome);
    assert.equal(fs.readdirSync(tmpHome).length, 0);
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('runStatusline end-to-end: pipes JSON in, prints two lines', () => {
  const input = JSON.stringify({
    model: { display_name: 'Opus 4.8' },
    effort: { level: 'high' },
    workspace: { current_dir: os.homedir() },
    context_window: { used_percentage: 30, remaining_percentage: 70 },
    session_id: 'e2e-test',
  });
  const out = execSync(`node statusline-render.js`, {
    cwd: __dirname,
    input,
    env: { ...process.env, GIELINOR_HOURS: '⏱ 66h' },
  }).toString();
  const lines = out.split('\n');
  assert.equal(lines.length, 2);
  assert.ok(lines[0].includes('Opus 4.8'));
  assert.ok(lines[0].includes('effort: high'));
  assert.ok(lines[1].includes('ctx '));
  assert.ok(lines[1].includes('Hours spent in Gielinor: 66h'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `"$NODE" --test statusline-render.test.js`
Expected: FAIL — `R.writeBridge is not a function` (and the e2e test fails because `runStatusline` isn't wired).

- [ ] **Step 3: Write minimal implementation**

Add to `statusline-render.js` (before `module.exports`). Note `writeBridge`
takes an optional `tmpDir` param defaulting to `os.tmpdir()` so it is testable:

```js
// Replicates gsd-statusline.js's context-monitor bridge file so the existing
// low-context PostToolUse warning keeps working. Best-effort; never throws.
function writeBridge(data, session, tmpDir) {
  try {
    const remaining = data.context_window && data.context_window.remaining_percentage;
    if (remaining == null) return;
    const safe = session && !/[/\\]|\.\./.test(session);
    if (!safe) return;
    const dir = tmpDir || os.tmpdir();
    const bridgePath = path.join(dir, `claude-ctx-${session}.json`);
    fs.writeFileSync(bridgePath, JSON.stringify({
      session_id: session,
      remaining_percentage: remaining,
      used_pct: Math.round(100 - remaining),
      timestamp: Math.floor(Date.now() / 1000),
    }));
  } catch (e) {
    // best-effort
  }
}

function runStatusline() {
  let input = '';
  const timeout = setTimeout(() => process.exit(0), 3000); // guard against stuck stdin
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => { input += c; });
  process.stdin.on('end', () => {
    clearTimeout(timeout);
    try {
      const data = JSON.parse(input);
      const homeDir = os.homedir();
      const dir = (data.workspace && data.workspace.current_dir) || process.cwd();
      const session = data.session_id || '';
      writeBridge(data, session);
      const branch = detectBranch(dir);
      const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(homeDir, '.claude');
      const task = readActiveTask(session, path.join(claudeDir, 'todos'));
      const gsdMiddle = task ? '' : getGsdMiddle(dir, path.join(homeDir, '.claude', 'hooks', 'gsd-statusline.js'));
      process.stdout.write(buildOutput(data, {
        homeDir,
        playtimeRaw: process.env.GIELINOR_HOURS,
        branch,
        task,
        gsdMiddle,
      }));
    } catch (e) {
      // Silent fail — never break the statusline.
    }
  });
}
```

Update exports to include `writeBridge`, and add the run-as-script guard at the
very end of the file:

```js
module.exports = {
  renderBar, formatEffort, formatModel, shortenPath, formatPath,
  formatPlaytime, composeLines, buildOutput, detectBranch,
  readActiveTask, getGsdMiddle, writeBridge,
};

if (require.main === module) runStatusline();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `"$NODE" --test statusline-render.test.js`
Expected: PASS (34 tests).

- [ ] **Step 5: Commit**

```bash
git add home/.claude/playtime/statusline-render.js home/.claude/playtime/statusline-render.test.js
git commit -m "feat(statusline): wire runStatusline main + bridge write

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 11: Wrapper + conf integration

**Files:**
- Modify: `statusline.conf`
- Modify: `playtime-statusline.sh`

- [ ] **Step 1: Rewrite `statusline.conf`**

Replace the entire contents of `statusline.conf` with:

```bash
# Playtime statusline config.
#
# Resolves the node binary used to run statusline-render.js. The renderer itself
# handles GSD presence (via a guarded require), so this no longer wires an inner
# statusline. If node is unavailable, the wrapper degrades to a playtime-only line.

NODE_BIN="$HOME/.nvm/versions/node/v22.6.0/bin/node"
[ -x "$NODE_BIN" ] || NODE_BIN="$(command -v node 2>/dev/null)"
export NODE_BIN
```

- [ ] **Step 2: Rewrite `playtime-statusline.sh`**

Replace the entire contents of `playtime-statusline.sh` with:

```bash
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
if [ -n "${NODE_BIN:-}" ] && [ -f "$RENDER" ]; then
  printf '%s' "$INPUT" | GIELINOR_HOURS="$PLAY" "$NODE_BIN" "$RENDER"
else
  printf 'Hours spent in Gielinor: %s' "${PLAY#⏱ }"
fi
```

- [ ] **Step 3: Make the wrapper executable**

Run: `chmod +x playtime-statusline.sh statusline-render.js`

- [ ] **Step 4: End-to-end test the wrapper with a sample payload**

Run (full state — note `$HOME` expands to a real dir so the path/branch render):

```bash
printf '%s' '{"model":{"display_name":"Opus 4.8"},"effort":{"level":"high"},"workspace":{"current_dir":"'"$HOME"'/dotfiles"},"context_window":{"used_percentage":38,"remaining_percentage":62},"rate_limits":{"five_hour":{"used_percentage":22}},"session_id":"wrap-e2e"}' \
  | bash playtime-statusline.sh; echo
```

Expected: two lines. Line 1 contains `Opus 4.8`, `· effort: high`, the dotfiles branch name, and a `~/dotfiles`-style path. Line 2 contains `ctx ` + a green `38%` bar, `5h ` + a green `22%` bar, and `Hours spent in Gielinor:` followed by your real hours.

- [ ] **Step 5: Test the node-missing fallback**

Run:

```bash
NODE_BIN= bash -c '
  PLAY="⏱ 66h"
  if [ -n "${NODE_BIN:-}" ]; then echo node; else printf "Hours spent in Gielinor: %s\n" "${PLAY#⏱ }"; fi
'
```

Expected: `Hours spent in Gielinor: 66h` (confirms the icon-stripping fallback).

- [ ] **Step 6: Commit**

```bash
git add home/.claude/playtime/statusline.conf home/.claude/playtime/playtime-statusline.sh
git commit -m "feat(statusline): wrapper pipes stdin into two-line renderer

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 12: Live verification + settings check

**Files:** none modified (verification only).

- [ ] **Step 1: Confirm `settings.json` still points at the wrapper (unchanged)**

Run: `grep -A3 '"statusLine"' "$HOME/.claude/settings.json"`
Expected: `command` is still `bash "$HOME/dotfiles/home/.claude/playtime/playtime-statusline.sh"`. No edit needed — the wrapper path is unchanged, so the redesign is picked up automatically.

- [ ] **Step 2: Run the full test suite once more**

Run: `cd ~/dotfiles/home/.claude/playtime && "$NODE" --test statusline-render.test.js`
Expected: all tests PASS (34).

- [ ] **Step 3: Verify the real statusline in a live Claude Code session**

Open (or refresh) a Claude Code session in a git repo and visually confirm:
- Line 1: model · effort · branch · path.
- Line 2: GSD/task middle (when present) · ctx bar · 5h bar (if Pro/Max) · `Hours spent in Gielinor: Nh`.
- The context bar is green only below 40%.

- [ ] **Step 4: Verify GSD update resilience (smoke test)**

Run: temporarily point the require at a bogus path to confirm graceful degradation does not crash the line:

```bash
printf '%s' '{"model":{"display_name":"Opus 4.8"},"workspace":{"current_dir":"/tmp"},"context_window":{"used_percentage":10},"session_id":"degrade"}' \
  | GIELINOR_HOURS='⏱ 1h' "$NODE" statusline-render.js; echo
```

Expected: a clean two-line output with no GSD middle and no error (proves the renderer works even if `/tmp` has no `.planning` and regardless of GSD state).

- [ ] **Step 5: Final commit (if any docs/notes changed; otherwise skip)**

No code changes in this task. If you updated the design/README, commit them; otherwise nothing to commit.

---

## Self-Review Notes (completed by plan author)

- **Spec coverage:** branch (T7), effort + color map (T2), 5h usage bar (T6 wiring + T1 bar), path home-collapse/truncate (T3), context bar <40 green (T1), playtime label (T4), two-line layout (T5), guarded require + version ceiling (T9), bridge-write preservation (T10), wrapper/conf + degradation (T11), settings untouched (T12). All spec sections mapped.
- **Placeholder scan:** no TBD/TODO; every code step has complete code and exact expected output.
- **Type/name consistency:** function names (`renderBar`, `formatEffort`, `formatModel`, `shortenPath`, `formatPath`, `formatPlaytime`, `composeLines`, `buildOutput`, `detectBranch`, `readActiveTask`, `getGsdMiddle`, `writeBridge`, `runStatusline`) are consistent across tasks and the cumulative `module.exports`. `buildOutput`'s `ctx` keys (`homeDir`, `playtimeRaw`, `branch`, `task`, `gsdMiddle`) match between T6 definition and T10 caller.
