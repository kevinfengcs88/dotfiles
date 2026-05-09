return {
    {
        'nvim-treesitter/nvim-treesitter',
        event = { 'BufReadPre', 'BufNewFile' },
        cmd = { 'TSInstallInfo', 'TSInstall' },
        config = function()
            local status_ok, treesitter = pcall(require, 'nvim-treesitter.configs')

            if not status_ok then
                return
            end

            treesitter.setup({
                modules = {},
                ensure_installed = { 'lua', 'vim', 'python', 'markdown_inline', 'go', 'html' },
                highlight = {
                    enable = true
                },
                sync_install = false,
                auto_install = false,
                ignore_install = {},
                context_commentstring = {
                    enable = true,
                    autocmd = false
                },
                autopairs = {
                    enable = true
                },
                autotag = {
                    enable = true
                },
                indent = {
                    enable = true,
                    disable = { 'go', 'python' }
                }
            })

            -- nvim 0.12 + render-markdown's range-based parsing can produce stale TSNodes
            -- where node.range is nil, crashing the injection directive. Override it with
            -- pcall protection.
            local lang_aliases = { ex = 'elixir', pl = 'perl', sh = 'bash', uxn = 'uxntal', ts = 'typescript' }
            vim.treesitter.query.add_directive('set-lang-from-info-string!', function(match, _, bufnr, pred, metadata)
                local node = match[pred[2]]
                if not node then return end
                local ok, text = pcall(vim.treesitter.get_node_text, node, bufnr)
                if not ok or not text then return end
                local lang = text:lower()
                metadata['injection.language'] = vim.filetype.match({ filename = 'a.' .. lang })
                    or lang_aliases[lang]
                    or lang
            end, { force = true, all = false })
        end

    }
}
