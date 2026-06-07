const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('./statusline-render.js');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

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

test('renderBar: blinking red at 80+', () => {
  assert.equal(R.renderBar(80), '\x1b[5;31m████████░░ 80%' + RESET);
});

test('renderBar: clamps and rounds', () => {
  assert.equal(R.renderBar(120), '\x1b[5;31m██████████ 100%' + RESET);
  assert.equal(R.renderBar(37.6), '\x1b[32m███░░░░░░░ 38%' + RESET);
});

test('renderBar: empty string for null/NaN', () => {
  assert.equal(R.renderBar(null), '');
  assert.equal(R.renderBar(undefined), '');
  assert.equal(R.renderBar(NaN), '');
});

test('renderBar: explicit color overrides threshold coloring at any value', () => {
  const DIM = '\x1b[2m';
  assert.equal(R.renderBar(22, DIM), DIM + '██░░░░░░░░ 22%' + RESET);
  // A high value that would normally blink red stays neutral when overridden.
  assert.equal(R.renderBar(95, DIM), DIM + '█████████░ 95%' + RESET);
});

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

test('formatPlaytime: strips stopwatch icon, adds Gielinor label', () => {
  assert.equal(R.formatPlaytime('⏱ 66h'), 'Hours spent in Gielinor: 66h');
  assert.equal(R.formatPlaytime('66h'), 'Hours spent in Gielinor: 66h');
});

test('formatPlaytime: defaults to 0h when empty', () => {
  assert.equal(R.formatPlaytime(''), 'Hours spent in Gielinor: 0h');
  assert.equal(R.formatPlaytime(undefined), 'Hours spent in Gielinor: 0h');
});

test('formatReset: empty when resets_at absent or invalid', () => {
  assert.equal(R.formatReset(null, 1000), '');
  assert.equal(R.formatReset(undefined, 1000), '');
  assert.equal(R.formatReset('nope', 1000), '');
});

test('formatReset: hours and minutes remaining', () => {
  const now = 1000000;
  assert.equal(R.formatReset(now + 2 * 3600 + 34 * 60, now), 'Session resets in: 2h 34m');
});

test('formatReset: minutes only when under an hour', () => {
  const now = 1000000;
  assert.equal(R.formatReset(now + 45 * 60, now), 'Session resets in: 45m');
});

test('formatReset: clamps a past reset to 0m', () => {
  const now = 1000000;
  assert.equal(R.formatReset(now - 500, now), 'Session resets in: 0m');
});

test('composeLines: full output — line 1 carries task/state, line 2 is meters + playtime', () => {
  const out = R.composeLines({
    model: '\x1b[2mOpus 4.8' + RESET,
    effort: '\x1b[33meffort: high' + RESET,
    branch: 'main',
    pathSeg: '\x1b[2m~/x' + RESET,
    middle: '\x1b[1mtask' + RESET,
    ctxBar: 'CTX',
    usageBar: 'USE',
    playtime: 'Hours spent in Gielinor: 66h',
  });
  const line1 = '\x1b[2mOpus 4.8' + RESET + ' │ \x1b[33meffort: high' + RESET +
    ' │ main │ \x1b[2m~/x' + RESET + ' │ \x1b[1mtask' + RESET;
  const line2 = 'ctx CTX │ 5h USE │ Hours spent in Gielinor: 66h';
  assert.equal(out, line1 + '\n' + line2);
});

test('composeLines: reset segment sits between the 5h bar and playtime', () => {
  const out = R.composeLines({
    model: 'M', effort: '', branch: '', pathSeg: 'P', middle: '',
    ctxBar: 'CTX', usageBar: 'USE', reset: 'Session resets in: 1h 0m',
    playtime: 'Hours spent in Gielinor: 66h',
  });
  const line2 = 'ctx CTX │ 5h USE │ Session resets in: 1h 0m │ Hours spent in Gielinor: 66h';
  assert.ok(out.endsWith(line2), out);
});

test('composeLines: degraded (no effort/branch/middle/usage)', () => {
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

test('buildOutput: assembles full line from data + injected I/O', () => {
  const data = {
    model: { display_name: 'Opus 4.8' },
    effort: { level: 'high' },
    workspace: { current_dir: '/home/kevin/proj' },
    context_window: { used_percentage: 38, context_window_size: 1_000_000, total_input_tokens: 380_000 },
    rate_limits: { five_hour: { used_percentage: 22 } },
  };
  const out = R.buildOutput(data, {
    homeDir: '/home/kevin',
    playtimeRaw: '⏱ 66h',
    branch: 'main',
    task: null,
    gsdMiddle: '\x1b[2mexecuting · auth (2/5)' + RESET,
  });
  const line1 = '\x1b[2mOpus 4.8' + RESET + ' │ \x1b[33meffort: high' + RESET +
    ' │ main │ \x1b[2m~/proj' + RESET + ' │ \x1b[2mexecuting · auth (2/5)' + RESET;
  const line2 = '\x1b[32mctx' + RESET + ' \x1b[32m███░░░░░░░ 38%' + RESET +
    ' \x1b[32m380k/1M' + RESET +
    ' │ 5h \x1b[2m██░░░░░░░░ 22%' + RESET +
    ' │ Hours spent in Gielinor: 66h';
  assert.equal(out, line1 + '\n' + line2);
});

test('buildOutput: includes session reset countdown after the 5h bar', () => {
  const now = 2000000;
  const data = {
    model: { display_name: 'Opus 4.8' },
    workspace: { current_dir: '/home/kevin/proj' },
    context_window: { used_percentage: 10 },
    rate_limits: { five_hour: { used_percentage: 20, resets_at: now + 3 * 3600 + 5 * 60 } },
  };
  const out = R.buildOutput(data, {
    homeDir: '/home/kevin', playtimeRaw: '⏱ 5h', branch: '', task: null,
    gsdMiddle: '', now,
  });
  assert.ok(out.includes('5h '));
  assert.ok(out.includes(' │ Session resets in: 3h 5m │ Hours spent in Gielinor: 5h'), out);
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
  assert.ok(out.includes('ctx'));
});

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

test('detectBranch: returns branch name via primary path (non-empty repo)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-nonempty-'));
  try {
    execSync('git init -q -b mainbranch && git -c user.email=t@t -c user.name=t commit --allow-empty -m init', { cwd: tmp });
    assert.equal(R.detectBranch(tmp), 'mainbranch');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

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

test('hash: deterministic and stable for a given string', () => {
  assert.equal(R.hash('e2e-test'), R.hash('e2e-test'));
  assert.equal(typeof R.hash('abc'), 'number');
  assert.ok(R.hash('abc') >= 0); // unsigned
  assert.equal(R.hash('abc'), 440920331); // pinned FNV-1a value
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
  assert.ok(seen.size >= 6); // good distribution across 8 slots
});

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

test('fmtK: formats thousands as k and millions as M', () => {
  assert.equal(R.fmtK(200_000), '200k');
  assert.equal(R.fmtK(500_000), '500k');
  assert.equal(R.fmtK(380_000), '380k');
  assert.equal(R.fmtK(1_000_000), '1M');
  assert.equal(R.fmtK(1_500_000), '1.5M');
  assert.equal(R.fmtK(0), '0k');
});

test('formatCtxTokens: uses context_window_size as max, total_input_tokens as used', () => {
  // direct token counts when both fields present
  assert.equal(R.formatCtxTokens(38, { context_window_size: 1_000_000, total_input_tokens: 380_000 }), '380k/1M');
  // falls back to pct-based estimate when total_input_tokens absent
  assert.equal(R.formatCtxTokens(10, { context_window_size: 200_000 }), '20k/200k');
  // extended context (e.g. sonnet with 500k window)
  assert.equal(R.formatCtxTokens(20, { context_window_size: 500_000, total_input_tokens: 100_000 }), '100k/500k');
  // no context_window_size → empty (never show wrong hardcoded value)
  assert.equal(R.formatCtxTokens(38, {}), '');
  assert.equal(R.formatCtxTokens(38, null), '');
  // null/NaN percentage with no total_input_tokens → empty
  assert.equal(R.formatCtxTokens(null, { context_window_size: 200_000 }), '');
  assert.equal(R.formatCtxTokens(NaN, { context_window_size: 200_000 }), '');
});

test('composeLines: colors ctx label and appends token count when ctxColor + ctxTokens provided', () => {
  const GREEN = '\x1b[32m';
  const out = R.composeLines({
    model: 'M', effort: '', branch: '', pathSeg: 'P', middle: '',
    ctxBar: 'BAR', ctxColor: GREEN, ctxTokens: '100k/200k',
    usageBar: '', playtime: 'Hours spent in Gielinor: 1h',
  });
  assert.ok(out.includes(GREEN + 'ctx' + RESET));
  assert.ok(out.includes(GREEN + '100k/200k' + RESET));
});

test('composeLines: plain ctx label when no ctxColor (backward compat)', () => {
  const out = R.composeLines({
    model: 'M', effort: '', branch: '', pathSeg: 'P', middle: '',
    ctxBar: 'CTX', usageBar: '', playtime: 'Hours spent in Gielinor: 1h',
  });
  assert.ok(out.includes('ctx CTX'));
});

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
    env: { ...process.env, GIELINOR_HOURS: '⏱ 66h', COLUMNS: '200' },
  }).toString();
  const lines = out.split('\n');
  assert.equal(lines.length, 3);
  assert.ok(lines[0].includes('Opus 4.8'));
  assert.ok(lines[0].includes('effort: high'));
  assert.ok(lines[1].includes('ctx'));
  assert.ok(lines[1].includes('Hours spent in Gielinor: 66h'));
  assert.ok(lines[2].includes('"')); // a quote on line 3
});

test('runStatusline: honors QUOTES_FILE env over the __dirname default', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-qfile-'));
  try {
    const qf = path.join(tmp, 'quotes.md');
    fs.writeFileSync(qf, '## S\n- "Env quote wins." —Test\n');
    const input = JSON.stringify({
      model: { display_name: 'Opus 4.8' },
      workspace: { current_dir: os.homedir() },
      context_window: { used_percentage: 10, remaining_percentage: 90 },
      session_id: 'qfile-test',
    });
    const out = execSync(`${JSON.stringify(process.execPath)} statusline-render.js`, {
      cwd: __dirname,
      input,
      env: { ...process.env, GIELINOR_HOURS: '⏱ 1h', QUOTES_FILE: qf, COLUMNS: '200' },
    }).toString();
    const lines = out.split('\n');
    assert.equal(lines.length, 3);
    assert.ok(lines[2].includes('"Env quote wins." —Test'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('wrapText: short text returns a single line', () => {
  assert.deepEqual(R.wrapText('short enough', 80), ['short enough']);
});

test('wrapText: wraps on word boundaries to fit maxWidth', () => {
  // widths: "the quick"=9, +" brown"=15, +" fox"=19; cap 10 -> break after each fit
  assert.deepEqual(R.wrapText('the quick brown fox', 10), ['the quick', 'brown fox']);
});

test('wrapText: every produced line fits within maxWidth', () => {
  const text = 'a fairly long sentence that should wrap across several rows neatly';
  const lines = R.wrapText(text, 20);
  assert.ok(lines.length > 1);
  for (const line of lines) assert.ok(line.length <= 20, `"${line}" exceeds 20`);
  assert.equal(lines.join(' '), text); // no content lost on word boundaries
});

test('wrapText: hard-breaks a word longer than the line', () => {
  assert.deepEqual(R.wrapText('abcdefghij', 4), ['abcd', 'efgh', 'ij']);
});

test('wrapText: unknown/invalid maxWidth returns one unwrapped line', () => {
  const long = 'x '.repeat(100).trim();
  assert.deepEqual(R.wrapText(long, null), [long]);
  assert.deepEqual(R.wrapText(long, undefined), [long]);
  assert.deepEqual(R.wrapText(long, 0), [long]);
  assert.deepEqual(R.wrapText(long, NaN), [long]);
});

test('wrapText: empty/falsy text returns []', () => {
  assert.deepEqual(R.wrapText('', 80), []);
});

test('buildOutput: wraps a long quote onto additional dim rows', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-bo-wrap-'));
  try {
    const qf = path.join(tmp, 'quotes.md');
    const longQuote = '"All we have to decide is what to do with the time that is given us." —Gandalf';
    fs.writeFileSync(qf, '## S\n- ' + longQuote + '\n');
    const data = {
      model: { display_name: 'Opus 4.8' },
      workspace: { current_dir: '/home/kevin/proj' },
      context_window: { used_percentage: 10 },
    };
    const out = R.buildOutput(data, {
      homeDir: '/home/kevin', playtimeRaw: '⏱ 5h', branch: '', task: null,
      gsdMiddle: '', quotesPath: qf, session: 'whatever', columns: 30,
    });
    const lines = out.split('\n');
    assert.ok(lines.length >= 4, 'long quote should wrap past a 3rd line');
    // Every quote row (line 3 onward) is dim-wrapped and within the width.
    for (const line of lines.slice(2)) {
      assert.ok(line.startsWith('\x1b[2m') && line.endsWith(RESET));
      const visible = line.replace('\x1b[2m', '').replace(RESET, '');
      assert.ok(visible.length <= 30, `"${visible}" exceeds 30`);
    }
    // Reassembling the visible quote rows reproduces the original quote.
    const visibleQuote = lines.slice(2)
      .map((l) => l.replace('\x1b[2m', '').replace(RESET, ''))
      .join(' ');
    assert.equal(visibleQuote, longQuote);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
