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
| researching | researcher | haiku | Extract patterns to knowledge base |

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
| `task-init` | Initialize `.agent/` directory in your project |
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

## Roadmap

See `docs/concepts/` for planned features:
- **Roles** -- Customizable agent templates per project
- **Lead Agent** -- Automated pipeline orchestration (implemented)
- **Messenger** -- Discord/Telegram/Slack notifications
- **Git Operations** -- Branch, commit, push, PR lifecycle (implemented)
- **Init-Roles** -- Interactive role setup
- **Init-Skills** -- Automatic skill discovery
- **Learn** -- Extract patterns from external projects

Detailed specifications in `docs/designs/`.

## License

MIT
