# team-mcp

MCP server plugin for team-pipeline. Provides validated, structured access to `.agent/` pipeline state files.

## What This Plugin Does

This plugin runs a local MCP server (stdio transport) that mediates access to the `.agent/` directory used by the team-pipeline plugin. Instead of agents reading/writing markdown files directly, they call MCP tools that validate inputs, enforce schemas, manage locks, and provide structured JSON responses.

## Architecture

```
Claude Code -> MCP protocol (stdio) -> team-mcp server -> .agent/ files
```

The server is the single writer for high-value state files (tasks, config, lead-state, metrics, knowledge). Low-risk files (designs, reports) remain accessible via direct file I/O.

## MCP Tools

All tools are namespaced under `pipeline.*`:

### Task Management
- `pipeline.task_create` -- create task with validated frontmatter
- `pipeline.task_get` -- read task as structured JSON
- `pipeline.task_list` -- list/filter tasks
- `pipeline.task_update` -- update task fields with validation
- `pipeline.task_advance` -- atomic stage transition
- `pipeline.task_log` -- append log entry
- `pipeline.task_archive` -- move to archive

### Pipeline State
- `pipeline.status` -- full pipeline overview
- `pipeline.config_get` -- read config fields
- `pipeline.config_set` -- update config with deep merge
- `pipeline.metrics` -- query metrics
- `pipeline.metrics_log` -- append agent performance entry

### Knowledge Base
- `pipeline.knowledge_get` -- read knowledge section
- `pipeline.knowledge_add` -- add entry with deduplication
- `pipeline.knowledge_search` -- search across sections

### File Operations (Boundary-Enforced)
- `pipeline.file_read` -- read file within working folders
- `pipeline.file_write` -- write file within working folders
- `pipeline.file_search` -- search within working folders

## Relationship to team-pipeline

This plugin is optional. team-pipeline works without it using direct file I/O. When team-mcp is installed:

- Lead agent prefers MCP tools for state operations
- Working folder enforcement is centralized in the server
- Metrics are auto-collected
- Multi-session coordination is enabled via locks

## Development

```bash
cd server
npm install
node index.js    # starts MCP server on stdio
```

## Workspace Settings

- **Language**: English
- **Code Style**: Clean, minimal, well-documented
- **Response Style**: Concise, technical
- **Runtime**: Node.js >= 18
- **Module System**: ESM (type: module)
