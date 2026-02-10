---
description: Main entry point for the task pipeline - create, advance, and manage tasks
disable-model-invocation: true
argument-hint: [create|status|advance|complete|cancel|migrate|controller] [task-id|status|mode|pause|resume]
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

### `/task controller [status|mode|pause|resume]`

Manage the pipeline controller orchestration layer.

1. Parse the subcommand from `$ARGUMENTS`.
2. Read `.agent/controller-state.md`. If it does not exist, tell the user to run `/task-init` first.
3. Execute the requested action:
   - `status` (or no subcommand): Display state summary including mode, paused state, active agents (count, task IDs, roles, start times), queue (count, task IDs, next stages, waiting_on), and last event.
   - `mode <m>`: Validate mode is one of `manual`, `semi-auto`, `full-auto`. Update `mode` field. Update `last_event` to `{type: mode_change, timestamp: now}`. Write state file. Report the change and any implications (e.g., queued tasks will auto-spawn in full-auto).
   - `pause`: Set `paused: true`. Update `last_event`. Write state file. Report: 'Controller paused. All events will produce notifications only.'
   - `resume`: Set `paused: false`. Update `last_event`. Write state file. If mode is `full-auto`, process the queue (dequeue and spawn eligible tasks). Report: 'Controller resumed (mode: {mode}).'
4. If no subcommand is provided, default to `status`.
