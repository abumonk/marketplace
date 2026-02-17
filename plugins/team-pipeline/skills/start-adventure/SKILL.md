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

Create the following directories:
```
.agent/adventures/{ADV-ID}/
.agent/adventures/{ADV-ID}/designs/
.agent/adventures/{ADV-ID}/plans/
.agent/adventures/{ADV-ID}/schemas/
```

### 4. Extract Concept

The user's prompt is in $ARGUMENTS. Formulate a concept from it:
- **Title**: Short name for the feature (derive from the prompt)
- **Concept**: The full user prompt plus any clarifying context from the conversation

### 5. Create Adventure Manifest

Write `.agent/adventures/{ADV-ID}/manifest.md`:

```markdown
---
id: {ADV-ID}
title: {title}
state: concept
created: {ISO timestamp}
updated: {ISO timestamp}
tasks: []
---

## Concept
{concept text from user prompt}

## Target Conditions
| ID | Description | Source | Design | Plan | Task(s) | Proof Method | Proof Command | Status |
|----|-------------|--------|--------|------|---------|-------------|---------------|--------|

## Evaluations
| Task | Access Requirements | Skill Set | Est. Duration | Est. Tokens | Est. Cost | Actual Duration | Actual Tokens | Actual Cost | Variance |
|------|-------------------|-----------|---------------|-------------|-----------|-----------------|---------------|-------------|----------|

## Metrics Summary
<!-- Populated on adventure completion -->
```

### 6. Checkpoint 1: Concept Approval

Present the concept to the user:

```
## Adventure {ADV-ID}: {title}

**Concept:**
{concept text}

Does this concept look right? I'll generate the full design, implementation plans, target conditions, and task breakdown next.
```

Wait for user approval. If the user wants changes, update the concept and re-present.

### 7. Spawn Adventure Planner

On approval, update the manifest:
- Set `state: planning`
- Set `updated` timestamp

Spawn the `adventure-planner` agent in the background with this prompt:
"Generate a complete feature adventure plan from the manifest at `.agent/adventures/{ADV-ID}/manifest.md`. Read the concept, explore the codebase, and produce: design documents, schemas, implementation plans, evaluations, target conditions, and task breakdown. Set adventure state to review when complete."

Tell the user: "Adventure planner spawned for {ADV-ID}. It will generate designs, schemas, plans, evaluations, and target conditions. Use `/adventure-status` to track progress."

### 8. Checkpoint 2: Task List Approval (handled by lead/hook)

When the adventure planner completes (detected by SubagentStop hook), the lead presents the full plan to the user:
- Target conditions table
- Evaluations table with cost estimates
- Proposed task list

On user approval, create TASK-XXX files for each task in the plan:

For each task in the adventure's implementation plans:
1. Determine the next TASK-ID (scan `.agent/tasks/`)
2. Create the task file at `.agent/tasks/{TASK-ID}.md`:

```markdown
---
id: {TASK-ID}
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

3. Add the TASK-ID to the adventure manifest's `tasks` list
4. Spawn the planner agent for each task

Update the adventure manifest:
- Set `state: active`
- Set `tasks: [{all TASK-IDs}]`
- Set `updated` timestamp

Tell the user: "{N} tasks created from adventure {ADV-ID}. Planner agents spawned. Use `/task status` to track progress."
