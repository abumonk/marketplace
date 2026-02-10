# Git Operations Design

**Date**: 2026-02-10
**Status**: Implemented

## Overview

Add git lifecycle management to the task pipeline. Git operations are orchestrated by the lead agent — individual pipeline agents (planner, implementer, reviewer, researcher) remain unaware of git. Every git action is proposed by the lead and requires user approval before execution.

## Principles

1. **Agents don't know about git.** No changes to agent definitions.
2. **Lead proposes, user approves.** Commits, pushes, PRs — all proposed, never automatic.
3. **Per-repo awareness.** A single task can span multiple repositories. Git operations are grouped and executed per repo.
4. **Configurable mode.** Two modes: `current-branch` (default) and `branch-per-task`.

## Configuration

New `git` block in `.agent/config.md` frontmatter:

```yaml
git:
  mode: "current-branch"           # "current-branch" | "branch-per-task"
  branch_template: "task/{id}-{slug}"
  base_branch: "main"
  auto_detect_repos: true
  commit_style: "conventional"     # "conventional" | "simple" | "template"
  commit_template: "{type}({id}): {message}"
  pr_template: "default"
```

### Mode: `current-branch` (default)

- No branch creation, no checkout, no PR creation
- Commits proposed at stage transitions on whatever branch is currently checked out
- Push proposed at task completion
- Lowest friction, works for solo developers and simple workflows

### Mode: `branch-per-task`

- Branch created when task enters `implementing` stage
- Named using `branch_template` (e.g. `task/TASK-003-add-auth`)
- Commits on the task branch at each stage transition
- Push + PR proposed at task completion
- PR targets `base_branch`

## Repository Auto-Detection

When the lead needs to determine which repos are involved:

1. Read the task's `files` field (populated by planner, updated by implementer)
2. For each file path, walk up the directory tree to find the nearest `.git` directory
3. Group files by repo root
4. Store the mapping in the task frontmatter as a `repos` field

Re-detection happens at every stage transition to catch files the implementer touched beyond the original plan.

### Task Frontmatter Addition

```yaml
repos:
  - root: "R:/Claudovka/projects/frontend"
    branch: "task/TASK-003-add-auth"    # only in branch-per-task mode
    base: "main"
    files: [src/login.tsx, src/auth.ts]
  - root: "R:/Claudovka/projects/api-server"
    branch: "task/TASK-003-add-auth"
    base: "main"
    files: [src/routes/auth.rs]
```

## Git Operations at Each Stage Transition

### Planning -> Implementing

| Mode | Action |
|------|--------|
| `current-branch` | No git action. Detect repos, populate `repos` field. |
| `branch-per-task` | Propose: create branch per detected repo, checkout. |

### Implementer Completes (status: ready)

Both modes:
- Lead re-detects repos from actual changed files (`git diff`), not just the `files` field
- Updates task `repos` field if new repos appeared
- Proposes per-repo commit: `feat(TASK-003): implement auth components`
- After approval: stages relevant files, commits
- Then proposes advancing to `reviewing`

### Reviewer Completes (status: failed -> fixing)

- No git action. Fixing continues on the same branch / current branch.

### Fixer Completes (status: ready -> reviewing again)

Both modes:
- Proposes per-repo commit: `fix(TASK-003): address review round {n}`
- Iteration number in commit message for traceability

### Reviewer Completes (status: passed -> completed)

| Mode | Action |
|------|--------|
| `current-branch` | Propose push per repo. No PR. |
| `branch-per-task` | Propose push per repo. Propose PR per repo targeting `base_branch`. |

PR body assembled from:
- Task description and acceptance criteria
- Review report (from `.agent/reports/`)
- File list per repo
- Cross-links between PRs if multi-repo

## Commit Message Format

### `conventional` style (default)

```
feat(TASK-003): implement user authentication

- Add login component
- Add auth middleware
- Add JWT token handling
```

Stage-dependent type prefixes:
- `implementing -> reviewing`: `feat({id}): {message}`
- `fixing -> reviewing`: `fix({id}): address review round {n}`

### `simple` style

```
TASK-003: implement user authentication
```

### `template` style

Uses `commit_template` from config. Available variables:
- `{type}` — feat/fix based on stage
- `{id}` — task ID
- `{slug}` — slugified task title
- `{message}` — generated summary of changes

## Implementation Scope

### Files Changed

1. **`hooks/hooks.json`** — Extend `SubagentStop` hook prompt with git awareness. Lead detects repos, proposes git operations alongside stage advancement.

2. **`skills/task-init/SKILL.md`** — Add `git:` config block to `.agent/config.md` template. Ask user during init for git mode preference.

3. **`commands/task.md`** — Extend `/task advance` to execute approved git operations at each transition: create branch, stage+commit, push, create PR.

4. **Task frontmatter schema** — Add optional `repos` field. Non-breaking; tasks without it skip git ops.

5. **PR body template** — New template for assembling PR descriptions from task artifacts.

### Files NOT Changed

- Agent definitions (planner.md, implementer.md, reviewer.md, researcher.md)
- Role templates
- Skills (task-create, task-status, task-migrate, learn, init-roles, init-skills)
- Knowledge base system

The git layer is contained in the lead's hook logic and the `/task advance` command.

## Flow Diagram

```
task created
  |
  v
planning (no git)
  |  planner writes design to .agent/ (gitignored)
  v
implementing
  |  [branch-per-task: create branch per repo]
  |  [both: detect repos, populate task.repos]
  |  implementer works...
  |  implementer sets status: ready
  v
lead proposes commit per repo -----> user approves
  |
  v
reviewing
  |  reviewer reads code, runs tests
  |  reviewer sets status: passed | failed
  |
  +--[failed]--> fixing
  |                |  lead proposes commit after fix
  |                |  loop back to reviewing (max 3)
  |
  +--[passed]--> completed
                   |  lead proposes push per repo
                   |  [branch-per-task: lead proposes PR per repo]
                   v
                 researching (no git)
```

## Resolved Questions

- **Auto-detect branch conventions**: Yes. `task-init` scans repo branch history and suggests a matching `branch_template` if a pattern is found (e.g. `feature/`, `fix/`).
- **Stash handling on dirty working tree**: No. User's responsibility. Lead does not propose stash operations.
- **Branch cleanup after PR merge**: No. Out of scope. Users manage branch cleanup themselves.
