# team-pipeline

Stage-based task processing pipeline for Claude Code. Four specialized agents (planner, implementer, reviewer, researcher) collaborate through a structured pipeline with built-in quality gates and knowledge extraction.

## Installation

Clone this repo and add it to your Claude Code plugins, or reference it from a marketplace.

```bash
git clone https://github.com/abumonk/team-pipeline.git
```

Claude Code auto-discovers the plugin when the directory contains `.claude-plugin/plugin.json`.

## Quick Start

1. Open your project in Claude Code with the plugin installed.
2. Initialize the pipeline:
   ```
   /task-init
   ```
3. Create your first task:
   ```
   /task create
   ```
4. Check status:
   ```
   /task status
   ```
5. Advance through stages:
   ```
   /task advance TASK-001
   ```

## Pipeline Stages

```
planning --> implementing --> reviewing --> fixing --> completed --> researching
                                |            |
                                |            +--> reviewing (loop, max 3)
                                |
                                +--> BLOCKED (after 3 failed iterations)
```

| Stage | Agent | Model | Purpose |
|-------|-------|-------|---------|
| planning | planner | opus | Design, scope, target files |
| implementing | implementer | sonnet | Write code, run tests |
| reviewing | reviewer | opus | Test, validate, report |
| fixing | implementer | sonnet | Address review feedback |
| researching | researcher | opus | Extract patterns to knowledge base |

## Commands

| Command | Description |
|---------|-------------|
| `/task` or `/task create` | Create a new task and spawn planner |
| `/task status` | Show pipeline overview |
| `/task advance TASK-XXX` | Move task to next stage |
| `/task complete TASK-XXX` | Force-complete (skip stages) |
| `/task cancel TASK-XXX` | Cancel task |
| `/task migrate` | Import TODOs, GitHub issues, or markdown tasks |

## Skills

| Skill | Description |
|-------|-------------|
| `reinit` | Initialize or upgrade `.agent/` directory (schema-driven) |
| `task-init` | Initialize `.agent/` directory (convenience wrapper for reinit) |
| `task-create` | Create task with planner agent |
| `task-status` | Display pipeline status table |
| `task-migrate` | Import tasks from external sources |

## Project Structure

When initialized (`/task-init`), the plugin creates:

```
your-project/
  .agent/
    tasks/                  # Active task files (TASK-001.md, etc.)
    tasks/archive/          # Completed tasks
    designs/                # Design documents from planner
    reports/                # Review reports
    knowledge/              # Project knowledge base
      patterns.md           # Recurring patterns
      issues.md             # Common issues and solutions
      decisions.md          # Architecture decisions
    config.md               # Build/test commands, settings
```

## Task File Format

Tasks are markdown files with YAML frontmatter:

```yaml
---
id: TASK-001
title: Add user authentication
stage: planning
status: in_progress
iterations: 0
assignee: planner
files: []
tags: [backend, auth]
---

## Description
What needs to be done.

## Acceptance Criteria
- [ ] Criterion 1
- [ ] Criterion 2

## Design
Filled by planner agent.

## Log
- [timestamp] created: Task created
```

## Configuration

Edit `.agent/config.md` to match your project:

```yaml
---
build_command: npm run build
test_command: npm test
max_iterations: 3
git:
  mode: "current-branch"
  branch_template: "task/{id}-{slug}"
  base_branch: "main"
  auto_detect_repos: true
  commit_style: "conventional"
  commit_template: "{type}({id}): {message}"
  pr_template: "default"
---
```

## Git Operations

The pipeline integrates git lifecycle management. All git actions are proposed by the lead agent and require user approval.

### Modes

| Mode | Description |
|------|-------------|
| `current-branch` (default) | Commits on the current branch at stage transitions. No branch creation, no PRs. |
| `branch-per-task` | Creates an isolated branch per task at implementation start. Push + PR on completion. |

### What Happens at Each Stage

| Transition | current-branch | branch-per-task |
|------------|---------------|-----------------|
| planning -> implementing | Detect repos | Detect repos + create branch per repo |
| implementer completes | Commit per repo | Commit per repo |
| fixer completes | Commit per repo | Commit per repo |
| reviewer passes -> completed | Push per repo | Push per repo + create PR per repo |

### Multi-Repo Support

Tasks can span multiple repositories. The pipeline auto-detects which repos are involved by walking file paths to their nearest `.git` directory. Git operations (branch, commit, push, PR) are executed independently per repo, coordinated under the same task ID.

### Commit Styles

| Style | Implementation | Fix |
|-------|---------------|-----|
| `conventional` | `feat(TASK-001): summary` | `fix(TASK-001): address review round 2` |
| `simple` | `TASK-001: summary` | `TASK-001: fix review round 2` |
| `template` | Uses `commit_template` with `{type}`, `{id}`, `{slug}`, `{message}` variables |

### Branch Template Variables

| Variable | Example |
|----------|---------|
| `{id}` | `TASK-001` |
| `{slug}` | `add-user-auth` |

During `/task-init`, the plugin detects existing branch naming conventions from repo history and suggests a matching template.

## Upgrading

When the plugin adds new features (directories, config fields, files), upgrade your project's `.agent/` directory:

```
/reinit
```

Reinit compares your current `.agent/` against the plugin's schema and shows what needs updating. It deep-merges missing config fields without overwriting your existing values. Always presents a dry-run report before making changes.

For first-time setup, use `/task-init` (which calls reinit internally).

## New Features (v0.10.0)

These features are available after upgrading your pipeline with `/reinit`.

### Lifecycle Hooks

**Effort: Medium** | Defined in `.agent/hooks.md`

Declarative event-driven rules that the lead agent evaluates during pipeline orchestration. Hooks fire on events like tool use, agent completion, stage transitions, and task completion.

| Event | When | Default Hooks |
|-------|------|---------------|
| `PreToolUse` | Before file operations | Working folder enforcement (enforce) |
| `PostToolUse` | After file modifications | -- |
| `SubagentStop` | Agent completes work | Metrics recording (always) |
| `StageTransition` | Task advances to next stage | -- |
| `TaskCompleted` | Task reaches completed | Adventure completion check (advisory) |
| `InstructionsLoaded` | Agent prompt assembled | -- |

Hooks use three modes: `enforce` (mandatory, blocks on failure), `advisory` (recommendation only), and `always` (logging/metrics). Configure in `.agent/hooks.md` frontmatter.

See `docs/concepts/hooks.md` for details.

### Agent Persistent Memory

**Effort: Low** | Stored in `.agent/agent-memory/<role>/`

Each agent role gets a persistent memory directory with a `MEMORY.md` index file and optional topic files. The lead agent injects the first 200 lines of a role's `MEMORY.md` into the spawn prompt. Agents curate their own memory at task end.

Memory is project-scoped (version-controllable), role-specific (no cross-role contamination), and self-curated (agents manage their own entries). This complements the shared knowledge base which captures project-wide patterns.

See `docs/concepts/agent-memory.md` for details.

### Skills v2 (Enhanced Skill Format)

**Effort: Medium** | Enhanced SKILL.md frontmatter

Extended skill frontmatter with four new optional fields:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `context` | `inline \| fork` | `inline` | Run skill inline or in a separate subagent |
| `agent` | string | current role | Role template for forked context |
| `model` | `opus \| sonnet \| haiku` | role default | Override model for this skill |
| `allowed-tools` | string[] | all role tools | Restrict available tools |

All new fields are optional with backward-compatible defaults. Existing skills work unchanged.

See `docs/concepts/skills-v2.md` for details.

### Composite Skills

**Effort: High** | Three new multi-agent workflow skills

| Skill | Description | Context |
|-------|-------------|---------|
| `/simplify` | Multi-perspective code review (3 parallel agents: reuse, quality, efficiency) | fork, reviewer, sonnet |
| `/batch` | Bulk file operations with pattern matching and sequential execution | fork, coder, sonnet |
| `/debug-pipeline` | Pipeline diagnostics with health report and recommendations | inline, read-only |

Composite skills use `context: fork` and `disable-model-invocation: true`. They are triggered manually and run multi-step workflows.

### Path-Scoped Rules

**Effort: Low** | Stored in `.agent/rules/`

Markdown files with glob patterns that inject instructions when agents work on matching files. Rules are user-maintained and complement the shared knowledge base (global patterns) and hooks (event-driven behavior).

```yaml
# .agent/rules/api-conventions.md
---
paths:
  - "packages/web-api/src/routes/**/*.ts"
---

# API Conventions

- All endpoints return JSON with consistent error format
- Use ApiError class for typed errors
```

Rules are checked by the planner (included in designs) and the lead (injected into agent prompts). Rules without `paths` apply to all tasks.

See `docs/concepts/rules.md` for details.

## Roadmap

See `docs/concepts/` for planned features:
- **Roles** -- Customizable agent templates per project
- **Lead Agent** -- Automated pipeline orchestration (implemented)
- **Messenger** -- Discord/Telegram/Slack notifications
- **Git Operations** -- Branch, commit, push, PR lifecycle (implemented)
- **Reinit** -- Schema-driven pipeline upgrades (implemented)
- **Init-Roles** -- Interactive role setup
- **Init-Skills** -- Automatic skill discovery
- **Learn** -- Extract patterns from external projects

Detailed specifications in `docs/designs/`.

## License

MIT
