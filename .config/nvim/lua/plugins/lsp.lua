return {
    {
        'williamboman/mason.nvim',
        cmd = 'Mason',
        build = ':MasonUpdate',
        config = true,
    },
    {
        'williamboman/mason-lspconfig.nvim',
        event = { 'BufReadPre', 'BufNewFile' },
        dependencies = {
            'williamboman/mason.nvim',
            'neovim/nvim-lspconfig',
        },
        config = function()
            vim.lsp.config('lua_ls', {
                settings = {
                    Lua = {
                        runtime = { version = 'LuaJIT' },
                        workspace = {
                            checkThirdParty = false,
                            library = { vim.env.VIMRUNTIME },
                        },
                    }
                }
            })

            require('mason-lspconfig').setup({
                ensure_installed = { 'pyright', 'lua_ls', 'gopls', 'clangd', 'bashls' },
                automatic_enable = true,
            })

            local orig_rename = vim.lsp.handlers['textDocument/rename']
            vim.lsp.handlers['textDocument/rename'] = function(err, result, ctx, config)
                if result and result.documentChanges then
                    for _, change in ipairs(result.documentChanges) do
                        if change.edits then
                            for _, edit in ipairs(change.edits) do
                                edit.annotationId = nil
                            end
                        end
                    end
                end
                orig_rename(err, result, ctx, config)
            end

            vim.api.nvim_create_autocmd('LspAttach', {
                callback = function(args)
                    local bufnr = args.buf
                    local client = vim.lsp.get_client_by_id(args.data.client_id)
                    local map = function(keys, func) vim.keymap.set('n', keys, func, { buffer = bufnr }) end

                    map('gd', vim.lsp.buf.definition)
                    vim.keymap.del('n', 'K', { buffer = bufnr })

                    local navic_ok, navic = pcall(require, 'nvim-navic')
                    if navic_ok and client and client.server_capabilities.documentSymbolProvider then
                        navic.attach(client, bufnr)
                    end
                end
            })
        end
    },
    {
        'hrsh7th/nvim-cmp',
        event = 'InsertEnter',
        dependencies = {
            'hrsh7th/cmp-nvim-lsp',
            'L3MON4D3/LuaSnip',
            'saadparwaiz1/cmp_luasnip',
            'rafamadriz/friendly-snippets',
            'SmiteshP/nvim-navic',
        },
        config = function()
            local cmp = require('cmp')
            require('luasnip.loaders.from_vscode').lazy_load()

            cmp.setup({
                preselect = cmp.PreselectMode.None,
                sources = {
                    { name = 'nvim_lsp' },
                    { name = 'luasnip' },
                },
                mapping = {
                    ['<CR>'] = cmp.mapping.confirm({ select = false }),
                },
                window = {
                    completion = cmp.config.window.bordered(),
                    documentation = cmp.config.window.bordered(),
                },
                snippet = {
                    expand = function(args)
                        require('luasnip').lsp_expand(args.body)
                    end
                }
            })
        end
    },
}
