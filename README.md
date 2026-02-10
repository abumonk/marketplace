# Claudovka Marketplace

A plugin marketplace for Claude Code with curated plugins for development workflows.

## Installation

Add the marketplace to Claude Code:

```
/plugin marketplace add abumonk/marketplace
```

Then install any plugin:

```
/plugin install team-pipeline@claudovka-marketplace
```

## Available Plugins

| Plugin | Description | Version |
|--------|-------------|---------|
| [team-pipeline](plugins/team-pipeline/) | Stage-based task processing pipeline with planner, implementer, reviewer, and researcher agents | 0.1.0 |

## Adding a Plugin

1. Create your plugin in `plugins/<plugin-name>/` following the [Claude Code plugin structure](https://docs.anthropic.com/en/docs/claude-code)
2. Add a `.claude-plugin/plugin.json` manifest to your plugin
3. Register it in `.claude-plugin/marketplace.json`
4. Submit a pull request

## License

MIT
