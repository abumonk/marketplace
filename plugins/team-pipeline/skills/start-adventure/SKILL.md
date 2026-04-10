---
name: start-adventure
description: Start a new feature adventure. Generates concept, spawns planning, creates tasks.
argument-hint: <feature description>
---

# Start Adventure

Create a new feature adventure from the user's prompt.

## Steps

### 1. Validate Environment

Check that `.agent/tasks/` exists. If not, tell the user to run `/task-init` first.

If `.agent/adventures/` does not exist, create it.

### 2. Generate Adventure ID

Scan `.agent/adventures/` for existing adventure directories matching pattern `ADV-*`. Find the highest number and increment by 1. If none exist, start at `ADV-001`.

### 3. Create Adventure Directory Structure

Create the full directory tree:
```
.agent/adventures/{ADV-ID}/
.agent/adventures/{ADV-ID}/designs/
.agent/adventures/{ADV-ID}/plans/
.agent/adventures/{ADV-ID}/schemas/
.agent/adventures/{ADV-ID}/tasks/
.agent/adventures/{ADV-ID}/tasks/archive/
.agent/adventures/{ADV-ID}/roles/
.agent/adventures/{ADV-ID}/tests/
.agent/adventures/{ADV-ID}/reviews/
```

### 4. Extract Concept

The user's prompt is in $ARGUMENTS. Formulate a concept from it:
- **Title**: Short name for the feature (derive from the prompt)
- **Concept**: The full user prompt plus any clarifying context from the conversation

### 5. Collect Environment Data

Gather project and system context:
- **Project**: read from `CLAUDE.md` title or workspace root directory name
- **Workspace**: current working directory
- **Repo**: run `git remote get-url origin` (or "local" if no remote)
- **Branch**: run `git branch --show-current`
- **PC**: hostname from environment
- **Platform**: OS type and version
- **Runtime**: run `node --version`
- **Shell**: from $SHELL or environment

### 6. Create Adventure Manifest

Write `.agent/adventures/{ADV-ID}/manifest.md`:

```markdown
---
id: {ADV-ID}
title: {title}
state: concept
created: {ISO timestamp}
updated: {ISO timestamp}
tasks: []
depends_on: []
---

## Concept
{concept text from user prompt}

## Target Conditions
| ID | Description | Source | Design | Plan | Task(s) | Proof Method | Proof Command | Status |
|----|-------------|--------|--------|------|---------|-------------|---------------|--------|

## Evaluations
| Task | Access Requirements | Skill Set | Est. Duration | Est. Tokens | Est. Cost | Actual Duration | Actual Tokens | Actual Cost | Variance |
|------|-------------------|-----------|---------------|-------------|-----------|-----------------|---------------|-------------|----------|

## Environment
- **Project**: {project name}
- **Workspace**: {workspace root path}
- **Repo**: {git remote URL or "local"}
- **Branch**: {base branch}
- **PC**: {hostname}
- **Platform**: {OS version}
- **Runtime**: {node version}
- **Shell**: {shell type}
```

### 7. Initialize Adventure Log

Create `.agent/adventures/{ADV-ID}/adventure.log` with the first entry:
```
[{ISO timestamp}] lead | "adventure created: {ADV-ID} {title}"
```

### 8. Initialize Adventure Metrics

Create `.agent/adventures/{ADV-ID}/metrics.md`:
```markdown
---
adventure_id: {ADV-ID}
total_tokens_in: 0
total_tokens_out: 0
total_duration: 0
total_cost: 0.00
agent_runs: 0
---

## Agent Runs

| Agent | Task | Model | Tokens In | Tokens Out | Duration | Turns | Result |
|-------|------|-------|-----------|------------|----------|-------|--------|
```

### 9. Checkpoint 1: Concept Approval

Present the concept to the user:

```
## Adventure {ADV-ID}: {title}

**Concept:**
{concept text}

Does this concept look right? I'll generate the full design, implementation plans, target conditions, and task breakdown next.
```

Wait for user approval. If the user wants changes, update the concept and re-present.

### 10. Spawn Adventure Planner

On approval, update the manifest:
- Set `state: planning`
- Set `updated` timestamp

Append to `adventure.log`:
```
[{ISO timestamp}] lead | "state: concept -> planning"
[{ISO timestamp}] lead | "spawned: adventure-planner for {ADV-ID}"
```

Spawn the `adventure-planner` agent in the background with this prompt:
"Generate a complete feature adventure plan from the manifest at `.agent/adventures/{ADV-ID}/manifest.md`. Read the concept, explore the codebase, and produce: design documents, schemas, implementation plans, evaluations, target conditions, task breakdown, permission analysis, and custom roles. Set adventure state to review when complete."

Tell the user: "Adventure planner spawned for {ADV-ID}. It will generate designs, schemas, plans, evaluations, target conditions, permissions, and custom roles. Use `/adventure-status` to track progress."

#### Failure Recovery

If the adventure-planner agent fails (crash, timeout, or error detected by SubagentStop hook):

1. Read the manifest to check `state`. If still `planning` (planner never set `review`), this is a failure.
2. Check what artifacts were created — read `designs/`, `plans/`, `schemas/` for partial output.
3. **If no artifacts created** (complete failure):
   - Rollback manifest `state` to `concept`
   - Append to `adventure.log`: `[{timestamp}] lead | "planner failed: no artifacts, state -> concept"`
   - Tell user: "Adventure planner failed for {ADV-ID}. Rolled back to concept. Retry or adjust the concept."
4. **If partial artifacts created** (timeout or partial failure):
   - Keep manifest `state` as `planning` (partial work is salvageable)
   - Append to `adventure.log`: `[{timestamp}] lead | "planner partial failure: {N} designs, {N} plans created"`
   - Tell user: "Planner partially completed. Options: (a) retry planner, (b) manually review and advance."
5. **Never retry automatically** — always present recovery options and wait for user decision.

### 11. Checkpoint 2: Plan & Permissions Approval (handled by lead/hook)

When the adventure planner completes successfully (manifest `state` is `review`), the lead presents to the user:
- Target conditions table
- Evaluations table with cost estimates
- Proposed task list
- **Permission requests** from `permissions.md` (4-pass analysis)
- **Custom roles** summary from `roles/`

User approves: plan, tasks, AND permissions together.

On user approval, the **lead agent** creates task files using a validate-then-create approach:

#### Phase A: Validate (dry run — no files written)

1. Read all plans from `.agent/adventures/{ADV-ID}/plans/`
2. For each task, collect: title, description, files, acceptance criteria, target conditions, evaluation, dependencies
3. Task IDs use format `ADV{NNN}-T{NNN}` (e.g., `ADV015-T001`), numbered sequentially from T001
4. Resolve `depends_on` references: convert task titles in plans to the assigned task IDs
5. Validate all tasks:
   - Every task has a title, description, and at least one target condition
   - All `depends_on` references resolve to valid task IDs within this adventure
   - All `target_conditions` TC-IDs exist in the manifest's target conditions table
   - Test design and test implementation tasks are present
6. If validation fails: report errors to the user and STOP.

#### Phase B: Create (atomic batch — all or nothing)

7. Create all task files at `.agent/adventures/{ADV-ID}/tasks/{task-id}.md`:

```markdown
---
id: {ADV{NNN}-T{NNN}}
title: {task title}
stage: planning
status: in_progress
created: {ISO timestamp}
updated: {ISO timestamp}
iterations: 0
assignee: planner
files: {files from plan}
repos: []
depends_on: {resolved task IDs from phase A}
tags: {derived from adventure}
adventure_id: {ADV-ID}
adventure_plan: {plan-slug}
target_conditions: [{TC-IDs}]
evaluation:
  access_requirements: [{tools}]
  skill_set: [{skills}]
  estimated_duration: {duration}
  estimated_tokens: {tokens}
---

## Description
{task description from plan}

## Acceptance Criteria
{criteria from plan}

## Design
<!-- Filled by planner agent -->

## Log
- [{timestamp}] created: Task created from adventure {ADV-ID}
```

8. After ALL task files are created successfully, update the adventure manifest:
   - Set `tasks: [{all task IDs}]`
   - Set `state: active`
   - Set `updated` timestamp

9. Update `permissions.md` frontmatter: set `status: approved`, `approved: {timestamp}`

10. Append to `adventure.log`:
```
[{timestamp}] lead | "tasks created: {task IDs}"
[{timestamp}] lead | "permissions approved"
[{timestamp}] lead | "state: review -> active"
```

11. Spawn the planner agent for each task

#### Phase C: Rollback (if any file creation fails)

If any task file fails to write during Phase B:
1. Delete all task files created so far in this batch
2. Do NOT update the adventure manifest (state stays `review`)
3. Append to `adventure.log`: `[{timestamp}] lead | "task creation FAILED: {error}"`
4. Report the error to the user

Tell the user: "{N} tasks created from adventure {ADV-ID}. Planner agents spawned. Use `/task-status` to track progress."

### 12. Post-Review Task Creation

During adventure execution, user may request additional tasks. These follow the same rules:

1. New tasks are created in `.agent/adventures/{ADV-ID}/tasks/` with next sequential T-number
2. New tasks use the same adventure's custom roles, log, and metrics
3. Adventure must be `active` or `blocked` — reject for `completed` or `cancelled`
4. If adventure was `blocked`, transition to `active` when new fixing tasks are created
5. Append to `adventure.log`: `[{timestamp}] lead | "post-review task created: {task ID}"`
