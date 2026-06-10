#!/usr/bin/env bash
# Idempotent dotfiles installer. Safe to run repeatedly, on macOS or Linux.
#   ./install.sh            # link everything in home/ into $HOME
#   ./install.sh --delete   # unlink (remove the symlinks)
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

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
  Darwin) OS="mac" ;;
  Linux)  OS="linux" ;;
  *)      OS="other" ;;
esac

if ! command -v stow >/dev/null 2>&1; then
  echo "GNU stow is not installed."
  case "$(uname -s)" in
    Darwin) echo "  brew install stow" ;;
    Linux)  echo "  sudo apt install stow   # (Pop!_OS / Debian / Ubuntu)" ;;
  esac
  exit 1
fi

cd "$REPO_DIR"

# Run stow, filtering GNU stow 2.3.1's harmless "BUG in find_stowed_path?" noise.
# That line fires when stow scans unrelated absolute symlinks in $HOME
# (e.g. ~/.steam/...) during a restow; it is benign. Real errors still pass
# through, and stow's exit status is preserved.
run_stow() {
  local err rc=0
  err="$(mktemp)"
  stow "$@" 2>"$err" || rc=$?
  grep -v 'BUG in find_stowed_path' "$err" >&2 || true
  rm -f "$err"
  return "$rc"
}

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
    echo "  + cargo install rtk (from upstream)"; cargo install --git https://github.com/rtk-ai/rtk rtk
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

if [ "$ACTION" = "delete" ]; then
  echo "Unlinking dotfiles from $HOME ..."
  run_stow -D -t "$HOME" home
  echo "Done. Symlinks removed (your repo files are untouched)."

  if [ -d "$REPO_DIR/etc" ]; then
    echo "Unlinking system dotfiles from /etc (sudo required) ..."
    sudo stow -D -t /etc etc
    echo "Done. /etc symlinks removed."
  fi
else
  # -R (restow) = clean up stale links then relink. Idempotent: run it any time
  # you add, rename, or remove a file under home/.
  echo "Linking dotfiles into $HOME ..."
  run_stow -R -t "$HOME" home
  echo "Done. $HOME now points at $REPO_DIR/home."

  # Link system config files into /etc (requires sudo).
  if [ -d "$REPO_DIR/etc" ]; then
    echo "Linking system dotfiles into /etc (sudo required) ..."
    # Remove any pre-existing absolute symlinks pointing into the repo — stow
    # only recognises the relative symlinks it creates itself, and will refuse
    # to overwrite absolute ones even when they point at the same target.
    while IFS= read -r -d '' link; do
      target="$(readlink "$link")"
      case "$target" in
        "$REPO_DIR"/etc/*)
          sudo rm -f "$link"
          ;;
      esac
    done < <(sudo find /etc -maxdepth 5 -type l -print0 2>/dev/null)
    _etc_err="$(mktemp)"; _etc_rc=0
    sudo stow -R -t /etc etc 2>"$_etc_err" || _etc_rc=$?
    grep -v 'BUG in find_stowed_path' "$_etc_err" >&2 || true
    rm -f "$_etc_err"; [ "$_etc_rc" -eq 0 ]
    echo "Done. /etc symlinks point at $REPO_DIR/etc."
  fi

  if [ "$SKIP_CLAUDE" -eq 0 ]; then
    claude_setup
    claude_auth_report   # defined in Task 7
  else
    echo "Skipping Claude setup (--skip-claude)."
  fi
fi
