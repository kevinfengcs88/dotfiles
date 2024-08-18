-- Pull in the wezterm API
local wezterm = require 'wezterm'
local act = wezterm.action

-- This will hold the configuration.
local config = wezterm.config_builder()

-- This is where you actually apply your config choices

config.disable_default_key_bindings = true
config.window_background_opacity = 1.0
config.window_background_image_hsb = {
    -- Darken the background image by reducing it to 1/3rd
    brightness = 0.1,

    -- You can adjust the hue by scaling its value.
    -- a multiplier of 1.0 leaves the value unchanged.
    hue = 1.0,

    -- You can adjust the saturation also.
    saturation = 1.0,
}

config.color_scheme = 'Tokyo Night'
config.font = wezterm.font('JetBrains Mono', { weight = 'Bold' })
config.hide_mouse_cursor_when_typing = false
config.hide_tab_bar_if_only_one_tab = true
config.warn_about_missing_glyphs = false

config.window_padding = {
    left = 0,
    right = 0,
    top = 0,
    bottom = 0,
}

-- set up leader key
-- default timeout is 1000 ms
config.leader = { key = 'b', mods = 'CTRL', timeout_milliseconds = 1000 }

config.keys = {
    -- split horizontal
    { key = '%', mods = 'LEADER|SHIFT', action = wezterm.action.SplitHorizontal { domain = 'CurrentPaneDomain' }, },

    -- split vertical
    { key = '-', mods = 'LEADER', action = wezterm.action.SplitVertical { domain = 'CurrentPaneDomain' }, },

    -- focus up, down, left right
    { key = 'k', mods = 'LEADER', action = wezterm.action.ActivatePaneDirection 'Up' },
    { key = 'j', mods = 'LEADER', action = wezterm.action.ActivatePaneDirection 'Down' },
    { key = 'h', mods = 'LEADER', action = wezterm.action.ActivatePaneDirection 'Left' },
    { key = 'l', mods = 'LEADER', action = wezterm.action.ActivatePaneDirection 'Right' },

    -- paste from the clipboard
    { key = 'V', mods = 'CTRL', action = act.PasteFrom 'Clipboard' },

    -- paste from the primary selection
    -- { key = 'V', mods = 'CTRL', action = act.PasteFrom 'PrimarySelection' },

    { key = '=', mods = 'CTRL', action = act.IncreaseFontSize },
    { key = '-', mods = 'CTRL', action = act.DecreaseFontSize },
    { key = 'W', mods = 'CTRL', action = wezterm.action.CloseCurrentPane { confirm = true } },
    { key = 'T', mods = 'CTRL', action = act.SpawnTab 'DefaultDomain' },

    -- switch tabs
    { key = ',', mods = 'ALT', action = act.ActivateTabRelative(-1) },
    { key = '.', mods = 'ALT', action = act.ActivateTabRelative(1) },

    -- switch tabs tmux style
    { key = 'p', mods = 'LEADER', action = act.ActivateTabRelative(-1) },
    { key = 'n', mods = 'LEADER', action = act.ActivateTabRelative(1) },
}

for i = 1, 8 do
    -- CTRL+ALT + number to activate that tab
    table.insert(config.keys, {
    key = tostring(i),
    mods = 'LEADER',
    action = act.ActivateTab(i - 1),
    })
end

-- and finally, return the configuration to wezterm
return config
