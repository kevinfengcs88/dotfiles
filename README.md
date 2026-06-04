# Dotfiles

Personal shell, tmux, terminal, editor, and WM configuration. Managed with
[GNU stow](https://www.gnu.org/software/stow/). Works on both Pop!_OS and macOS
from the same `home/` package — OS differences are handled at runtime (e.g. the
`$OSTYPE` branches in `.zshrc`), and tools that only exist on one OS (yabai/skhd
on macOS; polybar/MangoHud/kde on Linux) are simply inert on the other.

## Setup on a new machine

```sh
# macOS:  brew install stow git
# Pop!_OS: sudo apt install stow git
git clone <this-repo> ~/dotfiles
cd ~/dotfiles
./install.sh
```

That's it — `./install.sh` symlinks everything under `home/` into `$HOME`.
Same command on both operating systems. Run it again any time to re-sync;
`./install.sh --delete` removes the symlinks.

## How this is laid out

- `home/` — the **stow package**. Its tree mirrors `$HOME` exactly. Stowing it
  creates `~/.zshrc -> ~/dotfiles/home/.zshrc`, `~/.config/nvim -> .../home/.config/nvim`, etc.
- `home/.stow-local-ignore` — paths stow must **not** symlink:
  - `.claude/playtime` runs in place from the repo (referenced by absolute path
    in `home/.claude/settings.json`); it writes ephemeral state to `~/.claude/playtime`.
  - `settings.local.json` is per-machine and never shared.
- `tmux-startup.sh` lives at the repo root (called as `~/dotfiles/tmux-startup.sh`),
  not in `home/`, so it is intentionally not symlinked.

## Adding or changing a dotfile (the stow workflow)

- **Edit an existing dotfile:** just edit it — `~/.zshrc` is a symlink straight
  into `home/`, so changes land in the repo automatically. `git commit` when ready.
- **Add a NEW dotfile:** put it under `home/` at the path it should have relative
  to `$HOME`, then re-link:
  ```sh
  mv ~/.config/foo/bar.conf ~/dotfiles/home/.config/foo/bar.conf   # move real file in
  cd ~/dotfiles && ./install.sh                                     # stow -R picks it up
  ```
- **Stop managing a file:** remove its symlink with `stow -D`, then move the real
  file back out of `home/` (or delete it):
  ```sh
  cd ~/dotfiles && stow -D -t ~ home   # unlink all
  git rm -r home/path/to/thing && ./install.sh
  ```
- After any add/rename/remove under `home/`, run `./install.sh` (it's `stow -R`,
  which clears stale links and relinks). Editing existing files needs no re-stow.

### Gotchas worth remembering

- **Tree folding:** if a target dir like `~/.config/foo` doesn't exist yet, stow
  links the *whole directory* as one symlink. Once another (unmanaged) file lives
  in that real dir, stow instead links your file individually. Both are fine here;
  just don't be surprised when `~/.config/nvim` is one symlink but
  `~/.config/autostart/tmux-startup.desktop` is a per-file link.
- **Conflicts:** if a real (non-symlink) file already occupies a target, stow
  aborts with a CONFLICT rather than clobbering it. Move/back up that file, then
  re-run. Use `stow -n -v home` to dry-run and see the plan without touching disk.

## macos stuff

- use karabiner to rebind caps lock to hyper

## Terminal Input Notes

Current known-good behavior:

- `Shift+Space` behaves like a normal space.
- `Shift+Enter` works for multiline input in Codex.
- The above works both inside and outside tmux.

Relevant config:

- [`home/.wezterm.lua`](home/.wezterm.lua)
  - `config.enable_kitty_keyboard = true`
  - `config.keys` contains:
    - `{ key = 'Space', mods = 'SHIFT', action = act.SendString ' ' }`
- [`home/.tmux.conf`](home/.tmux.conf)
  - tmux prefix is `C-Space`
  - no extra extended-key settings are currently enabled

## Important History

There was a bug where `Shift+Space` cleared the zsh prompt, but only inside tmux. The stable fix was the explicit WezTerm key mapping that forces `Shift+Space` to send a literal space.

Several follow-up attempts were made to force `Shift+Enter` behavior inside tmux by changing tmux extended-key settings or adding special `Shift+Enter` remaps. Those changes caused edge-case behavior and were reverted.

If a future agent investigates keyboard input again:

- treat the current `Shift+Space` WezTerm mapping as intentional
- be cautious about changing tmux extended-key settings
- be cautious about special `Shift+Enter` remaps in WezTerm
- verify behavior both inside and outside tmux before declaring success
