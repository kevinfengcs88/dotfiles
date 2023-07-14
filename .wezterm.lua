-- Pull in the wezterm API
local wezterm = require 'wezterm'
local act = wezterm.action

-- This table will hold the configuration.
local config = {}

-- In newer versions of wezterm, use the config_builder which will
-- help provide clearer error messages
if wezterm.config_builder then
    config = wezterm.config_builder()
end

-- This is where you actually apply your config choices

-- For example, changing the color scheme:
config.color_scheme = 'MaterialDarker'
config.font = wezterm.font 'Hack Nerd Font'
config.disable_default_key_bindings = true

config.unix_domains = {
    {
        name = 'wsl',
        serve_command = { 'wsl', 'wezterm-mux-server', '--daemonize' },
    },
}

config.default_domain = 'WSL:Ubuntu'

config.keys = {
    -- paste from the clipboard
    { key = 'V', mods = 'CTRL', action = act.PasteFrom 'Clipboard' },

    -- paste from the primary selection
    -- { key = 'V', mods = 'CTRL', action = act.PasteFrom 'PrimarySelection' },

    { key = '=', mods = 'CTRL', action = act.IncreaseFontSize },

    { key = '-', mods = 'CTRL', action = act.DecreaseFontSize },

    { key = 'w', mods = 'CTRL', action = wezterm.action.CloseCurrentPane { confirm = true } },

    { key = 't', mods = 'CTRL', action = act.SpawnTab 'DefaultDomain' },

    { key = ',', mods = 'ALT', action = act.ActivateTabRelative(-1) },

    { key = '.', mods = 'ALT', action = act.ActivateTabRelative(1) },
}

for i = 1, 8 do
    -- F1 through F8 to activate that tab
    table.insert(config.keys, {
        key = 'F' .. tostring(i),
        action = act.ActivateTab(i - 1),
    })
end

-- and finally, return the configuration to wezterm
return config
