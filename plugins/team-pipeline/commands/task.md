---
description: Main entry point for the task pipeline - create, advance, and manage tasks
disable-model-invocation: true
argument-hint: [create|status|advance|complete|cancel|migrate|lead] [task-id]
---

# Task Pipeline Command

Handle the user's task pipeline request based on arguments: $ARGUMENTS

## Actions

### `/task create` or `/task` with no arguments
Invoke the `team-pipeline:task-create` skill.

### `/task status`
Invoke the `team-pipeline:task-status` skill.

### `/task advance TASK-XXX`
Advance the specified task to its next stage:

1. Read the task file at `.agent/tasks/{task-id}.md`
2. Check the current `stage` and `status`:
   - `planning` + `status: ready` --> set `stage: implementing`, `status: in_progress`, `assignee: implementer`. Spawn `implementer` agent with prompt: "Implement task at `.agent/tasks/{task-id}.md`. Read the task and design, implement changes, run build and tests, set status to ready when complete."
   - `implementing` + `status: ready` --> set `stage: reviewing`, `status: in_progress`, `assignee: reviewer`. Spawn `reviewer` agent with prompt: "Review task at `.agent/tasks/{task-id}.md`. Read the task, design, and implementation. Run build and tests. Output review report. Set status to passed or failed."
   - `reviewing` + `status: failed` --> increment `iterations`. If `iterations >= max_iterations` (from config.md), set stage to BLOCKED and notify user. Otherwise set `stage: fixing`, `status: in_progress`, `assignee: implementer`. Save the reviewer's report to `.agent/reports/{task-id}-review.md`. Spawn `implementer` agent with prompt: "Fix task at `.agent/tasks/{task-id}.md`. Read review report at `.agent/reports/{task-id}-review.md`. Address all issues. Set status to ready when complete."
   - `fixing` + `status: ready` --> set `stage: reviewing`, `status: in_progress`, `assignee: reviewer`. Spawn `reviewer` agent.
   - `reviewing` + `status: passed` --> set `stage: completed`, `status: done`, `assignee: --`. Move task file to `.agent/tasks/archive/`. Spawn `researcher` agent with prompt: "Research completed task at `.agent/tasks/archive/{task-id}.md`. Analyze all artifacts and update knowledge base."
3. Update `updated` timestamp in frontmatter.
4. Append to `## Log`: `- [{timestamp}] lead: Advanced to {new stage}`
5. If the status doesn't allow advancement, tell the user why.

### `/task complete TASK-XXX`
Force-complete a task (skip remaining stages):
1. Set `stage: completed`, `status: done`
2. Move to archive
3. Spawn researcher

### `/task cancel TASK-XXX`
Cancel a task:
1. Set `stage: cancelled`, `status: cancelled`
2. Move to archive
3. Do not spawn researcher

### `/task migrate`
Invoke the `team-pipeline:task-migrate` skill. Imports existing TODOs, issues, and work items from user-specified sources into the pipeline.

### `/task lead`

Invoke the lead agent for on-demand pipeline analysis.

1. The lead agent reads all pipeline state:
   - `.agent/lead-state.md` (orchestration state)
   - `.agent/tasks/*.md` (all active tasks)
   - `.agent/config.md` (stage assignments, settings)
   - `.agent/messenger.md` (notification channels)
2. Presents comprehensive pipeline report:
   - Current task status across all stages
   - Pending decisions awaiting user input
   - Recommendations with reasoning
   - Queue and dependency analysis
   - Notification channel status
3. Proposes next actions as a numbered list
4. Awaits user decision

The lead agent follows its role definition at `roles/templates/lead.md` under the "On-Demand: /task lead" section.
