# My Neovim Config
This repository contains my Neovim config, which is written in Lua. It uses [lazy.nvim](https://github.com/folke/lazy.nvim) for managing plugins. Below, you can find various tips/commands that I learned while configuring Neovim and my workflow as a whole.

## Useful keymaps/tricks
- `r` while focused on nvim-tree renames the current file
- `a` while focused on nvim-tree adds a new file (or folder, just append a '/' character)
- Neovim allows for pasting from the system clipboard via `CTRL + SHIFT + V` both in insert mode and command mode (note that xsel is installed, which might influence this behavior)
- `;q` quits Neovim (by quitting all buffers) and `;w` saves all buffers
- `TAB` and `SHIFT + TAB` indent and outdent a line, regardless of where the cursor is
    - In visual mode, the same keymaps work (just remapped to their multi-line variants)
- Upon opening Neovim (and seeing the alpha dashboard), just hit `ENTER` rather than `f` for telescope's find file function since the cursor is already focused on the first option
- A simple search and replace of the whole file can be completed like this:
```
:%s/original/replaced/g
```
- Use visual mode and the `=` command to set all the tabs to be the same width as shiftwidth (if `:retab` doesn't work)
    - Note that commented lines may alter the behavior of this
- Use `da(` to delete everything inside parentheses and the parentheses themselves
- `<C-t>` toggles the transparency plugin
- To show current keymaps, use `:nmap`, `:vmap`, and `:imap` for normal, visual, and insert mode mappings, respectively
- To show currently installed parsers for treesitter, use `:TSInstallInfo`
- vim-surround enables very quick "surround" operations, like `ysiw` to surround a word with quotes or `ci"'` to replace double quotes with single quotes
- Switching colorscheme can fix cursor bugs
- <C-z> to background Neovim and `fg` in terminal to bring it back

## Installing dependencies + additional tools
- Install `berserk` for lichess:
```
pip install berserk
```
- Run this command if `python3` provider cannot be found for lichess plugin:
```
python3 -m pip install --user --upgrade pynvim
```
- If the animated alpha dashboard ASCII art is broken due to a zsh permission error, that means the permissions of the script, `animated_lolcat.sh` need to be updated with something like this:
```
sudo chmod +x animated_lolcat.sh
```
- Run this command for changing the font size rendering of GNOME terminal:
```
gsettings set org.gnome.desktop.interface text-scaling-factor 1
```
- Run this command to find the profile of the GNOME terminal:
```
dconf dump /org/gnome/terminal/legacy/profiles:/
```
- Run this command using that profile ID to change the transparency of the terminal to a specific value (more precise than using the slider in preferences):
```
dconf write /org/gnome/terminal/legacy/profiles:/<PROFILE-ID>/background-transparency-percent 50
```
- For resizing VMWare disk space, unmount the drive if `gparted` claims that the file system is read-only (seems safe?)

- To set nvim as the global git editor, run:
```
git config --global core.editor "nvim"
```
- If Neovim can't find xsel, try running this should really be included in `.zshrc`
```
export DISPLAY=:0
```
- To set up Svelte development, make sure that treesitter has svelte, javascript, and css installed, and then install the svelte-language-server through Mason

## List of dependencies/tools
Below is a list of dependencies/tools for my Neovim config and overall development environment
- [Gnome Shell Extension Prefs](https://www.omgubuntu.co.uk/2017/02/hidden-gnome-shell-extensions-prefs-app)
- [Variety](https://github.com/varietywalls/variety)
- `nvm` (install this with `curl`)
    - `node`
    - `npm`
- `gcc` (especially for Windows machines which installed Neovim without building from source code)
- `xsel` (in conjunction with 'unnamedplus' clipboard)
- `ripgrep`
- `deno`
- `python3`
- `figlet`
- `lolcat`
- `neofetch`
- `pip`
    - `berserk`

## TODO
- Comments still wrap when hitting <CR> in insert mode (Lua only?)
- Organize dotfiles (.zsh, .gitconfig, .wezterm, etc.) in preparation for new repo
- Change color of relative line numbers to white
- Python f-string fixes (change autopairs rule behavior):
    - Disable annoying {} wrapping around ''
    - Disable annoying f''' behavior (it should be f'')
- Get startup time to sub 100 ms across all environments
- Alpha dashboard options are not silent if selecting an option with <CR>
- Add Lazygit as a tool
- Add Ueberzug as a tool
- Add Ranger as a tool
- Changing the colorscheme overrides all Vim highlight commands, change this behavior for Themery
- Add sorting configuration to cmp
- Add keymap to jump to treesitter-context
- Add keymap to quit and discard changes
- Fix weird bug in Python (?) where you cannot tab comments over that are at the leftmost column
- Add keymap to access recent files (oldfiles) with Telescope outside of alpha

## Plugins to test
- https://github.com/napisani/nvim-github-codesearch
- https://github.com/stevearc/oil.nvim
- Sessions/persistence
    - https://github.com/folke/persistence.nvim
    - https://github.com/rmagatti/auto-session
- https://github.com/kevinhwang91/nvim-ufo
- https://github.com/kevinhwang91/rnvimr
- https://github.com/willothy/wezterm.nvim
- https://github.com/folke/trouble.nvim
- https://github.com/folke/todo-comments.nvim
- https://github.com/echasnovski/mini.nvim
- https://github.com/lmburns/lf.nvim
    - Which requires https://github.com/gokcehan/lf
- https://github.com/debugloop/telescope-undo.nvim
- https://github.com/Bekaboo/dropbar.nvim
- https://github.com/folke/neoconf.nvim
- https://github.com/nvim-pack/nvim-spectre
