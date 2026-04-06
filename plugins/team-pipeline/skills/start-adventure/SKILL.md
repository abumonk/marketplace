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

### 2. Extract Concept

The user's prompt is in $ARGUMENTS. Formulate a concept from it:
- **Title**: Short name for the feature (derive from the prompt)
- **Concept**: The full user prompt plus any clarifying context from the conversation

### 3. Collect Environment Data

Gather environment context for the adventure manifest:
- **project**: Read from `CLAUDE.md` title or workspace root directory name
- **workspace**: Current working directory (absolute path)
- **repo**: Run `git remote get-url origin` (use "local" if no remote)
- **branch**: Run `git branch --show-current`
- **pc**: Read from `$COMPUTERNAME` or `hostname` command
- **platform**: OS info (e.g., "Windows 11 Pro 10.0.26200")
- **runtime**: Run `node --version`
- **shell**: Read from `$SHELL` environment variable or detect from context

### 4. Create Adventure via MCP

If `pipeline.adventure_create` MCP tool is available, use it:
```
pipeline.adventure_create({
  title: {title},
  concept: {concept text},
  tags: [{derived tags}],
  environment: {
    project: {project},
    workspace: {workspace},
    repo: {repo},
    branch: {branch},
    pc: {pc},
    platform: {platform},
    runtime: {runtime},
    shell: {shell}
  }
})
```

If MCP is not available, fall back to direct file creation:
1. Scan `.agent/adventures/` for existing `ADV-*` directories, find highest number, increment by 1
2. Create directory structure: `{ADV-ID}/`, `designs/`, `plans/`, `schemas/`, `tasks/`, `tasks/archive/`, `roles/`, `tests/`
3. Write `manifest.md` with frontmatter and body including the environment section

### 6. Checkpoint 1: Concept Approval

Present the concept to the user:

```
## Adventure {ADV-ID}: {title}

**Concept:**
{concept text}

Does this concept look right? I'll generate the full design, implementation plans, target conditions, and task breakdown next.
```

Wait for user approval. If the user wants changes, update the concept and re-present.

### 7. Spawn Adventure Planner (with failure recovery)

On approval, update the manifest:
- Set `state: planning`
- Set `updated` timestamp

Spawn the `adventure-planner` agent in the background with this prompt:
"Generate a complete feature adventure plan from the manifest at `.agent/adventures/{ADV-ID}/manifest.md`. Read the concept, explore the codebase, and produce: design documents, schemas, implementation plans, evaluations, target conditions, permissions document, custom roles, and task breakdown (including mandatory test tasks). Set adventure state to review when complete."

Tell the user: "Adventure planner spawned for {ADV-ID}. It will generate designs, schemas, plans, evaluations, target conditions, permissions, and custom roles. Use `/adventure-status` to track progress."

**Failure Recovery (C1)**:
If the adventure-planner spawn fails or times out:
1. First retry: re-spawn with a more focused prompt scoped to just the designs and plans
2. If second attempt also fails:
   - Reset adventure `state: concept` (so the user can retry or proceed manually)
   - Log the failure to `adventure.log`
   - Tell the user: "Adventure planner failed for {ADV-ID}. State reset to concept. You can retry with `/start-adventure` or create plans manually."
3. Never leave an adventure stuck in `planning` state with no active planner agent

### 8. Checkpoint 2: Plan Approval and Task Creation (lead responsibility)

**Ownership**: The lead agent (via SubagentStop hook) is responsible for checkpoint 2. Not the skill, not the hook directly. When SubagentStop detects adventure-planner completion:

1. Lead reads the adventure manifest and verifies `state: review`
2. Lead presents the full plan to the user:
   - Target conditions table
   - Evaluations table with cost estimates
   - Proposed task list from plans/
   - Permissions document summary from permissions.md
3. Wait for user approval

**Atomic Task Creation (C2)**:

On user approval, the lead creates ALL task files atomically:

1. Build the complete list of task files in memory first (do NOT write yet)
2. For each task in the adventure's implementation plans, prepare a task file:

```markdown
---
id: {ADV-TASK-ID}
title: {task title}
stage: planning
status: in_progress
created: {ISO timestamp}
updated: {ISO timestamp}
iterations: 0
assignee: planner
files: {files from plan}
repos: []
depends_on: {dependencies from plan}
tags: {derived from adventure}
adventure_id: {ADV-ID}
adventure_plan: {plan-NNN}
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
- [{timestamp}] created: Task created from adventure {ADV-ID}, plan {plan-NNN}
```

3. Task IDs use adventure-scoped format: `ADV{NNN}-T{NNN}` (e.g., ADV015-T001)
4. Task files are written to `.agent/adventures/{ADV-ID}/tasks/` (NOT global `.agent/tasks/`)
5. Write all task files. If ANY write fails, delete all successfully written files (rollback) and report the error
6. Only after all files are written successfully:
   - Add all task IDs to the adventure manifest's `tasks` list
   - Set adventure `state: active`
   - Log to adventure.log
7. Spawn the planner agent for the first batch of tasks (respecting dependency order)

**Custom Role Lookup**: When spawning any agent for an adventure task:
1. Check `.agent/adventures/{ADV-ID}/roles/{role}.md` for an adventure-specific role
2. If found: use the adventure role content as the agent's prompt context
3. If not found: fall back to the default role in `roles/templates/{role}.md`
4. Also inject approved permissions from `.agent/adventures/{ADV-ID}/permissions.md` into the agent spawn context

Tell the user: "{N} tasks created for adventure {ADV-ID}. Planner agents spawned. Use `/adventure-status` to track progress."
