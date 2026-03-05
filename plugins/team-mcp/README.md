# team-mcp

MCP server for [team-pipeline](https://github.com/abumonk/team-pipeline) -- validated state access, structured queries, and concurrency control for `.agent/` pipeline files.

## Installation

1. Clone or add this plugin to Claude Code
2. Install server dependencies:
   ```bash
   cd server && npm install
   ```
3. The MCP server starts automatically when Claude Code loads the plugin

## Requirements

- Node.js >= 18
- team-pipeline plugin installed and initialized (`/task-init`)

## How It Works

The plugin declares an MCP server in `.mcp.json`. Claude Code launches it as a local process (stdio transport) when the plugin loads. All `pipeline.*` tools become available alongside built-in tools.

The server reads and writes the same `.agent/` markdown files that team-pipeline uses. No separate database.

## Tools

| Tool | Description |
|------|-------------|
| `pipeline.task_create` | Create task with validated frontmatter |
| `pipeline.task_get` | Read task as structured JSON |
| `pipeline.task_list` | List/filter tasks by stage, status, assignee |
| `pipeline.task_update` | Update task fields with schema validation |
| `pipeline.task_advance` | Atomic stage transition with dependency checks |
| `pipeline.task_log` | Append timestamped log entry |
| `pipeline.task_archive` | Move completed task to archive |
| `pipeline.status` | Full pipeline overview |
| `pipeline.config_get` | Read config fields |
| `pipeline.config_set` | Update config with deep merge |
| `pipeline.metrics` | Query agent metrics |
| `pipeline.metrics_log` | Append agent performance entry |
| `pipeline.knowledge_get` | Read knowledge section |
| `pipeline.knowledge_add` | Add entry with deduplication |
| `pipeline.knowledge_search` | Search knowledge base |
| `pipeline.file_read` | Read file (working folder enforced) |
| `pipeline.file_write` | Write file (working folder enforced) |
| `pipeline.file_search` | Search files (working folder enforced) |

### Hook Management

| Tool | Description |
|------|-------------|
| `pipeline.hooks_get` | Read hook configuration, optionally filtered by event |
| `pipeline.hooks_set` | Update or merge hook rules |
| `pipeline.hooks_evaluate` | Test which hooks would fire for a synthetic event |

### Agent Memory

| Tool | Description |
|------|-------------|
| `pipeline.memory_list` | List memory files for a role |
| `pipeline.memory_get` | Read agent memory file (MEMORY.md or topic file) |
| `pipeline.memory_set` | Write agent memory file |
| `pipeline.memory_search` | Search across all or specific role memories |

### Diagnostics

| Tool | Description |
|------|-------------|
| `pipeline.health` | Pipeline health check: stale agents, stuck tasks, config issues, metrics anomalies |
| `pipeline.debug_task` | Full artifact dump for a specific task |
| `pipeline.estimation_report` | Compare estimated vs actual duration and token usage |

### Skill Discovery

| Tool | Description |
|------|-------------|
| `pipeline.skills_list` | List installed skills with metadata |
| `pipeline.skills_get` | Read a skill definition |
| `pipeline.rules_list` | List path-scoped rule files |
| `pipeline.rules_match` | Find rules that apply to given file paths |

## License

MIT
