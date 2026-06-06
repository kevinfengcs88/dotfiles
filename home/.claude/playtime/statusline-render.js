#!/usr/bin/env node
// Playtime two-line statusline renderer (user-owned; see docs/2026-06-05-statusline-redesign-design.md).
// Reads Claude Code statusline JSON on stdin, prints two lines on stdout.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

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
  return `${colorFor(p)}${bar} ${p}%${RESET}`;
}

const RED = '\x1b[31m';
const EFFORT_COLORS = { low: GREEN, medium: GREEN, high: YELLOW, xhigh: ORANGE, max: RED };

// effort.level is one of low|medium|high|xhigh|max, or absent when the model
// does not support the effort parameter. Unknown/absent => no segment.
function formatEffort(level) {
  if (!level || !(level in EFFORT_COLORS)) return '';
  return `${EFFORT_COLORS[level]}effort: ${level}${RESET}`;
}

// Deterministic 32-bit FNV-1a hash of a string. Stable across runs and
// platforms; used to map session_id to a quote index. Returns an unsigned int.
function hash(str) {
  if (!str) return 0x811c9dc5 >>> 0;
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

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

// Deterministic per-session quote selection. Empty/absent list => ''.
// Missing/empty session => index 0.
function pickQuote(quotes, session) {
  if (!quotes || quotes.length === 0) return '';
  if (!session) return quotes[0];
  const idx = hash(session) % quotes.length;
  return quotes[idx];
}

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

// The cache value looks like "⏱ 66h"; strip the icon and relabel.
function formatPlaytime(raw) {
  const v = String(raw || '').replace(/^⏱\s*/, '').trim() || '0h';
  return `Hours spent in Gielinor: ${v}`;
}

// Visible width of a string, ignoring ANSI color codes. Line-1 content is all
// Line 1 = identity + location + current task/state, all pipe-separated.
// Line 2 = meters + playtime. Absent segments are dropped so separators never
// collapse to " │ │ ".
function composeLines({ model, effort, branch, pathSeg, middle, ctxBar, usageBar, playtime }) {
  const line1 = [model, effort, branch, pathSeg, middle].filter(Boolean).join(' │ ');
  const ctxSeg = ctxBar ? `ctx ${ctxBar}` : '';
  const usageSeg = usageBar ? `5h ${usageBar}` : '';
  const line2 = [ctxSeg, usageSeg, playtime].filter(Boolean).join(' │ ');
  return line2 ? `${line1}\n${line2}` : line1;
}

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
    model, effort, branch: branch || '', pathSeg,
    middle, ctxBar, usageBar, playtime,
  });
}

// Current branch name, or '' outside a repo / on detached HEAD. Never throws.
function detectBranch(dir) {
  try {
    const r = spawnSync('git', ['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD'],
      { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = r.status === 0 ? r.stdout.toString().trim() : '';
    if (!out || out === 'HEAD') {
      const r2 = spawnSync('git', ['-C', dir, 'symbolic-ref', '--short', 'HEAD'],
        { stdio: ['ignore', 'pipe', 'ignore'] });
      out = r2.status === 0 ? r2.stdout.toString().trim() : '';
    }
    return out === 'HEAD' ? '' : out;
  } catch (e) {
    return '';
  }
}

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
    // No version marker → treat as v1 (compatible). require() below is still try/catch-guarded.
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

// Replicates gsd-statusline.js's context-monitor bridge file so the existing
// low-context PostToolUse warning keeps working. Best-effort; never throws.
function writeBridge(data, session, tmpDir) {
  try {
    const remaining = data.context_window && data.context_window.remaining_percentage;
    if (remaining == null) return;
    const safe = session && !/[/\\\n\r]|\.\./.test(session);
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
      const gsdMiddle = task ? '' : getGsdMiddle(dir, path.join(claudeDir, 'hooks', 'gsd-statusline.js'));
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

module.exports = {
  renderBar, formatEffort, formatModel, shortenPath, formatPath,
  formatPlaytime, composeLines, buildOutput, detectBranch,
  readActiveTask, getGsdMiddle, writeBridge,
  hash, loadQuotes, pickQuote,
};

if (require.main === module) runStatusline();
