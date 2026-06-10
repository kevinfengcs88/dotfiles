# Unify Claude Config Across Machines — Design

**Date:** 2026-06-10
**Status:** Approved (defaults adopted), pending user review
**Machines:** Pop!\_OS desktop (`pop-os`) and MacBook Pro (`Kevins-MBP` / `Kevins-MacBook-Pro`)
**Repo:** `~/dotfiles` (stow-managed, remote `github.com/kevinfengcs88/dotfiles`)

## Goal

Make the Claude Code setup **identical and reproducible** across both machines, driven
from `~/dotfiles`. A single idempotent script (`install.sh`) should converge a machine:
symlink authored config, install every tool/plugin/MCP server, tear down removed tools,
and report any auth that must be done by hand. A human-readable companion doc records
what is installed and why.

## Non-goals

- Storing secrets/tokens in the repo. Auth stays **detect-and-instruct** (no `age`/`sops`/
  `git-crypt`, no external secret manager). The script never holds credentials.
- Syncing per-machine state (history, sessions, projects, caches, logs).

## The mental model — three buckets

Everything under `~/.claude` sorts into exactly one bucket, which determines its handling:

1. **Authored files** — written by the user → **tracked in dotfiles, symlinked by stow.**
2. **Tool-managed** — owned by an installer → **(re)installed by `install.sh`, never symlinked.**
3. **Per-machine state & secrets** — → **never synced; auth is detect-and-instruct.**

Symlinking a tool-managed file into the repo fights the tool's own updater, so the dividing
line is "who is the source of truth." Authored = repo. Installer-owned = the installer.

---

## Key decisions (this session)

| Decision | Choice |
|---|---|
| Auth strategy | **Detect & instruct** — script checks each tool, prints exact fix commands for anything missing. No secrets in repo. |
| Orchestration | **One mega `install.sh`** — folds the Claude bootstrap into the existing stow script. |
| `install.sh` structure | **(A) Monolithic** with commented sections; `--skip-claude` flag keeps routine re-stows fast. |
| Search tooling | **Remove mgrep entirely** (paid, credit-gated, hard-enforced) → **Serena** (free, local, already installed) for code search + built-in Grep/Glob; **WebSearch/context7** for web/docs. |
| mgrep removal timing | **Encode in script only** — do not mutate this machine now. |
| rtk (Rust Token Killer) | **Keep — install on both machines.** It is a command-output trimmer; complementary to headroom (context compressor). |
| headroom | **Keep** — the deliberate, actively-used context compressor (`headroom wrap claude` via `claudeh` / `hclaude` / `hc` aliases). |
| `ecc` marketplace | **Remove** (registered but plugin already removed in commit `b94bcfb`). |
| gitnexus MCP | **Re-register** with a stable PATH-based command (current config pins a stale `nvm v22.6.0` path; binary is under `v22.22.3`). |
| `.serena/` | **`.gitignore`** it (per-project tool state; one already leaked into `~/dotfiles`). |

### Why mgrep is removed (rationale, for the record)

mgrep is a thin client over Mixedbread's **hosted** platform: its `search` subcommand uploads/
syncs files to a remote store, embeds, and reranks via API. **Both local and `--web` search
consume account credits** (`login` ≠ credits — auth and quota are separate). The account is
credit-depleted, and the config makes mgrep **mandatory** (6 refs in `CLAUDE.md`) while
`mgrep-enforce.cjs` **blocks built-in Grep** — so when credits run dry, search hard-fails with
no fallback, on both machines simultaneously (shared account). Serena (LSP-based, local, free,
already configured as an MCP server) is the better code-search layer; built-in WebSearch +
context7 cover web/docs.

---

## Bucket 1 — tracked & symlinked (`home/.claude/`)

**Already tracked (working symlinks):** `CLAUDE.md`, `statusline-command.sh`,
`hooks/timestamp-tooluse.cjs`. `playtime/` runs in place from the repo (referenced by absolute
path in `settings.json`), excluded from stow by `.stow-local-ignore` — unchanged.

**Changes:**

- **`settings.json`** — currently a **drifted real file** (live copy is ahead of the repo: it
  adds the `rtk-rewrite.sh` PreToolUse hook; newer mtime). **Adopt the live copy as canonical**,
  copy it into the repo, and **re-symlink** via stow. Then edit it to **remove the
  `mgrep-enforce.cjs` hook block** (around `settings.json:87`), the `mgrep@Mixedbread-Grep`
  enabled-plugin entry (`:163`), and the `Mixedbread-Grep` marketplace entry (`:185`). Keep the
  rtk hook block.
- **`CLAUDE.md`** — strip the mandatory-mgrep section (6 refs) → replace with: "Use Serena for
  code search; built-in Grep/Glob are fine; use WebSearch/context7 for web/docs."
- **`hooks/lib/git-cmd.js`** — newly tracked (hand-authored helper).
- **`hooks/mgrep-enforce.cjs`** — **deleted** (and unwired from `settings.json`).
- **[TBD] rtk files** (`RTK.md`, `hooks/rtk-rewrite.sh`, `hooks/.rtk-hook.sha256`) — likely
  **rtk-installer-managed** (analogous to mgrep's `install-claude-code`), not hand-authored. The
  hook header says all logic lives in `rtk rewrite` (the Rust registry). If rtk's installer drops
  and integrity-checks these, **do not track them** — let the installer own them, and the script
  just runs the installer. Resolve from the Mac (see Open Items). `CLAUDE.md` pulls in `@RTK.md`,
  so the coexistence of a tracked `CLAUDE.md` with an installer that edits it must be settled.

## Bucket 2 — `install.sh` Claude section (idempotent, guarded)

Each step checks "already installed/registered?" and skips fast, so routine
`git pull && ./install.sh` stays quick; only a fresh machine does heavy network installs.

- **Ensure runtimes present:** node/npm (nvm), `uv` (present: 0.11.13), `cargo` (present),
  `pip --user`.
- **npm globals:** `@anthropic-ai/claude-code`, `gitnexus`, `firecrawl-cli`, `supabase`.
  *(Drop `@mixedbread/mgrep`.)*
- **pip --user:** `headroom-ai` (package name is `headroom-ai`; provides the `headroom` CLI).
- **cargo:** `rtk` — **[TBD exact source/command, read from Mac]**.
- **uv:** ensure installed (Serena is pulled on demand by `uvx`; no pinning).
- **Plugin marketplaces:** `claude-plugins-official`, `compound-engineering-plugin`.
  *(Drop `Mixedbread-Grep` and the unused `ecc`.)*
- **Plugins (~18 keepers):** code-review, code-simplifier, commit-commands, compound-engineering,
  context7, explanatory-output-style, feature-dev, firecrawl, frontend-design, hookify,
  playwright, pr-review-toolkit, pyright-lsp, ralph-loop, security-guidance, supabase,
  superpowers, typescript-lsp, vercel. *(Drop `mgrep`.)*
- **MCP servers** (`claude mcp add -s user`):
  - `serena` — `uvx --from git+https://github.com/oraios/serena serena start-mcp-server
    --project-from-cwd --context claude-code`
  - `gitnexus` — **stable PATH command** (`gitnexus`), not the stale nvm-pinned absolute path.
  - `headroom` — `headroom` (stdio).
  - `github` — HTTP transport `https://api.githubcopilot.com/mcp` + auth header (token: see auth).
- **rtk Claude integration** — via rtk's own installer **[TBD]**.
- **mgrep teardown (idempotent):** `npm uninstall -g @mixedbread/mgrep`;
  `claude plugin uninstall mgrep@Mixedbread-Grep`;
  `claude plugin marketplace remove Mixedbread-Grep`; delete `~/.claude/hooks/mgrep-enforce.cjs`;
  (optional) `mgrep logout` + remove `~/.config/mgrep/`.

> **Ownership note:** `skills/gitnexus-*` and `hooks/gitnexus/` are gitnexus-owned (reinstalled,
> never tracked). `skills/learned/` is currently empty — nothing to track.

## Bucket 3 — auth: detect & instruct (runs last)

Script probes each and, for anything missing, prints the exact command. No secrets stored.

- **Claude** — check login state; instruct `claude` login if needed.
- **github MCP** — check token presence; instruct how to provision the Copilot MCP token **[TBD command]**.
- **headroom** — check whether it needs auth at all **[TBD — likely none]**.
- **serena** — none (local).
- **mgrep** — N/A (removed).

---

## Documentation — `docs/claude-setup.md`

Human-readable companion (the "what/why" runbook):

- **headroom** — what it is (context compressor), `headroom wrap claude`, and the
  `claudeh` / `hclaude` / `hc` aliases in `.zshrc` (around `:149-150`).
- **Every tool and why:** Claude Code, rtk, Serena, gitnexus, firecrawl, supabase, headroom, uv.
- **Plugins** — the keeper list and their marketplaces.
- **MCP servers** — serena, gitnexus, headroom, github (+ which need auth).
- **Search policy** — Serena + built-in Grep/Glob for code; WebSearch/context7 for web/docs;
  mgrep intentionally removed (and why).
- **Per-machine auth steps** — the detect-and-instruct checklist.
- **"Set up a new machine" runbook** — `git clone … && cd ~/dotfiles && ./install.sh`, then run
  the printed auth commands.

`README.md` gets a one-line pointer to this doc.

## `install.sh` structure

Monolithic, ordered, commented sections:

```
### 0. preflight (stow present, detect OS)
### 1. stow      → existing behavior (fast, offline)   [always]
### 2. claude    → runtimes, npm globals, pip, cargo, plugins, MCP, mgrep teardown  [guarded; skip with --skip-claude]
### 3. auth      → detect & instruct report            [always, read-only]
```

- Stow first so authored config is in place before tool steps reference it.
- `--skip-claude` keeps `git pull && ./install.sh` re-stows instant.
- Each Bucket-2 step is individually guarded (`command -v X || install`,
  `claude plugin list | grep -q … || install`, etc.) for idempotency.
- Cross-platform: macOS vs Pop!\_OS branches only where install commands differ (brew vs apt for
  prereqs; everything else — npm/pip/cargo/uv/claude — is OS-agnostic).

## Cleanups folded in

- `settings.json` re-symlinked (drift fixed).
- `gitnexus` MCP re-registered with a stable command.
- `ecc` marketplace removed.
- `.gitignore` += `.serena/` (and confirm handling of `playtime/data/sessions-*.jsonl` churn).

## Open items (resolve at implementation — mostly from the Mac)

1. **rtk** — exact install command (`cargo install …`?), how its Claude integration works
   (self-installing hook + `RTK.md` vs tracked files), and how `@RTK.md` coexists with a tracked
   `CLAUDE.md`. Read from the Mac (`which rtk`, shell history, `cargo install --list`).
2. **headroom** — does it require any auth/login?
3. **github MCP** — the exact token-provisioning command for the Copilot MCP endpoint.

## Acceptance criteria

- On a fresh machine: `git clone … && cd ~/dotfiles && ./install.sh` + the printed auth steps
  yields a Claude setup identical to the other machine.
- Re-running `./install.sh` is idempotent and (with `--skip-claude`) fast.
- mgrep is fully absent (no npm global, plugin, marketplace, hook, or `CLAUDE.md` mandate);
  built-in Grep works; Serena available.
- rtk and headroom both installed and functional on both machines.
- `docs/claude-setup.md` documents every tool, plugin, MCP server, alias, and auth step.
