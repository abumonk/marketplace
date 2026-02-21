# Claudovka Marketplace

## Project Overview

This is a **plugin marketplace for Claude Code** — a Git-based repository that serves as a plugin registry. Users add this marketplace with `/plugin marketplace add abumonk/marketplace` and install plugins via `/plugin install <name>@claudovka-marketplace`.

## Repository Structure

```
marketplace/
  .claude-plugin/
    marketplace.json       # Marketplace manifest — lists all plugins
  plugins/
    team-pipeline/         # Multi-agent task pipeline plugin
      .claude-plugin/
        plugin.json
      agents/
      skills/
      hooks/
      roles/
    team-mcp/              # MCP server for pipeline state access
      .claude-plugin/
        plugin.json
      server/
  CLAUDE.md
  README.md
```

## Key Files

- **`.claude-plugin/marketplace.json`** — the marketplace manifest. Lists all plugins with name, source path, description, version, keywords, and category. This is what Claude Code reads when a user adds the marketplace.
- **`plugins/<name>/.claude-plugin/plugin.json`** — each plugin's own manifest with name, version, author, and component paths.

## Adding a New Plugin

1. Create `plugins/<plugin-name>/` with standard Claude Code plugin structure
2. Add `.claude-plugin/plugin.json` manifest inside it
3. Register it in `.claude-plugin/marketplace.json` under the `plugins` array
4. Update `README.md` plugin catalog table

## Marketplace Name

`claudovka-marketplace` — this is the identifier used in install commands (e.g., `plugin@claudovka-marketplace`).

## GitHub Remote

`abumonk/marketplace` — users add via `/plugin marketplace add abumonk/marketplace`

## Development Guidelines

- Each plugin lives in its own directory under `plugins/`
- Plugins must not have their own `.git` — this is a monorepo
- All plugins must have a valid `.claude-plugin/plugin.json`
- Use semantic versioning for both marketplace and plugin versions
- Keep marketplace.json in sync with the actual plugins directory
