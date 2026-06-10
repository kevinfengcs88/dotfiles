# Claude Code Setup (cross-machine)

This setup is unified across the Pop!\_OS desktop and the MacBook Pro from this
repo. One command converges a machine:

```bash
git clone <this-repo> ~/dotfiles && cd ~/dotfiles && ./install.sh
# then run any TODO commands the auth report prints
```

`./install.sh --skip-claude` re-stows only (fast); plain `./install.sh` also runs
the Claude setup + auth report.

## The three buckets

1. **Authored files** — tracked here, symlinked by stow: `home/.claude/settings.json`,
   `home/.claude/CLAUDE.md`, `home/.claude/statusline-command.sh`,
   `home/.claude/hooks/timestamp-tooluse.cjs`, `home/.claude/hooks/lib/git-cmd.js`,
   `home/.claude/playtime/**`, `home/.serena/serena_config.yml` (Serena dashboard
   disabled; its `projects:` list is machine-specific — safe to let it differ per host).
2. **Tool-managed** — reinstalled by `install.sh`, never symlinked: npm globals,
   `headroom-ai`, `rtk` (+ `RTK.md` / `rtk-rewrite.sh` / `.rtk-hook.sha256`,
   dropped by running 'rtk init -g' once), Claude plugins, MCP server registrations,
   gitnexus's own hooks/skills.
3. **Per-machine state & secrets** — never synced: `~/.claude.json`,
   `~/.claude/.credentials.json`, history/sessions/projects, the github MCP token.

## Tools and why

| Tool | What it is | Install |
|---|---|---|
| Claude Code | the CLI | `npm i -g @anthropic-ai/claude-code` |
| headroom | context compressor; run via `headroom wrap claude` | `python3 -m pip install --user headroom-ai` |
| rtk | Rust Token Killer — rewrites Bash commands for token savings (PreToolUse hook) | `cargo install --git https://github.com/rtk-ai/rtk rtk` |
| Serena | LSP-based local code intelligence (MCP) | pulled on demand by `uvx` |
| gitnexus | code-graph context (MCP + hooks) | `npm i -g gitnexus` |
| firecrawl | web scraping CLI/plugin | `npm i -g firecrawl-cli` |
| supabase | Supabase CLI | `npm i -g supabase` |
| uv | Python tool runner (`uvx`) | https://docs.astral.sh/uv/ |

## Search policy

Serena for code/symbol search; built-in `Grep`/`Glob` for plain text; built-in
`WebSearch` for the web; context7 for library docs. **mgrep was removed**
(hosted/paid, credit-gated, and previously hard-mandated with no fallback).

## Plugins

Installed from `enabledPlugins` in `settings.json` (the enable/disable state lives
there). Marketplaces: `claude-plugins-official`, `compound-engineering-plugin`.

## MCP servers

| Server | Transport | Auth |
|---|---|---|
| serena | stdio (`uvx ...`) | none (local) |
| gitnexus | stdio (`gitnexus mcp`) | none |
| headroom | stdio (`headroom mcp serve`) | none |
| github | HTTP (`api.githubcopilot.com/mcp`) | **token** — provisioned per machine |

## Per-machine auth (detect-and-instruct)

`install.sh` ends with a read-only auth report. Run whatever it flags `TODO`:

- **claude** — run `claude` once and log in.
- **github MCP** — `TOKEN=$(gh auth token)` (or a PAT with Copilot access), then
  `claude mcp add -s user --transport http github https://api.githubcopilot.com/mcp --header "Authorization: Bearer $TOKEN"`.
- **headroom** — no separate login for the proxy.

## New machine runbook

```bash
git clone <this-repo> ~/dotfiles
cd ~/dotfiles && ./install.sh
rtk init -g   # drop rtk's hook files (RTK.md, rtk-rewrite.sh) into ~/.claude
# run the TODO auth commands the report prints
exec zsh   # pick up the claudeh / hclaude / hc aliases
```
