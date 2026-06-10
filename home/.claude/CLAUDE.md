# Global Claude Code Instructions

## Search Tools

- **Code/symbol search:** prefer Serena (LSP-based, local) — `find_symbol`, `find_referencing_symbols`, `get_symbols_overview`. Built-in `Grep`/`Glob` are fine for plain text/file search.
- **Web search:** use the built-in `WebSearch` tool.
- **Library/framework docs:** use context7 (`resolve-library-id` → `query-docs`).
- mgrep has been removed (paid, credit-gated); do not reference it.

@RTK.md
