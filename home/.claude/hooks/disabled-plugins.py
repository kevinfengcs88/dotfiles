#!/usr/bin/env python3
"""SessionStart hook: report plugins that are installed but DISABLED.

Kevin keeps most plugins disabled by default so they don't eat context, then
forgets to enable the one he needs (e.g. playwright) until mid-task. This hook
reads the enabledPlugins maps, finds the entries set to false, and reports them:
  - systemMessage  -> shown to Kevin in the UI at session start
  - additionalContext -> injected into Claude's context so Claude can proactively
    remind him to enable a plugin when the task calls for it.

Precedence (matches Claude Code): user < project < local. Reads cwd from the
hook's stdin JSON to locate project/local settings. Fails silently (exit 0, no
output) on any error so session start is never broken.
"""
import json
import os
import sys


def load_enabled_plugins(path):
    try:
        with open(path) as f:
            data = json.load(f)
        return data.get("enabledPlugins", {}) or {}
    except (OSError, ValueError):
        return {}


def render_table(enabled, disabled):
    """Two-column ASCII table: enabled plugins beside disabled ones."""
    left_header = f"ENABLED ({len(enabled)})"
    right_header = f"DISABLED ({len(disabled)})"
    left_w = max([len(left_header)] + [len(x) for x in enabled])
    right_w = max([len(right_header)] + [len(x) for x in disabled])

    def row(left, right):
        return f"| {left.ljust(left_w)} | {right.ljust(right_w)} |"

    sep = f"+{'-' * (left_w + 2)}+{'-' * (right_w + 2)}+"
    lines = [sep, row(left_header, right_header), sep]
    for i in range(max(len(enabled), len(disabled))):
        left = enabled[i] if i < len(enabled) else ""
        right = disabled[i] if i < len(disabled) else ""
        lines.append(row(left, right))
    lines.append(sep)
    return "\n".join(lines)


def main():
    # Hook receives JSON on stdin; we only need cwd (may be absent).
    cwd = os.getcwd()
    try:
        payload = json.load(sys.stdin)
        cwd = payload.get("cwd") or cwd
    except (ValueError, OSError):
        pass

    home = os.path.expanduser("~")
    # Later sources override earlier ones (user < project < local).
    merged = {}
    for path in (
        os.path.join(home, ".claude", "settings.json"),
        os.path.join(cwd, ".claude", "settings.json"),
        os.path.join(cwd, ".claude", "settings.local.json"),
    ):
        merged.update(load_enabled_plugins(path))

    # Split into enabled (true) / disabled (false). Strip @marketplace suffix.
    enabled = sorted(
        name.split("@", 1)[0] for name, v in merged.items() if v is True
    )
    disabled = sorted(
        name.split("@", 1)[0] for name, v in merged.items() if v is False
    )

    if not enabled and not disabled:
        return  # No plugin state to report -> stay quiet.

    # Leading newline so the table starts on its own line below the
    # "SessionStart:startup says:" prefix instead of beside it.
    system_message = "\n" + render_table(enabled, disabled)

    output = {"systemMessage": system_message}

    # Only nudge Claude when something is actually disabled (the actionable case).
    if disabled:
        names = ", ".join(disabled)
        output["hookSpecificOutput"] = {
            "hookEventName": "SessionStart",
            "additionalContext": (
                "These plugins are INSTALLED but DISABLED this session (kept off "
                f"to save context): {names}. If the user's task would be served "
                "by one of them (e.g. 'playwright' for browser automation/"
                "screenshots, a '*-lsp' for language-server features), proactively "
                "remind the user to enable it via /plugin before proceeding "
                "rather than working around its absence."
            ),
        }

    print(json.dumps(output))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Never let a hook error block session start.
        sys.exit(0)
