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

    # Disabled = explicitly false. Strip the @marketplace suffix for readability.
    disabled = sorted(
        name.split("@", 1)[0]
        for name, enabled in merged.items()
        if enabled is False
    )

    if not disabled:
        return  # Nothing disabled -> stay quiet, no noise.

    names = ", ".join(disabled)
    count = len(disabled)
    system_message = (
        f"\U0001f50c {count} installed plugin{'s' if count != 1 else ''} "
        f"disabled this session: {names}. Run /plugin to enable before you need them."
    )
    additional_context = (
        "These plugins are INSTALLED but DISABLED this session (kept off to save "
        f"context): {names}. If the user's task would be served by one of them "
        "(e.g. 'playwright' for browser automation/screenshots, a '*-lsp' for "
        "language-server features), proactively remind the user to enable it via "
        "/plugin before proceeding rather than working around its absence."
    )

    print(json.dumps({
        "systemMessage": system_message,
        "hookSpecificOutput": {
            "hookEventName": "SessionStart",
            "additionalContext": additional_context,
        },
    }))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Never let a hook error block session start.
        sys.exit(0)
