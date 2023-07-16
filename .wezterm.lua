-- Pull in the wezterm API
local wezterm = require 'wezterm'
local act = wezterm.action

wezterm.on('user-var-changed', function(window, pane, name, value)
    local overrides = window:get_config_overrides() or {}
    if name == "ZEN_MODE" then
        local incremental = value:find("+")
        local number_value = tonumber(value)
        if incremental ~= nil then
            while (number_value > 0) do
                window:perform_action(wezterm.action.IncreaseFontSize, pane)
                number_value = number_value - 1
            end
            overrides.enable_tab_bar = false
        elseif number_value < 0 then
            window:perform_action(wezterm.action.ResetFontSize, pane)
            overrides.font_size = nil
            overrides.enable_tab_bar = true
        else
            overrides.font_size = number_value
            overrides.enable_tab_bar = false
        end
    end
    window:set_config_overrides(overrides)
end)

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
config.window_background_opacity = 0.9
-- config.window_background_image = 'C:/Users/Kevin/space.gif'
config.window_background_image_hsb = {
    -- Darken the background image by reducing it to 1/3rd
    brightness = 0.1,

    -- You can adjust the hue by scaling its value.
    -- a multiplier of 1.0 leaves the value unchanged.
    hue = 1.0,

    -- You can adjust the saturation also.
    saturation = 1.0,
}
config.window_padding = {
    left = 0,
    right = 0,
    top = 0,
    bottom = 0,
}

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

    { key = 'W', mods = 'CTRL', action = wezterm.action.CloseCurrentPane { confirm = true } },

    { key = 'T', mods = 'CTRL', action = act.SpawnTab 'DefaultDomain' },

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
