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
  const line1 = '\x1b[2mOpus 4.8' + RESET + ' │ \x1b[33meffort: high' + RESET +
    ' │ main │ \x1b[2m~/proj' + RESET + ' │ \x1b[2mexecuting · auth (2/5)' + RESET;
  const line2 = 'ctx \x1b[32m███░░░░░░░ 38%' + RESET +
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

test('runStatusline end-to-end: pipes JSON in, prints two lines', () => {
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
  assert.equal(lines.length, 2);
  assert.ok(lines[0].includes('Opus 4.8'));
  assert.ok(lines[0].includes('effort: high'));
  assert.ok(lines[1].includes('ctx '));
  assert.ok(lines[1].includes('Hours spent in Gielinor: 66h'));
});
