# Unify Claude Config Across Machines — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Claude Code setup identical and reproducible across the Pop!\_OS desktop and the MacBook Pro, driven from `~/dotfiles`, with one idempotent `install.sh` that symlinks authored config, installs every tool/plugin/MCP server, tears down mgrep, and reports auth that must be done by hand.

**Architecture:** Three buckets. (1) Authored files (`settings.json`, `CLAUDE.md`, `hooks/lib/git-cmd.js`) are tracked in `~/dotfiles/home/.claude/` and symlinked by GNU stow. (2) Tool-managed artifacts (npm globals, pip packages, the rtk binary + its installer-dropped hook files, Claude plugins, MCP server registrations) are (re)installed idempotently by `install.sh`, never symlinked. (3) Per-machine state and secrets (`~/.claude.json`, credentials, the github MCP token) are never synced; auth is detect-and-instruct.

**Tech Stack:** Bash, GNU stow, `jq`, npm (nvm node v22.22.3), `uv`/`uvx`, `cargo`, `pip --user`, Claude Code CLI (`claude plugin`, `claude mcp`).

**Reference spec:** `docs/superpowers/specs/2026-06-10-unify-claude-config-design.md`

---

## Pre-flight facts (verified on pop-os 2026-06-10)

These are the ground-truth values every task below depends on. They were read live from this machine.

- **Tracked under `home/.claude/`:** `CLAUDE.md` (symlinked ✓), `settings.json` (tracked but **drifted** — see Task 1), `statusline-command.sh`, `hooks/timestamp-tooluse.cjs` (symlinked ✓), `playtime/**`.
- **`~/.claude/settings.json` is a real file** (`rw-------`), not a symlink — it has drifted ahead of the repo. The **only** difference between the live file and the tracked repo copy is the rtk hook block (the live file has it; the repo copy does not).
- **`~/.claude/CLAUDE.md`** is correctly symlinked → `../dotfiles/home/.claude/CLAUDE.md`. Editing the repo copy updates both machines.
- **`~/.serena/serena_config.yml` is now tracked & symlinked** → `../dotfiles/home/.serena/serena_config.yml` (committed `d7a93e9`, pushed). `web_dashboard` and `web_dashboard_open_on_launch` are both `false` (no GUI spawns on launch). Caveat: the `projects:` list at the bottom is machine-specific — see Task 8.
- **A leaked `~/dotfiles/.serena/` dir** (`cache/`, `memories/`) sits untracked at the repo root — Serena project-state from running in the repo. Gitignored in Task 5 (root-anchored, so it does **not** touch the tracked `home/.serena/`).
- **mgrep is still fully present:** npm global `@mixedbread/mgrep@0.1.13`; plugin `mgrep@Mixedbread-Grep` (enabled); marketplace `Mixedbread-Grep`; hook `~/.claude/hooks/mgrep-enforce.cjs` (wired in `settings.json`); CLAUDE.md mandate (lines 3–12).
- **rtk binary is NOT installed** (`which rtk` → not found; `cargo install --list` shows only yazi). The installer-dropped files **do** exist: `~/.claude/RTK.md`, `~/.claude/hooks/rtk-rewrite.sh`, `~/.claude/hooks/.rtk-hook.sha256`. The hook is **defensive**: if `rtk` is absent it prints a stderr warning and `exit 0` (no failure). So the wired rtk hook is currently a harmless no-op.
- **Deps present:** `jq` (`/usr/bin/jq`), `cargo` (`~/.cargo/bin/cargo`), `uv` 0.11.13, node v22.22.3, `claude` 2.1.170, `stow`.
- **MCP servers (user scope, in `~/.claude.json`):**
  - `serena` → `uvx --from git+https://github.com/oraios/serena serena start-mcp-server --project-from-cwd --context claude-code`
  - `gitnexus` → **stale** absolute path `/home/kevin/.nvm/versions/node/v22.6.0/bin/gitnexus mcp` (real binary is under `v22.22.3`)
  - `headroom` → `headroom mcp serve`
  - `github` → HTTP `https://api.githubcopilot.com/mcp`. The plaintext `ghp_` PAT was **revoked + deleted on 2026-06-10**, so this server currently shows `✘ Failed to connect`. Reprovisioned during execution (Task 9, Step 3) from `gh auth token` — never a stored secret.
- **Plugin marketplaces:** `claude-plugins-official`, `compound-engineering-plugin`, `Mixedbread-Grep` (remove), `ecc` (remove — orphaned, plugin already gone).
- **`enabledPlugins` in tracked settings.json** (the authoritative install set; keys are `name@marketplace`): 20 entries, of which `mgrep@Mixedbread-Grep` is removed, leaving **19 to install** (enabled or disabled — install all 19; the enable/disable state lives in tracked `settings.json`).

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `~/dotfiles/home/.claude/settings.json` | Modify | Canonical Claude settings (adopt live, keep rtk hook, strip all mgrep + ecc) |
| `~/dotfiles/home/.claude/CLAUDE.md` | Modify | Swap mgrep mandate → Serena/built-in search policy; keep `@RTK.md` |
| `~/dotfiles/home/.claude/hooks/lib/git-cmd.js` | Create (track) | Newly track the hand-authored git-classifier helper |
| `~/dotfiles/install.sh` | Modify | Add preflight + guarded Claude section + auth report + `--skip-claude` |
| `~/dotfiles/docs/claude-setup.md` | Create | Human-readable "what/why" runbook |
| `~/dotfiles/README.md` | Modify | One-line pointer to `docs/claude-setup.md` |
| `~/dotfiles/home/.serena/serena_config.yml` | (already tracked, `d7a93e9`) | Serena config — dashboard disabled; symlinked; install.sh's stow step maintains it |
| `~/dotfiles/.gitignore` | Modify | **Root-anchored** ignore of the leaked `/.serena/` repo-root dir (must NOT match the tracked `home/.serena/`) |
| `~/.claude/hooks/mgrep-enforce.cjs` | Delete (live only) | Unwired + removed by teardown |

**NOT tracked (installer-owned):** `~/.claude/RTK.md`, `~/.claude/hooks/rtk-rewrite.sh`, `~/.claude/hooks/.rtk-hook.sha256` (rtk installer drops + integrity-checks these), `~/.claude/hooks/gitnexus/**` and `skills/gitnexus-*` (gitnexus-owned), all plugin caches.

**Testing note:** This is shell/config work, so "tests" are **verification asserts** — a command plus its expected output that proves the desired end-state. Idempotency is verified by running a step twice.

---

### Task 1: Fix `settings.json` drift — adopt live as canonical, re-symlink

**Files:**
- Modify: `~/dotfiles/home/.claude/settings.json`
- Touch (live): `~/.claude/settings.json` (real file → symlink)

- [ ] **Step 1: Verify the only drift is the rtk hook block**

Run:
```bash
diff <(cat ~/dotfiles/home/.claude/settings.json) <(cat ~/.claude/settings.json)
```
Expected: the only added lines are the `"matcher": "Bash"` → `rtk-rewrite.sh` hook block (9 lines). If anything else differs, STOP and re-inspect before continuing.

- [ ] **Step 2: Adopt the live copy as canonical**

Run:
```bash
cp ~/.claude/settings.json ~/dotfiles/home/.claude/settings.json
```
This brings the rtk hook into the tracked file. (mgrep + ecc are still present — stripped in Task 2.)

- [ ] **Step 3: Remove the drifted real file and re-symlink via stow**

Run:
```bash
rm ~/.claude/settings.json
cd ~/dotfiles && stow -R -t "$HOME" home
```

- [ ] **Step 4: Verify `settings.json` is now a symlink into the repo**

Run:
```bash
ls -l ~/.claude/settings.json
```
Expected: `... ~/.claude/settings.json -> ../dotfiles/home/.claude/settings.json` (symlink).

- [ ] **Step 5: Verify it is still valid JSON**

Run:
```bash
jq -e . ~/.claude/settings.json >/dev/null && echo OK
```
Expected: `OK`

- [ ] **Step 6: Commit**

```bash
cd ~/dotfiles
git add home/.claude/settings.json
git commit -m "fix(claude): adopt live settings.json (rtk hook) as canonical, re-symlink"
```

---

### Task 2: Strip all mgrep + ecc from tracked `settings.json`

`settings.json` is now a symlink, so editing the repo file edits the live config too. Remove four things: the mgrep-enforce hook block, the mgrep plugin entry, the `Mixedbread-Grep` marketplace, and the orphaned `ecc` marketplace. **Keep** the rtk and gitnexus hooks.

**Files:**
- Modify: `~/dotfiles/home/.claude/settings.json`

- [ ] **Step 1: Remove the mgrep-enforce PreToolUse hook block**

Edit `~/dotfiles/home/.claude/settings.json` — delete this object from `hooks.PreToolUse` (including the trailing comma that separates it from the next block):

```json
      {
        "matcher": "Grep|Bash|WebSearch",
        "hooks": [
          {
            "type": "command",
            "command": "node \"$HOME/.claude/hooks/mgrep-enforce.cjs\"",
            "timeout": 5
          }
        ]
      },
```

- [ ] **Step 2: Remove the mgrep plugin entry**

In `enabledPlugins`, delete the line:

```json
    "mgrep@Mixedbread-Grep": true,
```

- [ ] **Step 3: Remove the `Mixedbread-Grep` marketplace**

In `extraKnownMarketplaces`, delete:

```json
    "Mixedbread-Grep": {
      "source": {
        "source": "github",
        "repo": "mixedbread-ai/mgrep"
      }
    },
```

- [ ] **Step 4: Remove the orphaned `ecc` marketplace**

In `extraKnownMarketplaces`, delete (mind the trailing comma on the now-last entry — `compound-engineering-plugin` must remain valid):

```json
    "ecc": {
      "source": {
        "source": "git",
        "url": "https://github.com/affaan-m/ECC.git"
      }
    }
```

- [ ] **Step 5: Verify the file is still valid JSON and mgrep/ecc are gone**

Run:
```bash
jq -e . ~/.claude/settings.json >/dev/null && echo "JSON OK"
grep -c -iE 'mgrep|mixedbread|ecc' ~/.claude/settings.json
```
Expected: `JSON OK` then `0`.

- [ ] **Step 6: Verify the rtk and gitnexus hooks survived**

Run:
```bash
jq -r '.hooks.PreToolUse[].hooks[].command' ~/.claude/settings.json | grep -E 'rtk-rewrite|gitnexus'
```
Expected: both `rtk-rewrite.sh` and the gitnexus hook command appear.

- [ ] **Step 7: Commit**

```bash
cd ~/dotfiles
git add home/.claude/settings.json
git commit -m "chore(claude): remove mgrep hook/plugin/marketplace and orphaned ecc from settings"
```

---

### Task 3: Replace the mgrep mandate in `CLAUDE.md` with the Serena/built-in search policy

**Files:**
- Modify: `~/dotfiles/home/.claude/CLAUDE.md`

- [ ] **Step 1: Replace the search-tools section**

Edit `~/dotfiles/home/.claude/CLAUDE.md`. Replace lines 3–12 (the entire `## Search Tools — Use mgrep` block) with:

```markdown
## Search Tools

- **Code/symbol search:** prefer Serena (LSP-based, local) — `find_symbol`, `find_referencing_symbols`, `get_symbols_overview`. Built-in `Grep`/`Glob` are fine for plain text/file search.
- **Web search:** use the built-in `WebSearch` tool.
- **Library/framework docs:** use context7 (`resolve-library-id` → `query-docs`).
- mgrep has been removed (paid, credit-gated); do not reference it.
```

Leave the `@RTK.md` include (line 14) untouched.

- [ ] **Step 2: Verify the mandate is gone and `@RTK.md` remains**

Run:
```bash
grep -ci mgrep ~/.claude/CLAUDE.md
grep -c '@RTK.md' ~/.claude/CLAUDE.md
```
Expected: `1` (only the "mgrep has been removed" line) then `1`.

- [ ] **Step 3: Commit**

```bash
cd ~/dotfiles
git add home/.claude/CLAUDE.md
git commit -m "docs(claude): replace mgrep search mandate with Serena/built-in policy"
```

---

### Task 4: Track the hand-authored `hooks/lib/git-cmd.js`

It is a self-contained git-subcommand classifier (the single source of truth for git-commit detection), hand-authored, not owned by any installer. Newly track it so both machines have it.

**Files:**
- Create: `~/dotfiles/home/.claude/hooks/lib/git-cmd.js` (copy of the live file)

- [ ] **Step 1: Copy the live file into the repo, preserving the path**

Run:
```bash
mkdir -p ~/dotfiles/home/.claude/hooks/lib
cp ~/.claude/hooks/lib/git-cmd.js ~/dotfiles/home/.claude/hooks/lib/git-cmd.js
```

- [ ] **Step 2: Re-symlink so the live file points at the repo**

Run:
```bash
rm ~/.claude/hooks/lib/git-cmd.js
cd ~/dotfiles && stow -R -t "$HOME" home
ls -l ~/.claude/hooks/lib/git-cmd.js
```
Expected: `~/.claude/hooks/lib/git-cmd.js -> ../../../dotfiles/home/.claude/hooks/lib/git-cmd.js` (symlink).

- [ ] **Step 3: Verify it still parses as JS**

Run:
```bash
node --check ~/.claude/hooks/lib/git-cmd.js && echo OK
```
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
cd ~/dotfiles
git add home/.claude/hooks/lib/git-cmd.js
git commit -m "feat(claude): track hand-authored hooks/lib/git-cmd.js"
```

---

### Task 5: Gitignore the leaked repo-root `/.serena/` (without touching tracked `home/.serena/`)

Running Serena with cwd inside `~/dotfiles` left a `~/dotfiles/.serena/` dir (`cache/`, `memories/`) at the repo root. Ignore it. **Critical:** the rule must be **root-anchored** (`/.serena/`) — a bare `.serena/` would also match the now-tracked `home/.serena/serena_config.yml` (committed in `d7a93e9`) and is wrong.

**Files:**
- Modify: `~/dotfiles/.gitignore`

- [ ] **Step 1: Append the root-anchored ignore rule**

Edit `~/dotfiles/.gitignore` — append at the end:

```gitignore

# Serena project-state leaked at the repo root (regenerated locally, never commit).
# Root-anchored on purpose: must NOT match the tracked home/.serena/ config.
/.serena/
```

- [ ] **Step 2: Verify the leaked dir is ignored**

Run:
```bash
cd ~/dotfiles && git check-ignore -v .serena/ && echo IGNORED
```
Expected: a line citing `.gitignore` and `/.serena/`, then `IGNORED`.

- [ ] **Step 3: Verify the tracked serena config is NOT ignored**

Run:
```bash
cd ~/dotfiles && git check-ignore home/.serena/serena_config.yml; echo "exit=$?"
```
Expected: no output and `exit=1` (the tracked file is not matched by the ignore rule).

- [ ] **Step 4: Commit**

```bash
cd ~/dotfiles
git add .gitignore
git commit -m "chore: gitignore leaked repo-root /.serena/ state"
```

---

### Task 6: Extend `install.sh` — preflight + guarded Claude install section

Add an OS-detecting preflight and a `claude_setup()` function that idempotently installs runtimes-checks, npm globals (minus mgrep), `headroom-ai`, `rtk`, Claude plugins, and MCP servers, then tears down mgrep. Gate the whole section behind a `--skip-claude` flag so routine re-stows stay instant. The existing stow behavior is preserved.

**Files:**
- Modify: `~/dotfiles/install.sh`

- [ ] **Step 1: Add `--skip-claude` parsing and OS detection near the top**

Edit `~/dotfiles/install.sh`. Immediately after the `REPO_DIR="..."` line, insert:

```bash
# --- flags -------------------------------------------------------------------
SKIP_CLAUDE=0
ACTION="link"
for arg in "$@"; do
  case "$arg" in
    --skip-claude) SKIP_CLAUDE=1 ;;
    --delete|-D)   ACTION="delete" ;;
  esac
done

# --- os detect ---------------------------------------------------------------
case "$(uname -s)" in
  Darwin) OS="mac"   ;;
  Linux)  OS="linux" ;;
  *)      OS="other" ;;
esac
```

- [ ] **Step 2: Replace the `--delete` branch condition to use `$ACTION`**

In the existing `if [ "${1:-}" = "--delete" ] ...` block, change the condition from positional `$1` checks to:

```bash
if [ "$ACTION" = "delete" ]; then
```
(Leaving the body of the delete branch unchanged.)

- [ ] **Step 3: Add the `claude_setup` function before the final `if/else` stow block**

Insert this complete function definition just above the `if [ "$ACTION" = "delete" ]; then` line:

```bash
# -----------------------------------------------------------------------------
# claude_setup — idempotently install every tool/plugin/MCP the Claude setup
# needs. Each step checks "already present?" and skips fast.
# -----------------------------------------------------------------------------
claude_setup() {
  echo "==> Claude setup"

  # 0. required runtimes (report-only; do not auto-install language runtimes)
  for bin in node npm uv cargo jq claude; do
    command -v "$bin" >/dev/null 2>&1 || echo "  ! missing: $bin (install it, then re-run)"
  done

  # 1. npm globals (mgrep intentionally excluded)
  local npm_globals=(@anthropic-ai/claude-code gitnexus firecrawl-cli supabase)
  for pkg in "${npm_globals[@]}"; do
    if npm ls -g --depth=0 "$pkg" >/dev/null 2>&1; then
      echo "  = npm $pkg"
    else
      echo "  + npm install -g $pkg"; npm install -g "$pkg"
    fi
  done

  # 2. headroom (context compressor; pip --user package is headroom-ai)
  if command -v headroom >/dev/null 2>&1; then
    echo "  = headroom"
  else
    echo "  + pip install --user headroom-ai"; pip install --user headroom-ai
  fi

  # 3. rtk (Rust Token Killer; defensive hook no-ops until present)
  #    Upstream: https://github.com/rtk-ai/rtk  (needs rtk >= 0.23.0)
  if command -v rtk >/dev/null 2>&1; then
    echo "  = rtk ($(rtk --version 2>/dev/null | head -1))"
  else
    echo "  + cargo install rtk"; cargo install rtk
  fi

  # 4. plugin marketplaces (drop Mixedbread-Grep + ecc)
  local marketplaces_official="anthropics/claude-plugins-official"
  local marketplaces_ce="EveryInc/compound-engineering-plugin"
  claude plugin marketplace list 2>/dev/null | grep -q claude-plugins-official \
    || claude plugin marketplace add "$marketplaces_official"
  claude plugin marketplace list 2>/dev/null | grep -q compound-engineering-plugin \
    || claude plugin marketplace add "$marketplaces_ce"

  # 5. plugins — install every entry from tracked settings.json enabledPlugins,
  #    except mgrep. Enable/disable state itself lives in settings.json.
  local installed; installed="$(claude plugin list 2>/dev/null || true)"
  while IFS= read -r plugin; do
    [ -z "$plugin" ] && continue
    case "$plugin" in *mgrep*) continue ;; esac
    if printf '%s\n' "$installed" | grep -q "${plugin%@*}"; then
      echo "  = plugin $plugin"
    else
      echo "  + plugin install $plugin"; claude plugin install "$plugin" || true
    fi
  done < <(jq -r '.enabledPlugins | keys[]' "$REPO_DIR/home/.claude/settings.json")

  # 6. MCP servers (user scope). Re-register gitnexus with a PATH-stable command.
  local mcp_existing; mcp_existing="$(claude mcp list 2>/dev/null || true)"
  printf '%s\n' "$mcp_existing" | grep -q '^serena' \
    || claude mcp add -s user serena -- uvx --from git+https://github.com/oraios/serena serena start-mcp-server --project-from-cwd --context claude-code
  # gitnexus: always re-register to drop any stale nvm-pinned absolute path.
  claude mcp remove gitnexus -s user >/dev/null 2>&1 || true
  claude mcp add -s user gitnexus -- gitnexus mcp
  printf '%s\n' "$mcp_existing" | grep -q '^headroom' \
    || claude mcp add -s user headroom -- headroom mcp serve
  # github is HTTP + secret token — handled in the auth report, not here.

  # 7. mgrep teardown (idempotent)
  npm ls -g --depth=0 @mixedbread/mgrep >/dev/null 2>&1 && npm uninstall -g @mixedbread/mgrep || true
  claude plugin uninstall mgrep@Mixedbread-Grep >/dev/null 2>&1 || true
  claude plugin marketplace remove Mixedbread-Grep >/dev/null 2>&1 || true
  rm -f "$HOME/.claude/hooks/mgrep-enforce.cjs"
  echo "  - mgrep torn down"
}
```

- [ ] **Step 4: Call `claude_setup` after stow in the link branch**

In the `else` (link) branch, after the `run_stow -R -t "$HOME" home` block and its `echo "Done. ..."`, add:

```bash
  if [ "$SKIP_CLAUDE" -eq 0 ]; then
    claude_setup
    claude_auth_report   # defined in Task 7
  else
    echo "Skipping Claude setup (--skip-claude)."
  fi
```

- [ ] **Step 5: Verify the script parses (no execution yet)**

Run:
```bash
bash -n ~/dotfiles/install.sh && echo "syntax OK"
```
Expected: `syntax OK`. (Will reference `claude_auth_report` — that is fine for `bash -n`; it is added in Task 7 before any real run.)

- [ ] **Step 6: Commit**

```bash
cd ~/dotfiles
git add install.sh
git commit -m "feat(install): add guarded Claude setup section with mgrep teardown and --skip-claude"
```

---

### Task 7: `install.sh` — auth detect-and-instruct report

Add a read-only `claude_auth_report()` that probes each auth-requiring piece and prints the exact fix command for anything missing. **No secrets are stored or written.**

**Files:**
- Modify: `~/dotfiles/install.sh`

- [ ] **Step 1: Add the `claude_auth_report` function**

Insert this complete function just below the `claude_setup` function:

```bash
# -----------------------------------------------------------------------------
# claude_auth_report — probe auth-requiring pieces; print fix commands. Never
# stores or writes any secret. github MCP token is supplied by the user here.
# -----------------------------------------------------------------------------
claude_auth_report() {
  echo "==> Auth report (read-only)"

  # Claude login
  if claude mcp list >/dev/null 2>&1; then
    echo "  ok  claude: CLI responds (logged in)"
  else
    echo "  TODO claude: run 'claude' once and complete login"
  fi

  # github MCP (HTTP, needs a GitHub token with Copilot/MCP access)
  if claude mcp get github 2>/dev/null | grep -q 'Connected'; then
    echo "  ok  github MCP: connected"
  else
    echo "  TODO github MCP: provision a token, then register it:"
    echo "        TOKEN=\$(gh auth token)   # or a PAT with Copilot access"
    echo "        claude mcp add -s user --transport http github https://api.githubcopilot.com/mcp --header \"Authorization: Bearer \$TOKEN\""
  fi

  # headroom: the proxy uses Claude's own backend (--backend anthropic);
  # no separate login is required for `headroom wrap claude`.
  if command -v headroom >/dev/null 2>&1; then
    echo "  ok  headroom: installed (run 'headroom wrap claude'; no separate login for the proxy)"
  else
    echo "  TODO headroom: pip install --user headroom-ai"
  fi

  # serena: local, no auth.
  echo "  ok  serena: local (no auth)"

  echo "  note: aliases 'claudeh' / 'hclaude' / 'hc' run 'headroom wrap claude' (see ~/.zshrc)"
}
```

- [ ] **Step 2: Verify the script still parses**

Run:
```bash
bash -n ~/dotfiles/install.sh && echo "syntax OK"
```
Expected: `syntax OK`

- [ ] **Step 3: Dry-run just the auth report (safe, read-only)**

Run:
```bash
source <(sed -n '/^claude_auth_report() {/,/^}/p' ~/dotfiles/install.sh) && claude_auth_report
```
Expected: an `ok`/`TODO` line per item. Since the old github PAT was deleted, github shows **`TODO github MCP: provision a token ...`** (reprovisioned in Task 9, Step 3); `serena: local (no auth)` and headroom `ok`.

- [ ] **Step 4: Commit**

```bash
cd ~/dotfiles
git add install.sh
git commit -m "feat(install): add detect-and-instruct auth report (no secrets stored)"
```

---

### Task 8: Write `docs/claude-setup.md` + README pointer

**Files:**
- Create: `~/dotfiles/docs/claude-setup.md`
- Modify: `~/dotfiles/README.md`

- [ ] **Step 1: Create `docs/claude-setup.md`**

Write this file:

```markdown
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
   `headroom-ai`, `rtk` (+ its installer-dropped `RTK.md` / `rtk-rewrite.sh` /
   `.rtk-hook.sha256`), Claude plugins, MCP server registrations, gitnexus's own
   hooks/skills.
3. **Per-machine state & secrets** — never synced: `~/.claude.json`,
   `~/.claude/.credentials.json`, history/sessions/projects, the github MCP token.

## Tools and why

| Tool | What it is | Install |
|---|---|---|
| Claude Code | the CLI | `npm i -g @anthropic-ai/claude-code` |
| headroom | context compressor; run via `headroom wrap claude` | `pip install --user headroom-ai` |
| rtk | Rust Token Killer — rewrites Bash commands for token savings (PreToolUse hook) | `cargo install rtk` |
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
# run the TODO auth commands the report prints
exec zsh   # pick up the claudeh / hclaude / hc aliases
```
```

- [ ] **Step 2: Add a pointer to `README.md`**

Edit `~/dotfiles/README.md` — add under the top section:

```markdown
- **Claude Code setup:** see [docs/claude-setup.md](docs/claude-setup.md) for the unified cross-machine Claude config (tools, plugins, MCP servers, aliases, auth).
```

- [ ] **Step 3: Verify both files exist and render the link**

Run:
```bash
test -f ~/dotfiles/docs/claude-setup.md && grep -q 'claude-setup.md' ~/dotfiles/README.md && echo OK
```
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
cd ~/dotfiles
git add docs/claude-setup.md README.md
git commit -m "docs: add cross-machine claude-setup runbook + README pointer"
```

---

### Task 9: End-to-end idempotency run on this machine + verify mgrep is fully gone

**Files:** none (verification + the spec/plan docs commit)

- [ ] **Step 1: Run the full installer once**

Run:
```bash
cd ~/dotfiles && ./install.sh
```
Expected: stow links, then `==> Claude setup` with mostly `=` (already-present) lines, `- mgrep torn down`, then `==> Auth report`. github shows **`TODO`** (PAT was deleted) — reprovisioned in Step 3 below; serena/headroom/claude show `ok`.

- [ ] **Step 2: Run it again — must be idempotent and quick**

Run:
```bash
cd ~/dotfiles && ./install.sh --skip-claude && echo "RE-STOW OK"
```
Expected: stow output then `Skipping Claude setup (--skip-claude).` then `RE-STOW OK`.

- [ ] **Step 3: Reprovision the github MCP server from `gh auth token` (folded into execution)**

The old plaintext PAT was deleted, so github MCP is `✘ Failed to connect`. Re-register it using the `gh` CLI's keyring token (scopes present on this machine: `repo`, `read:org`, `workflow`, `gist`) — no secret is written to the repo.

Run:
```bash
claude mcp remove github -s user >/dev/null 2>&1 || true
TOKEN=$(gh auth token)
claude mcp add -s user --transport http github https://api.githubcopilot.com/mcp \
  --header "Authorization: Bearer $TOKEN"
unset TOKEN
claude mcp get github 2>&1 | grep -E 'Status|URL'
```
Expected: `Status: ✔ Connected`. If it still fails, the Copilot MCP endpoint needs a token with Copilot access — create a fine-grained PAT and substitute it for `$(gh auth token)`; the command is otherwise identical.

- [ ] **Step 4: Assert mgrep is fully absent**

Run:
```bash
echo "npm:"; npm ls -g --depth=0 2>/dev/null | grep -i mgrep || echo "  none"
echo "plugin/mkt:"; claude plugin marketplace list 2>/dev/null | grep -i mixedbread || echo "  none"
echo "hook:"; test -e ~/.claude/hooks/mgrep-enforce.cjs && echo "  STILL PRESENT" || echo "  gone"
echo "settings:"; grep -ci mgrep ~/.claude/settings.json
echo "CLAUDE.md mandate:"; grep -ci 'MANDATORY' ~/.claude/CLAUDE.md
```
Expected: `none`, `none`, `gone`, `0`, `0`.

- [ ] **Step 5: Assert the keepers are healthy**

Run:
```bash
claude mcp list 2>/dev/null | grep -E 'serena|gitnexus|headroom|github'
which rtk && rtk --version
```
Expected: all four MCP servers `Connected` (github now reconnected via Step 3); gitnexus command no longer the stale `v22.6.0` path; `rtk` resolves with version `>= 0.23.0`.
> If `rtk` is still missing, see Task 10 — its install command is the one externally-dependent step.

- [ ] **Step 6: Commit the spec + plan docs**

```bash
cd ~/dotfiles
git add docs/superpowers/specs/2026-06-10-unify-claude-config-design.md docs/superpowers/plans/2026-06-10-unify-claude-config.md
git commit -m "docs: add unify-claude-config design spec and implementation plan"
```

---

### Task 10: Resolve the one external unknown — rtk install (verify, fix if needed)

`cargo install rtk` is the command the rtk hook itself documents, but `RTK.md` warns of a **name collision** with `reachingforthejack/rtk` (a different crate). This task verifies the right binary landed and corrects course if not. Run only if Task 9 Step 4 showed `rtk` missing or wrong.

**Files:** none

- [ ] **Step 1: Confirm which `rtk` resolves**

Run:
```bash
which rtk && rtk --version && rtk gain --help 2>&1 | head -5
```
Expected: a version `>= 0.23.0` **and** `rtk gain` is a known subcommand (the token-savings analytics). If `rtk gain` errors with "unrecognized subcommand", you have the wrong crate (Rust Type Kit).

- [ ] **Step 2 (only if wrong/missing): install the correct rtk from upstream**

Run:
```bash
cargo install --git https://github.com/rtk-ai/rtk rtk
which rtk && rtk --version
```
Expected: `rtk` resolves, version `>= 0.23.0`, and `rtk gain` works.

- [ ] **Step 3: Verify the hook now rewrites (no longer a no-op)**

Run:
```bash
printf '{"tool_input":{"command":"git status"}}' | ~/.claude/hooks/rtk-rewrite.sh
```
Expected: JSON with `"permissionDecision": "allow"` and a rewritten command (e.g. `rtk git status`). If rtk has no rule for `git status`, the hook exits silently (also acceptable — means no warning, binary present).

- [ ] **Step 4: If Step 2 was needed, pin the correct command in install.sh**

If the plain `cargo install rtk` in Task 6 grabbed the wrong crate, edit `~/dotfiles/install.sh` — change the rtk install line in `claude_setup` from:

```bash
    echo "  + cargo install rtk"; cargo install rtk
```
to:
```bash
    echo "  + cargo install rtk (from upstream)"; cargo install --git https://github.com/rtk-ai/rtk rtk
```
Then commit:
```bash
cd ~/dotfiles
git add install.sh
git commit -m "fix(install): pin rtk to upstream git to avoid crate name collision"
```

---

## Self-Review

**Spec coverage:** auth=detect-and-instruct (Task 7) ✓; one mega install.sh (Tasks 6–7) ✓; `--skip-claude` (Task 6) ✓; remove mgrep entirely → Serena (Tasks 2, 3, 6, 9) ✓; rtk keep+install (Tasks 6, 10) ✓; headroom keep (Task 6) + `hc`/`hclaude`/`claudeh` aliases documented (Tasks 7, 8) ✓; ecc removed (Task 2) ✓; gitnexus re-registered with stable command (Task 6) ✓; leaked `/.serena/` root-anchored gitignore + tracked `home/.serena/serena_config.yml` reconciled (Task 5) ✓; github MCP reprovisioned via `gh auth token` in execution after PAT deletion (Task 9) ✓; rtk files NOT tracked / installer-owned (File Structure + Task 6) ✓; git-cmd.js tracked (Task 4) ✓; settings.json drift fixed + re-symlinked (Task 1) ✓; docs/claude-setup.md + README pointer (Task 8) ✓; acceptance criteria fresh-machine + idempotency + mgrep-absent (Task 9) ✓.

**Placeholder scan:** every code/edit step carries the literal content; the one external dependency (rtk's exact crate) is handled as an explicit verify-then-fix task (Task 10), not a TBD. github token is detect-and-instruct, never hardcoded.

**Type/identifier consistency:** function names `claude_setup` and `claude_auth_report` are defined in Tasks 6/7 and referenced consistently; `$ACTION` / `$SKIP_CLAUDE` / `$OS` introduced in Task 6 Step 1 and used thereafter; tracked-file paths match across tasks and the docs.
