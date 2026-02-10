# Git Operations Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add lead-orchestrated git lifecycle management (branch, commit, push, PR) to the task pipeline, with per-repo awareness and two configurable modes.

**Architecture:** Git operations are entirely contained in the lead agent's hook logic and the `/task advance` command. No changes to pipeline agents. The lead detects repos from file paths, proposes git actions at stage transitions, and the `/task advance` command executes approved operations. Two modes: `current-branch` (default, commits on current branch) and `branch-per-task` (creates isolated branch per task).

**Tech Stack:** Claude Code plugin system (markdown agents, YAML frontmatter, prompt-based hooks), git CLI, gh CLI (for PRs)

**Design Doc:** `docs/designs/git-operations-design.md`

---

### Task 1: Add git config block to task-init skill

**Files:**
- Modify: `skills/task-init/SKILL.md`

**Step 1: Add git config to the `.agent/config.md` template**

In `skills/task-init/SKILL.md`, update step 3 — the config.md template. Add the `git:` block to the YAML frontmatter:

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

**Step 2: Add branch convention detection step**

After step 3, add a new step that detects existing branch naming conventions:

```markdown
4. Detect branch naming conventions in the project:
   - Run `git branch -a --list` in the project directory
   - Look for common patterns: `feature/`, `fix/`, `task/`, `hotfix/`, `release/`
   - If a dominant pattern is found (>50% of branches), suggest it as the `branch_template`
   - Example: if most branches start with `feature/`, suggest `branch_template: "feature/{id}-{slug}"`
   - Present the detected pattern to the user: "Detected branch pattern: `feature/`. Use `feature/{id}-{slug}` as template?"
   - If no pattern found or user declines, keep default `task/{id}-{slug}`
```

**Step 3: Add git mode question**

After the branch detection step, add:

```markdown
5. Ask the user: "Git mode for this project?"
   - **current-branch** (default): Commits on the current branch at stage transitions. No branch creation, no PRs.
   - **branch-per-task**: Creates a new branch per task at implementation start. Push + PR on completion.
```

**Step 4: Renumber remaining steps**

Renumber the subsequent steps (knowledge files, lead-state, messenger, questions, metrics) to account for the two new steps inserted.

**Step 5: Commit**

```
feat(task-init): add git configuration block and branch detection
```

---

### Task 2: Add repos field to task frontmatter schema

**Files:**
- Modify: `skills/task-create/SKILL.md`

**Step 1: Add repos field to the task template**

In `skills/task-create/SKILL.md`, update step 4 — the task file template. Add `repos: []` to the YAML frontmatter, after the `files` field:

```yaml
---
id: {TASK-ID}
title: {title}
stage: planning
status: in_progress
created: {ISO timestamp}
updated: {ISO timestamp}
iterations: 0
assignee: planner
files: []
repos: []
depends_on: []
tags: [{tags}]
---
```

No other changes. The `repos` field starts empty and gets populated by the lead agent at stage transitions.

**Step 2: Commit**

```
feat(task-create): add repos field to task frontmatter schema
```

---

### Task 3: Extend SubagentStop hook with git awareness

**Files:**
- Modify: `hooks/hooks.json`

**Step 1: Update the SubagentStop prompt**

In the `SubagentStop` hook's prompt string, add git operation steps after the existing step 12 (metrics recording) and before step 13 (questions check). Insert:

```
13. Git operations evaluation:
    a. Read `.agent/config.md` for the `git:` config block
    b. If `git.auto_detect_repos` is true, determine which repos are involved:
       - Read the task's `files` field
       - For each file path, run `git -C {dir} rev-parse --show-toplevel` to find the repo root
       - Group files by repo root
       - Also check `git diff --name-only` in each detected repo to catch files modified beyond the plan
    c. Update the task's `repos` field with the detected repo mapping (root, files per repo)
    d. Based on the stage transition:
       - If implementer/fixer completed (status: ready):
         Propose per-repo commit. Use commit style from config:
         - conventional: `feat({id}): {summary}` for implementing, `fix({id}): address review round {iterations}` for fixing
         - simple: `{id}: {summary}`
         - template: use `commit_template` with variable substitution
         List the files to be staged per repo.
       - If reviewer completed (status: passed) -> task completing:
         Propose per-repo push.
         If mode is `branch-per-task`: also propose PR creation per repo with body from task description + acceptance criteria + review report.
       - If planning -> implementing AND mode is `branch-per-task`:
         Propose per-repo branch creation using `branch_template`.
    e. Include git proposals in the standard proposal format, after stage advancement recommendation:
       ```
       ### Git Operations

       **Repo: {repo_root}**
       1. Stage files: {file_list}
       2. Commit: `{commit_message}`

       **Repo: {repo_root_2}**
       1. Stage files: {file_list}
       2. Commit: `{commit_message}`
       ```
    f. If no `git:` config block exists in config.md, skip all git operations silently.
```

Renumber the existing steps 13-14 (questions) to 14-15.

**Step 2: Commit**

```
feat(hooks): add git operations to SubagentStop lead hook
```

---

### Task 4: Extend /task advance with git operation execution

**Files:**
- Modify: `commands/task.md`

**Step 1: Add git operations to the planning -> implementing transition**

In the `/task advance` section, after the `planning + status: ready` transition line, add:

```markdown
   Read `.agent/config.md` for git config. If `git.mode` is `branch-per-task`:
   - For each repo in the task's `repos` field (or detect repos from `files` if `repos` is empty):
     - Run `git -C {repo_root} checkout -b {branch_name}` where branch_name is built from `git.branch_template` replacing `{id}` with task ID and `{slug}` with slugified title
     - Update task `repos` field with branch name per repo
   If `git.mode` is `current-branch`:
   - Detect repos from `files` field, populate task `repos` field (root, current branch name, files)
```

**Step 2: Add git commit to the implementing -> reviewing transition**

After the `implementing + status: ready` transition, add:

```markdown
   Read `.agent/config.md` for git config. For each repo in the task's `repos` field:
   - Detect changed files: `git -C {repo_root} diff --name-only`
   - Stage task-related files: `git -C {repo_root} add {files}`
   - Build commit message based on `git.commit_style`:
     - conventional: `feat({task-id}): {task title}`
     - simple: `{task-id}: {task title}`
     - template: substitute variables in `git.commit_template`
   - Commit: `git -C {repo_root} commit -m "{message}"`
   - Update task `repos[].files` with actual committed files
```

**Step 3: Add git commit to the fixing -> reviewing transition**

After the `fixing + status: ready` transition, add the same commit logic but with:
- conventional: `fix({task-id}): address review round {iterations}`
- simple: `{task-id}: fix review round {iterations}`

**Step 4: Add push and PR to the reviewing -> completed transition**

After the `reviewing + status: passed` transition (before moving to archive), add:

```markdown
   Read `.agent/config.md` for git config. For each repo in the task's `repos` field:
   - Push: `git -C {repo_root} push -u origin {branch_name}`
   - If `git.mode` is `branch-per-task`:
     - Build PR body from:
       - Task description (from task file ## Description)
       - Acceptance criteria (from task file ## Acceptance Criteria)
       - Review report (from `.agent/reports/{task-id}-review.md` if exists)
       - Files changed (from repos[].files)
       - If multi-repo: "Related PRs: {links to PRs in other repos}"
     - Create PR: `gh pr create --base {git.base_branch} --title "{task-id}: {title}" --body "{body}"`
     - Log PR URL in task log
```

**Step 5: Add log entries for git operations**

Each git operation appends to `## Log`:
- `[{timestamp}] git: Created branch {branch} in {repo}`
- `[{timestamp}] git: Committed {n} files in {repo}: {message}`
- `[{timestamp}] git: Pushed {branch} to origin in {repo}`
- `[{timestamp}] git: Created PR #{number} in {repo}`

**Step 6: Commit**

```
feat(task-advance): execute git operations at stage transitions
```

---

### Task 5: Update lead role template with git awareness

**Files:**
- Modify: `roles/templates/lead.md`

**Step 1: Add Git Operations section**

After the "## Metrics Recording" section, add a new section:

```markdown
## Git Operations

When evaluating stage transitions during SubagentStop, also assess git operations:

1. Read `.agent/config.md` -> `git` config block. If absent, skip git operations entirely.
2. Detect repositories:
   - Read the task's `files` field
   - For each file path, determine the repo root (walk up to `.git` directory)
   - Also check actual changed files via `git diff --name-only` in each detected repo
   - Group files by repo root
3. Based on transition and git mode, include git proposals:
   - **Implementer/fixer completed**: Propose commit per repo with appropriate message style
   - **Reviewer passed -> completed**: Propose push per repo. In `branch-per-task` mode, also propose PR.
   - **Planning -> implementing** (branch-per-task only): Propose branch creation per repo
4. Format git proposals under a `### Git Operations` heading in the standard proposal format
5. Always list specific files to be staged per repo — never propose `git add .`
6. Update the task's `repos` field with detected repo mapping

### Commit Message Conventions

Read `git.commit_style` from config:
- **conventional**: `feat({id}): {summary}` for implementation, `fix({id}): address review round {n}` for fixes
- **simple**: `{id}: {summary}`
- **template**: substitute `{type}`, `{id}`, `{slug}`, `{message}` in `git.commit_template`
```

**Step 2: Update Rules section**

Add to the existing Rules list:
```markdown
- NEVER run `git add .` or `git add -A` -- always stage specific files
- NEVER force push or rewrite history
- ALWAYS include git proposals when config has `git:` block and a stage transition involves code changes
```

**Step 3: Commit**

```
feat(lead): add git operations awareness to lead role template
```

---

### Task 6: Add PR body template

**Files:**
- Create: `roles/templates/pr-template.md`

**Step 1: Create the PR body template**

```markdown
## Summary

**Task**: {task-id}
**Title**: {task-title}

{task-description}

## Acceptance Criteria

{acceptance-criteria}

## Review

{review-summary-or-link-to-report}

## Changes

{file-list-per-repo}

## Related

{cross-links-to-prs-in-other-repos-if-multi-repo}
```

This template is referenced by the lead and `/task advance` when `git.pr_template` is `"default"`. Custom templates can be pointed to via a path in that config field.

**Step 2: Commit**

```
feat: add default PR body template
```

---

### Task 7: Update team-update skill for git migration

**Files:**
- Modify: `skills/team-update/SKILL.md`

**Step 1: Add git config migration**

Read the existing `team-update/SKILL.md` first. Add a new migration check:

```markdown
- **Git config missing**: If `.agent/config.md` exists but has no `git:` block in frontmatter:
  - Add the default `git:` block (mode: current-branch, branch_template: task/{id}-{slug}, etc.)
  - Detect branch conventions from repo history and suggest template
  - Ask user for git mode preference
```

Add this to the migration detection list and the migration execution sequence.

**Step 2: Commit**

```
feat(team-update): add git config migration for existing projects
```

---

### Task 8: Update documentation

**Files:**
- Modify: `docs/designs/git-operations-design.md`
- Modify: `README.md`

**Step 1: Mark design as implemented**

Change the status in `docs/designs/git-operations-design.md`:
```
**Status**: Implemented
```

**Step 2: Update README**

Add a section about git operations to the README. Describe:
- Two modes (current-branch, branch-per-task)
- Configuration via `.agent/config.md`
- What happens at each stage transition
- Multi-repo support

**Step 3: Commit**

```
docs: add git operations documentation
```

---

## Task Dependency Graph

```
Task 1 (config) ─┐
Task 2 (schema)  ─┼── Task 3 (hook) ──┐
                  │                    ├── Task 5 (lead role)
                  └── Task 4 (advance) ┘

Task 6 (PR template) ── standalone
Task 7 (migration) ── depends on Task 1
Task 8 (docs) ── last, after all others
```

**Parallel groups:**
- Group A: Tasks 1, 2, 6 (independent, no dependencies)
- Group B: Tasks 3, 4, 5 (depend on Group A)
- Group C: Task 7 (depends on Task 1)
- Group D: Task 8 (depends on all)
