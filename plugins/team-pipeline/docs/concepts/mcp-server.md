# MCP Server

> A Model Context Protocol server that provides a structured API layer for pipeline operations, replacing direct file manipulation with validated, coordinated access.

## Problem

The team-pipeline plugin manages all state through direct file reads and writes to the `.agent/` directory. Every agent, hook, and skill parses YAML frontmatter, applies changes, and writes files back. This approach has several friction points:

1. **No validation layer.** Any agent can write malformed YAML, corrupt frontmatter fields, or create inconsistent state. The pipeline trusts every writer to get the format right.

2. **Concurrency hazards.** When `max_parallel > 1`, multiple agents can read and write the same files (controller-state.md, config.md, knowledge base) with no coordination. The lead agent's SubagentStop hook processes one completion at a time, but two completions firing in rapid succession could race on state file updates.

3. **Duplicated parsing logic.** Every agent and hook independently parses task files, config, controller state, and knowledge base. The same YAML frontmatter parsing and field extraction logic is replicated across the planner, implementer, reviewer, researcher, lead hooks, and every skill. Changes to the schema require updates everywhere.

4. **Working folders enforcement gap.** The PreToolUse hook checks file paths for Read/Write/Edit/Glob/Grep but cannot intercept Bash commands. The reviewer's `git diff` check is a detection mechanism, not prevention. An MCP server mediating all file access could close this gap.

5. **No cross-session coordination.** Each Claude Code session is isolated. If two sessions work on tasks in the same project, they share the `.agent/` directory but have no way to detect conflicts, coordinate locks, or sequence operations.

6. **Opaque observability.** Metrics are logged to a markdown file by the lead agent. There is no live query mechanism -- an external dashboard or monitoring tool cannot ask "what agents are running?" or "how many tokens has this task consumed?" without parsing markdown.

## Concept

An **MCP server** is a process that implements the Model Context Protocol and exposes **tools** (callable operations), **resources** (readable data), and **prompts** (reusable prompt templates) to Claude Code clients. Claude Code can connect to MCP servers defined in its configuration, and all tools/resources from those servers become available to the model alongside built-in tools.

For team-pipeline, the MCP server would be a local process (likely Node.js or Python) that manages the `.agent/` directory through a structured API. Instead of agents directly reading and writing task files, they would call MCP tools like `pipeline.task_get` or `pipeline.task_advance`, and the server would handle validation, locking, and persistence.

### What an MCP Server Provides

| Primitive | Description | Pipeline Use |
|-----------|-------------|--------------|
| **Tools** | Functions the model can call with parameters and receive results | Task CRUD, stage transitions, knowledge queries, agent lifecycle management |
| **Resources** | Data the model can read (like virtual files) | Pipeline status, task details, config values, metrics snapshots |
| **Prompts** | Reusable prompt templates with arguments | Agent system prompts, review report templates, knowledge extraction templates |

### Architecture

```
Claude Code Session(s)
    |
    | MCP protocol (stdio or SSE)
    |
    v
+-------------------+
| MCP Server        |
| (Node.js/Python)  |
|                   |
| - Validation      |
| - Locking         |
| - Event emission  |
| - Metrics         |
+--------+----------+
         |
         | File I/O (single writer)
         |
         v
    .agent/
      tasks/
      config.md
      lead-state.md
      knowledge/
      metrics.md
      ...
```

The server is the **single writer** to `.agent/` files. Agents no longer use Write/Edit tools on `.agent/` files directly -- they call MCP tools instead. The server serializes all writes, validates all inputs against the schema, and emits events for observability.

## Relationship to Current System

The MCP server is an **alternative access layer**, not a replacement for the plugin architecture. The existing agents, skills, hooks, and commands continue to exist. The change is in how they interact with pipeline state:

| Operation | Current Approach | MCP Approach |
|-----------|------------------|--------------|
| Read task file | Agent uses Read tool on `.agent/tasks/TASK-001.md`, parses YAML | Agent calls `pipeline.task_get(id: "TASK-001")`, receives structured JSON |
| Update task status | Agent uses Edit tool to modify frontmatter field | Agent calls `pipeline.task_update(id: "TASK-001", status: "ready")` |
| Advance stage | Lead hook reads task, applies transition rules, writes files | Agent calls `pipeline.task_advance(id: "TASK-001")`, server applies rules |
| Query knowledge base | Agent uses Read tool, searches with Grep | Agent calls `pipeline.knowledge_search(query: "error handling patterns")` |
| Check working folders | PreToolUse hook intercepts and checks paths | Server validates paths in every tool that accepts file paths |
| Get pipeline status | Skill reads all task files, formats table | Agent calls `pipeline.status()`, receives structured status |
| Log metrics | Lead hook writes to metrics.md | Server auto-records metrics for every tool call |

### What Stays the Same

- Agent markdown files (`agents/*.md`, `roles/templates/*.md`) remain the canonical agent definitions
- Skills (SKILL.md) remain as user-facing commands
- Commands (learn, task) remain as entry points
- The `.agent/` directory structure is unchanged -- the server reads/writes the same files
- Plugin auto-discovery and installation mechanisms are unaffected

### What Changes

- Agents call MCP tools instead of using Read/Write/Edit on `.agent/` files
- The lead's SubagentStop hook could delegate state management to the server
- Working folders enforcement moves from a PreToolUse hook to the server layer
- Metrics collection becomes automatic rather than requiring lead agent logic
- Cross-session coordination becomes possible through the server as a shared process

## Key Abstractions

### Tool Inventory (Proposed)

**Task Management:**

| Tool | Parameters | Returns | Description |
|------|-----------|---------|-------------|
| `pipeline.task_create` | title, description, tags, depends_on, packages | task object | Creates task file with validated frontmatter |
| `pipeline.task_get` | id | task object | Reads and parses task file |
| `pipeline.task_list` | filter (stage, status, assignee) | task[] | Lists tasks matching criteria |
| `pipeline.task_update` | id, fields to update | task object | Updates task frontmatter with validation |
| `pipeline.task_advance` | id | task object | Applies transition rules, validates dependencies |
| `pipeline.task_log` | id, message | void | Appends timestamped entry to task log |
| `pipeline.task_archive` | id | void | Moves task to archive |

**Knowledge Base:**

| Tool | Parameters | Returns | Description |
|------|-----------|---------|-------------|
| `pipeline.knowledge_get` | section (patterns/issues/decisions) | content | Reads a knowledge section |
| `pipeline.knowledge_add` | section, entry (name, description, source) | void | Adds entry with deduplication check |
| `pipeline.knowledge_search` | query, section? | matches[] | Searches knowledge base |

**Agent Lifecycle:**

| Tool | Parameters | Returns | Description |
|------|-----------|---------|-------------|
| `pipeline.agent_status` | | active_agents[] | Lists currently running agents |
| `pipeline.agent_spawn` | role, task_id | agent_info | Resolves role file, spawns agent |
| `pipeline.agent_stop` | task_id | void | Requests agent stop |

**Pipeline State:**

| Tool | Parameters | Returns | Description |
|------|-----------|---------|-------------|
| `pipeline.status` | | full pipeline status | Tasks by stage, active agents, queue |
| `pipeline.config_get` | key? | config value(s) | Reads config.md fields |
| `pipeline.config_set` | key, value | void | Updates config.md field with validation |
| `pipeline.metrics` | task_id?, date_range? | metrics data | Queries metrics |

**File Operations (Boundary-Enforced):**

| Tool | Parameters | Returns | Description |
|------|-----------|---------|-------------|
| `pipeline.file_read` | path, task_id | content | Reads file if within task's working folders |
| `pipeline.file_write` | path, content, task_id | void | Writes file if within task's working folders |
| `pipeline.file_search` | pattern, path?, task_id | matches | Searches within working folder boundaries |

### Resource Inventory (Proposed)

| Resource URI | Description |
|-------------|-------------|
| `pipeline://status` | Current pipeline status (tasks, agents, queue) |
| `pipeline://task/{id}` | Full task object including log |
| `pipeline://config` | Current configuration |
| `pipeline://knowledge/{section}` | Knowledge base section content |
| `pipeline://metrics` | Aggregated metrics |
| `pipeline://metrics/{task-id}` | Per-task metrics |

### Prompt Inventory (Proposed)

| Prompt Name | Arguments | Description |
|-------------|-----------|-------------|
| `pipeline.agent_prompt` | role, task_id | Generates the full agent prompt for a role + task combination |
| `pipeline.review_template` | task_id | Generates the review report template pre-filled with task info |

## Interaction Patterns

### Agent Calling MCP Tools

When an agent is spawned, instead of reading files directly:

```
Planner agent starts for TASK-003
  |
  1. pipeline.task_get(id: "TASK-003")
     -> returns full task object with description, criteria, dependencies
  |
  2. pipeline.config_get(key: "working_folders")
     -> returns working folder config
  |
  3. pipeline.knowledge_get(section: "patterns")
     -> returns patterns content
  |
  4. [Agent does its analysis work using Read/Glob/Grep on project files]
  |
  5. pipeline.file_write(path: ".agent/designs/TASK-003-design.md", content: "...", task_id: "TASK-003")
     -> server validates path is in .agent/ (always allowed), writes file
  |
  6. pipeline.task_update(id: "TASK-003", status: "ready", files: [...])
     -> server validates fields, updates task file, emits event
```

### Lead Hook Using MCP Tools

```
SubagentStop fires
  |
  1. pipeline.agent_status()
     -> shows which agents were active
  |
  2. pipeline.task_get(id: extracted_task_id)
     -> gets current task state
  |
  3. pipeline.task_advance(id: extracted_task_id)
     -> server applies transition rules, validates deps, updates state
     -> returns: { advanced_to: "reviewing", next_role: "reviewer" }
  |
  4. pipeline.agent_spawn(role: "reviewer", task_id: extracted_task_id)
     -> server resolves role file, creates agent
```

### Multi-Session Coordination

```
Session A                            MCP Server                          Session B
    |                                    |                                    |
    | pipeline.task_advance(TASK-001)    |                                    |
    |----------------------------------->|                                    |
    |                                    | [acquires lock on TASK-001]        |
    |                                    |                                    |
    |                                    |    pipeline.task_update(TASK-001)  |
    |                                    |<-----------------------------------|
    |                                    | [BLOCKED: TASK-001 locked]         |
    |                                    |--> returns error: "task locked     |
    |                                    |    by another session"             |
    |                                    |                                    |
    | [advance complete]                 |                                    |
    |<-----------------------------------|                                    |
    |                                    | [releases lock on TASK-001]        |
    |                                    |                                    |
    |                                    |    [retry succeeds]                |
    |                                    |<-----------------------------------|
```

The server maintains in-memory locks per task. When a session holds a lock (during multi-step operations like advance), other sessions receive a clear error rather than silently corrupting state.

### Working Folders Enforcement via MCP

Instead of a PreToolUse hook that checks file paths, agents use `pipeline.file_read` and `pipeline.file_write` for files within the project. The server resolves the task's working folders from config.md and the task's `packages` field, validates the path, and either proceeds or returns an error.

This closes the Bash gap: if agents are configured to use `pipeline.file_*` tools instead of raw Read/Write/Edit for project files, all file access is mediated. The Bash tool can still bypass this (agents need it for build/test commands), but the surface area of unmediated access shrinks significantly.

## Benefits vs. Complexity Trade-offs

### Benefits

| Benefit | Impact | Currently Possible? |
|---------|--------|---------------------|
| **Validated writes** | Eliminates malformed YAML, invalid state transitions, schema violations | No -- agents write raw text |
| **Atomic operations** | Task advance is a single atomic tool call, not a read-modify-write cycle | No -- multi-step file edits |
| **Concurrency safety** | Locks prevent race conditions with max_parallel > 1 | Partial -- lead hook serializes but gaps exist |
| **Cross-session coordination** | Multiple Claude sessions can share a pipeline safely | No -- completely unsupported |
| **Centralized enforcement** | Working folders checked in one place, consistently | Partial -- PreToolUse hook, but Bash bypasses |
| **Automatic metrics** | Every MCP tool call logged with timing, token context | No -- requires lead agent to manually log |
| **Structured queries** | `task_list(stage: "reviewing")` instead of glob + parse | No -- every query requires file I/O and parsing |
| **Event emission** | Server emits events for external integrations (dashboards, webhooks) | No -- only messenger hook sends notifications |
| **Schema enforcement** | Server rejects writes that violate the schema | No -- schema is documentation, not runtime validation |

### Complexity Costs

| Cost | Severity | Mitigation |
|------|----------|------------|
| **External process** | High | Server must be started before Claude Code session. Adds installation step, startup dependency, and failure mode (server crash). |
| **Language choice** | Medium | Must choose Node.js or Python. Either works, but adds a runtime dependency the plugin currently avoids (pure markdown). |
| **MCP protocol overhead** | Low | Protocol is simple (JSON-RPC over stdio or SSE). Negligible performance impact. |
| **Dual access paths** | High | During migration, some operations go through MCP, others through direct files. Must avoid split-brain. |
| **Plugin complexity** | Medium | Plugin goes from "just markdown files" to "markdown files + a server process". Documentation, debugging, and onboarding all become harder. |
| **Platform portability** | Medium | Server process management differs across OS (Windows services vs Unix daemons). Current plugin is OS-agnostic. |
| **Testing** | Medium | Server needs its own test suite. Currently the plugin has no executable code to test. |
| **Lock management** | Medium | In-memory locks are lost on server restart. Need graceful recovery (stale lock detection, timeout). |

### Net Assessment

The MCP server provides substantial benefits for **concurrent, multi-session, high-throughput** pipeline usage. For the **current single-session, manual-advance** usage pattern, most benefits are marginal -- validation and structured queries are nice but not critical when one human is overseeing the pipeline.

The strongest argument for an MCP server is **multi-session coordination** and **cross-tool observability**, neither of which can be achieved with the current file-based approach.

The strongest argument against is **complexity** -- the plugin currently requires zero dependencies, zero processes, and zero configuration beyond markdown files. An MCP server fundamentally changes this.

## Open Questions

1. **Incremental adoption.** Can the MCP server be optional -- a "turbo mode" that enhances the pipeline without being required? Agents would fall back to direct file I/O when the server is not running. This avoids forcing all users to run a server process but creates a dual-path maintenance burden.

 : We solve it moving mcp server to separate `team-mcp` plugin.

2. **Server lifecycle management.** Who starts and stops the server? Options: (a) Claude Code plugin hook on SessionStart/Stop, (b) user starts manually, (c) always-running system service. Each has trade-offs for reliability and user experience. 

 : Claude Code plugin hook on SessionStart/Stop

3. **Agent tool configuration.** If agents use MCP tools for pipeline operations, they need those tools in their `tools` list. This means agent definitions depend on the MCP server being available. How to handle graceful degradation when the server is absent?

 : this tool should be part of mcp server plugin `team-mcp` 

4. **Scope of mediation.** Should the MCP server mediate all `.agent/` file access, or only high-value operations (task state, config, knowledge)? Full mediation is cleaner but more disruptive. Partial mediation preserves simplicity for low-risk operations (design docs, reports).

: Partial mediation preserves simplicity for low-risk operations (design docs, reports)

5. **State storage.** Should the server maintain its own database (SQLite, JSON) alongside or instead of the markdown files? A database would be faster and support richer queries, but the human-readable, git-trackable markdown files are a core design value of the current system.

: nope

6. **Event protocol.** What event format should the server emit? Server-Sent Events for real-time dashboards? Webhook calls for messenger integration? Both? How does this relate to the existing lead agent's notification responsibilities?

: both. duplicates

7. **Authentication.** If the server manages locks and coordinates sessions, does it need authentication? For a local single-user setup, probably not. For a shared team server, it would.

: yes

8. **Impact on the lead agent.** The lead agent currently handles orchestration, metrics, and notifications through hooks. An MCP server would subsume much of this responsibility. Does the lead agent become simpler (focuses only on judgment and proposals) or redundant?

: lead agent become simpler

9. **Build system.** The plugin currently has no build step. An MCP server requires a build step (compile TypeScript, bundle dependencies). This changes the development and distribution workflow. How does this interact with the marketplace sync process?

: separate plugin `team-mcp` solves this

10. **MCP tool naming.** Claude Code may expose MCP tools from multiple servers. Tool names must be globally unique or namespaced. The `pipeline.*` prefix seems reasonable but needs validation against Claude Code's MCP integration behavior.

yea, good

## Future Possibilities

- **Real-time dashboard.** The MCP server could serve a web UI showing pipeline status, agent activity, and metrics in real time. No more parsing markdown tables.
: yes
- **Persistent task database.** Migrate from markdown files to SQLite while keeping markdown as a human-readable export format. Enables rich queries, full-text search, and relationship tracking.
: yes
- **Plugin API.** Other plugins could connect to the pipeline server to extend its capabilities -- custom validators, additional tools, integration adapters.
: yes
- **Remote server.** Instead of a local process, the MCP server could run on a remote machine, enabling distributed team usage. Multiple developers' Claude sessions connect to the same pipeline server.
: mb later
- **Audit log.** Every operation recorded with session ID, timestamp, and before/after state. Full traceability for debugging and compliance.
: yes
- **Workflow engine.** The MCP server could implement a proper workflow engine with conditional branching, parallel stages, and custom pipeline topologies beyond the current linear flow.
: yes
- **Integration hub.** Direct integrations with GitHub (create issues, PRs), Jira, Linear, Notion -- the server as a central hub connecting the pipeline to external project management tools.
: mb later
- **Agent sandboxing.** The server could enforce stricter sandboxing than file-path checks -- rate limiting tool calls, enforcing token budgets, restricting network access through controlled proxy tools.
: mb later