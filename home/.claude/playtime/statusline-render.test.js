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
