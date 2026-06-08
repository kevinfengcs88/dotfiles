# Global Claude Code Instructions

## Search Tools — Use mgrep

**MANDATORY:** The `mgrep:mgrep` skill is installed and MUST be used for all search operations.

- **File/code search:** invoke `mgrep:mgrep` skill, then `mgrep "semantic description of what you need" [optional/path]`
- **Web search:** invoke `mgrep:mgrep` skill, then `mgrep --web --answer "query"`
- **Never** use the built-in `Grep` tool
- **Never** run `grep` directly via Bash as a primary search command
- **Never** use built-in `WebSearch` tool — use `mgrep --web --answer` instead
- mgrep is semantic, so describe what you're looking for in plain language, not regex patterns
