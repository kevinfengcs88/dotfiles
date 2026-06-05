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
