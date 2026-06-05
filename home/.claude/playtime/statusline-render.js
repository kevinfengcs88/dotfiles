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

const RED = '\x1b[31m';
const EFFORT_COLORS = { low: GREEN, medium: GREEN, high: YELLOW, xhigh: ORANGE, max: RED };

// effort.level is one of low|medium|high|xhigh|max, or absent when the model
// does not support the effort parameter. Unknown/absent => no segment.
function formatEffort(level) {
  if (!level || !(level in EFFORT_COLORS)) return '';
  return `${EFFORT_COLORS[level]}effort: ${level}${RESET}`;
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

// Current branch name, or '' outside a repo / on detached HEAD. Never throws.
function detectBranch(dir) {
  try {
    const out = execSync(`git -C ${JSON.stringify(dir)} rev-parse --abbrev-ref HEAD`, {
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
    if (!out || out === 'HEAD') return '';
    return out;
  } catch (e) {
    // Fallback for empty repos where rev-parse fails (git 2.34+)
    try {
      const out = execSync(`git -C ${JSON.stringify(dir)} symbolic-ref --short HEAD`, {
        stdio: ['ignore', 'pipe', 'ignore'],
      }).toString().trim();
      return out || '';
    } catch (e2) {
      return '';
    }
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

module.exports = { renderBar, formatEffort, formatModel, shortenPath, formatPath, formatPlaytime, composeLines, buildOutput, detectBranch, readActiveTask };
