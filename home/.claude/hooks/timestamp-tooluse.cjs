#!/usr/bin/env node
// PreToolUse hook: surfaces a compact local-time stamp before every tool call,
// so a scrolled-back session reads "I ran Bash at 14:32:07".
//
// Output goes in the `systemMessage` field — shown to the user in the transcript,
// NOT fed to the model (keeps it out of context) and never blocks the tool.
// Tracked in dotfiles and wired via ~/.claude/settings.json so it behaves the
// same on Linux and macOS.
'use strict';

const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', () => {
  let toolName = '';
  try {
    const input = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    toolName = String(input.tool_name || '').trim();
  } catch {
    // Malformed stdin must never block the tool; fall through with no tool name.
  }

  // Local wall-clock HH:MM:SS — readable when reviewing a session by hand.
  const time = new Date().toTimeString().slice(0, 8);
  const label = toolName ? `⏱ ${time} · ${toolName}` : `⏱ ${time}`;

  process.stdout.write(JSON.stringify({ systemMessage: label }));
  process.exit(0);
});
