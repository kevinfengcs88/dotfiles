#!/usr/bin/env bash
# Idempotent dotfiles installer. Safe to run repeatedly, on macOS or Linux.
#   ./install.sh            # link everything in home/ into $HOME
#   ./install.sh --delete   # unlink (remove the symlinks)
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

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

if [ "${1:-}" = "--delete" ] || [ "${1:-}" = "-D" ]; then
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
fi
