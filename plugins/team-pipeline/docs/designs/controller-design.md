# Controller Design

**Date:** 2026-02-10
**Status:** DRAFT
**Depends on:** `docs/concepts/controller.md`, `docs/designs/roles-design.md`, `commands/task.md`

---

## Overview

The controller is system-level infrastructure -- not an agent -- that automates pipeline orchestration through Claude Code hooks and deterministic state machine logic. It replaces the manual `/task advance` workflow with event-driven automation: when a subagent completes work on a task, the controller reads the task file, evaluates stage and status, and applies transition rules governed by the current operating mode. The controller maintains its own state file tracking active agents, a task queue, and configuration, and it integrates with the roles system via `stage_assignments` in `.agent/config.md` to resolve which agent to spawn for each pipeline stage.

---

## Decisions

| Question | Decision | Rationale |
|----------|----------|-----------|
| Task ID extraction from SubagentStop | Parse task path from the agent's prompt text | Every agent prompt includes the task path (e.g., `.agent/tasks/TASK-001.md`). The SubagentStop hook receives the prompt that spawned the agent. Extract task ID via pattern match on `.agent/tasks/(TASK-\d+)\.md`. No additional metadata channel needed. |
| Parallel tasks needing same role | FIFO queue, one agent per role at a time | Serialization prevents resource contention and keeps agent output deterministic. When two tasks need the same role, the second enters the queue. When the first completes, the controller dequeues the next. |
| Timeout policy | `maxTurns` only, no wall-clock timeout | Claude Code hooks do not expose wall-clock elapsed time. Each role defines `maxTurns` in its frontmatter. When an agent hits `maxTurns`, Claude Code stops it and `SubagentStop` fires normally. Wall-clock timeout is not implementable and therefore not attempted. |
| Agent crash recovery | SubagentStop fires regardless; detect crash by unchanged status | If `SubagentStop` fires and the task's `status` is still `in_progress` (unchanged from when the agent started), the controller treats this as a crash. It sets `status: error`, appends to the task log, and notifies the user. |
| Cross-task `depends_on` | Controller enforces before advancing | Before advancing a task to its next stage, the controller checks `depends_on`. If any dependency is not `stage: completed`, the task enters the queue with `waiting_on` populated. When a dependency completes, the controller re-evaluates all waiting tasks. |
| Hook execution model | `type: prompt` with deterministic instructions | Claude Code hooks only support `type: prompt`. The prompt instructs the model to follow exact procedural steps with no creative reasoning. The model acts as a script executor reading files and applying rules. |
| State file format | Markdown with YAML frontmatter (`.agent/controller-state.md`) | Consistent with all other `.agent/` files. Human-readable. Editable for manual recovery. |
| Default mode | `semi-auto` | Balances automation with user oversight. Auto-advances stages but asks before spawning agents. User can switch to `manual` or `full-auto` at any time. |

---

## Hook Chain

The controller operates through three hooks. Each hook uses `type: prompt` with a model that executes deterministic instructions.

### hooks.json

```json
{
  "description": "Team pipeline controller hooks",
  "hooks": {
    "SubagentStop": [
      {
        "hooks": [
          {
            "type": "prompt",
            "prompt": "You are the pipeline controller. Follow these steps EXACTLY with no deviation.\n\n1. EXTRACT TASK ID\n   - The agent that just completed had this prompt context. Find the task path matching `.agent/tasks/TASK-\\d+.md` in the prompt.\n   - If no task path found, log 'SubagentStop: no task path in agent prompt' and STOP.\n   - Read the task file at that path.\n\n2. READ CONTROLLER STATE\n   - Read `.agent/controller-state.md` frontmatter.\n   - Read `.agent/config.md` frontmatter (for `stage_assignments` and `max_iterations`).\n   - Note the current `mode` from controller state.\n\n3. DETECT CRASH\n   - If the task's `status` is still `in_progress`, the agent crashed without updating status.\n   - Set `status: error` in the task file.\n   - Append to task log: `- [{timestamp}] controller: Agent crashed (status unchanged after completion)`\n   - Remove the task from `active_agents` in controller state.\n   - Notify the user: 'Task {id} agent crashed. Run /task advance {id} to retry or /task cancel {id}.'\n   - STOP.\n\n4. REMOVE FROM ACTIVE AGENTS\n   - Remove the entry for this task from `active_agents` in controller state.\n   - Update `last_event` to `{type: agent_complete, task: TASK-XXX, timestamp: now}`.\n   - Write updated controller state.\n\n5. CHECK DEPENDENCIES\n   - Read the task's `depends_on` list.\n   - For each dependency, read its task file and check if `stage: completed`.\n   - If any dependency is NOT completed, add the task to `queue` with `waiting_on: [unfinished deps]`. Write controller state. Notify user: 'Task {id} waiting on dependencies: {list}'. STOP.\n\n6. APPLY TRANSITION RULES (mode-aware)\n   - Read task `stage` and `status`.\n   - Determine `next_stage` and `next_role` using the transition table:\n     - (planning, ready) -> implementing\n     - (implementing, ready) -> reviewing\n     - (reviewing, passed) -> completed\n     - (reviewing, failed) -> check iterations vs max_iterations. If >= max, set BLOCKED and STOP. Else -> fixing\n     - (fixing, ready) -> reviewing\n     - (researching, done) -> finalize (no next stage)\n   - Look up `next_role` from `stage_assignments` in config.md.\n\n7. MODE BEHAVIOR\n   - If `mode: manual`: Notify user: 'Task {id} is ready to advance to {next_stage}. Run /task advance {id}.' STOP.\n   - If `mode: semi-auto`: Update the task file (set new stage, status: in_progress, assignee). Ask user: 'Task {id} advanced to {next_stage}. Spawn {next_role} agent? [y/n]'\n   - If `mode: full-auto`: Update the task file. Resolve agent from `.agent/roles/{next_role}.md` (fallback: `agents/{next_role}.md`). Check `max_parallel` -- if active_agents count >= max_parallel, add to queue instead. Otherwise spawn the agent and add to `active_agents`.\n\n8. PROCESS QUEUE\n   - If `mode: full-auto` and `active_agents` count < `max_parallel`:\n     - Dequeue the first entry from `queue` where `waiting_on` is empty.\n     - Apply transition for that task (spawn agent, add to active_agents).\n     - Repeat until queue is empty or max_parallel reached.\n   - Write updated controller state.\n\n9. COMPLETION HANDLING\n   - If next_stage was `completed`: move task file to `.agent/tasks/archive/`. If mode is full-auto, spawn researcher. If semi-auto, ask user about researcher.\n   - If the completed task is in any other task's `depends_on`, re-evaluate those tasks (remove from waiting_on, dequeue if ready).\n\n10. UPDATE TASK FILE\n    - Set `updated` timestamp.\n    - Append to log: `- [{timestamp}] controller: Advanced to {next_stage} (mode: {mode})`\n    - Write task file.",
            "model": "sonnet"
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "prompt",
            "prompt": "You are the pipeline controller performing session recovery. Follow these steps EXACTLY.\n\n1. Check if `.agent/controller-state.md` exists. If not, STOP (no pipeline initialized).\n2. Read `.agent/controller-state.md` frontmatter.\n3. Check `active_agents` list. These are agents that were running when the last session ended.\n4. For each entry in `active_agents`:\n   a. Read the task file at `.agent/tasks/{task-id}.md`.\n   b. Check its `status`:\n      - If `status: ready` or `status: passed` or `status: failed` or `status: done`: The agent finished but the controller did not process the result. Flag: 'Task {id} completed during last session but was not advanced.'\n      - If `status: in_progress`: The agent was interrupted mid-work. Flag: 'Task {id} was in progress when session ended (stage: {stage}, role: {role}).'\n      - If `status: error`: Already marked as crashed. Flag: 'Task {id} has error status from previous session.'\n5. If any flagged tasks exist, present a summary table to the user:\n   ```\n   Stale tasks from previous session:\n   TASK-004  implementing  in_progress  (was: implementer)  -> Retry / Skip / Cancel\n   TASK-005  reviewing     ready        (was: reviewer)     -> Advance / Skip / Cancel\n   ```\n   Ask the user what to do with each.\n6. Clear `active_agents` in controller state (since no agents survive session restart).\n7. Check `queue` for any waiting tasks and report them.\n8. Write updated controller state.\n9. Report controller mode and status: 'Controller mode: {mode}. {n} queued tasks. Ready.'",
            "model": "haiku"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "prompt",
            "prompt": "You are the pipeline controller performing session shutdown summary. Follow these steps EXACTLY.\n\n1. Check if `.agent/controller-state.md` exists. If not, check `.agent/tasks/` for any tasks with status ready/passed/failed needing advancement. Report and STOP.\n2. Read `.agent/controller-state.md` frontmatter.\n3. Display controller state summary:\n   ```\n   Pipeline Controller Summary\n   Mode: {mode} | Paused: {paused}\n   Active agents: {count}\n   {for each: TASK-XXX  stage  role  started}\n   Queued tasks: {count}\n   {for each: TASK-XXX  next_stage  waiting_since  waiting_on}\n   ```\n4. Read all task files in `.agent/tasks/`. For each with actionable status:\n   - `status: ready` -> 'TASK-XXX ready to advance from {stage}'\n   - `status: passed` -> 'TASK-XXX review passed, ready to complete'\n   - `status: failed` -> 'TASK-XXX review failed, needs fixing'\n   - `status: error` -> 'TASK-XXX has error, needs attention'\n   - `status: BLOCKED` -> 'TASK-XXX is BLOCKED after max iterations'\n5. If any actionable tasks and mode is manual, remind: 'Run /task advance TASK-XXX or /task controller mode semi-auto to enable auto-advancement.'\n6. Report last event from controller state.",
            "model": "haiku"
          }
        ]
      }
    ]
  }
}
```

### Hook Specification Summary

| Hook | Trigger | Model | Purpose |
|------|---------|-------|---------|
| `SubagentStop` | Any subagent completes | sonnet | Main automation: extract task, detect crash, apply transitions, manage queue |
| `SessionStart` | New session begins | haiku | Detect stale tasks from previous session, offer recovery options |
| `Stop` | Session ending | haiku | Display controller state summary, flag actionable tasks |

### Why sonnet for SubagentStop

The `SubagentStop` hook is the most critical path. It must read multiple files, apply conditional logic, and potentially spawn agents. `sonnet` provides reliable instruction-following at reasonable cost. `haiku` is sufficient for the simpler `SessionStart` and `Stop` hooks which only read and report.

---

## State File Schema

**File:** `.agent/controller-state.md`

```yaml
---
mode: semi-auto
max_parallel: 3
active_agents:
  - task: TASK-004
    role: implementer
    started: 2026-02-10T14:00:00Z
    agent_id: agent-abc123
  - task: TASK-005
    role: planner
    started: 2026-02-10T14:05:00Z
    agent_id: agent-def456
queue:
  - task: TASK-006
    next_stage: implementing
    waiting_since: 2026-02-10T14:10:00Z
    depends_on: []
    waiting_on: []
  - task: TASK-007
    next_stage: implementing
    waiting_since: 2026-02-10T14:12:00Z
    depends_on: [TASK-006]
    waiting_on: [TASK-006]
last_event:
  type: agent_complete
  task: TASK-003
  timestamp: 2026-02-10T14:08:00Z
paused: false
---

# Controller State

This file is managed by the pipeline controller. Do not edit manually unless performing recovery.
```

### Field Reference

| Field | Type | Valid Values | Default | Description |
|-------|------|-------------|---------|-------------|
| `mode` | string | `manual`, `semi-auto`, `full-auto` | `semi-auto` | Operating mode governing automation level |
| `max_parallel` | integer | 1-10 | 3 | Maximum concurrent active agents |
| `active_agents` | list | -- | `[]` | Agents currently running |
| `active_agents[].task` | string | `TASK-\d+` | -- | Task ID the agent is working on |
| `active_agents[].role` | string | role name | -- | Role name (matches `.agent/roles/{role}.md`) |
| `active_agents[].started` | datetime | ISO 8601 | -- | When the agent was spawned |
| `active_agents[].agent_id` | string | opaque ID | -- | Claude Code agent identifier for tracking |
| `queue` | list | -- | `[]` | Tasks waiting to be processed, ordered FIFO |
| `queue[].task` | string | `TASK-\d+` | -- | Task ID |
| `queue[].next_stage` | string | pipeline stage | -- | Stage the task will advance to |
| `queue[].waiting_since` | datetime | ISO 8601 | -- | When the task entered the queue |
| `queue[].depends_on` | list[string] | `TASK-\d+` | `[]` | Original dependency list from task file |
| `queue[].waiting_on` | list[string] | `TASK-\d+` | `[]` | Subset of `depends_on` not yet completed |
| `last_event` | object | -- | `null` | Most recent controller event |
| `last_event.type` | string | `agent_complete`, `agent_crash`, `task_queued`, `task_advanced`, `task_blocked`, `dependency_resolved`, `mode_change` | -- | Event type |
| `last_event.task` | string | `TASK-\d+` | -- | Associated task |
| `last_event.timestamp` | datetime | ISO 8601 | -- | When the event occurred |
| `paused` | boolean | `true`, `false` | `false` | When true, controller notifies but does not advance or spawn |

### Update Rules

| Event | Fields Updated |
|-------|---------------|
| Agent spawned | Add to `active_agents`, remove from `queue` if present, update `last_event` |
| Agent completes | Remove from `active_agents`, update `last_event` |
| Task queued | Add to `queue`, update `last_event` |
| Dependency resolved | Remove dep from `waiting_on` in all queue entries, update `last_event` |
| Mode change | Update `mode`, update `last_event` |
| Pause/resume | Update `paused`, update `last_event` |
| Session start | Clear `active_agents` (agents do not survive session restart) |

---

## Mode Behavior Matrix

Truth table showing exact actions for each event in each mode.

### Legend

- **Notify** = inform the user in chat
- **Advance** = update task file (stage, status, assignee, timestamps, log)
- **Spawn** = resolve role from config.md + roles/, create subagent
- **Queue** = add to controller state queue
- **Ask** = prompt user for confirmation before proceeding
- **--** = no action

### Matrix

| Event | manual | semi-auto | full-auto |
|-------|--------|-----------|-----------|
| Agent completes, status: ready | Notify ("ready to advance") | Advance + Ask ("spawn {role}?") | Advance + Spawn (or Queue if at max_parallel) |
| Agent completes, status: passed | Notify ("review passed") | Advance to completed + Ask ("spawn researcher?") | Advance to completed + Spawn researcher |
| Agent completes, status: failed, iterations < max | Notify ("review failed") | Advance to fixing + Ask ("spawn {role}?") | Advance to fixing + Spawn (or Queue) |
| Agent completes, status: failed, iterations >= max | Notify ("BLOCKED") | Advance to BLOCKED + Notify | Advance to BLOCKED + Notify |
| Agent crash (status unchanged) | Set error + Notify | Set error + Notify | Set error + Notify |
| Queue has waiting tasks, slot available | -- | Notify ("queued task ready") | Dequeue + Spawn |
| Dependency resolved | Notify ("dep satisfied") | Update waiting_on + Ask if ready to advance | Update waiting_on + Dequeue + Spawn if no remaining deps |
| Controller paused | Notify only (all events) | Notify only (all events) | Notify only (all events) |

### Mode Transition Behavior

Changing mode takes effect immediately for the next event. Tasks already in progress are not affected. Queued tasks are re-evaluated under the new mode only when the next event fires.

---

## Transition Rules

The complete state machine, derived from `/task advance` logic with mode awareness added.

### State Machine Diagram

```
                    +----------+
                    | planning |
                    | (ready)  |
                    +----+-----+
                         |
                         v
                  +--------------+
                  | implementing |
                  | (ready)      |
                  +------+-------+
                         |
                         v
                  +-------------+
             +--->| reviewing   |<---+
             |    | (passed)    |    |
             |    | (failed)    |    |
             |    +--+------+--+    |
             |       |      |      |
             |  passed|      |failed (iterations < max)
             |       |      |      |
             |       v      v      |
             |  completed  fixing--+
             |  (done)     (ready)
             |       |
             |       v
             |  researching
             |  (done) -> finalize
             |
             +-- failed (iterations >= max) -> BLOCKED
```

### Pseudocode

```
on agent_complete(task_id):
  task = read_task_file(task_id)
  config = read_config()
  state = read_controller_state()

  # Remove from active agents
  state.active_agents.remove(task_id)

  # Crash detection
  if task.status == "in_progress":
    task.status = "error"
    task.log.append("[{now}] controller: Agent crashed (status unchanged)")
    write_task(task)
    write_state(state)
    notify_user("Task {task_id} agent crashed. Status set to error.")
    return

  # Dependency check
  for dep in task.depends_on:
    dep_task = read_task_file(dep)
    if dep_task.stage != "completed":
      state.queue.append({
        task: task_id,
        next_stage: compute_next_stage(task),
        waiting_since: now,
        depends_on: task.depends_on,
        waiting_on: [unfinished deps]
      })
      write_state(state)
      notify_user("Task {task_id} waiting on: {unfinished deps}")
      return

  # Compute transition
  match (task.stage, task.status):

    case ("planning", "ready"):
      next_stage = "implementing"
      next_role = config.stage_assignments.implementing

    case ("implementing", "ready"):
      next_stage = "reviewing"
      next_role = config.stage_assignments.reviewing

    case ("reviewing", "passed"):
      next_stage = "completed"
      next_role = config.stage_assignments.researching  # for post-completion

    case ("reviewing", "failed"):
      task.iterations += 1
      if task.iterations >= config.max_iterations:
        task.stage = "BLOCKED"
        task.status = "BLOCKED"
        task.log.append("[{now}] controller: BLOCKED after {iterations} iterations")
        write_task(task)
        write_state(state)
        notify_user("Task {task_id} BLOCKED after {iterations} failed reviews.")
        return
      next_stage = "fixing"
      next_role = config.stage_assignments.fixing

    case ("fixing", "ready"):
      next_stage = "reviewing"
      next_role = config.stage_assignments.reviewing

    case ("researching", "done"):
      task.log.append("[{now}] controller: Research complete. Task finalized.")
      write_task(task)
      write_state(state)
      notify_user("Task {task_id} research complete. Pipeline finished.")
      return

    case _:
      notify_user("Task {task_id} has unexpected stage/status: {stage}/{status}")
      return

  # Apply mode behavior
  match state.mode:

    case "manual":
      notify_user("Task {task_id} ready to advance to {next_stage}. Run /task advance {task_id}.")

    case "semi-auto":
      apply_advance(task, next_stage, next_role)
      if next_stage == "completed":
        archive_task(task)
        ask_user("Task {task_id} completed. Spawn {researcher_role} for knowledge extraction? [y/n]")
      else:
        ask_user("Task {task_id} advanced to {next_stage}. Spawn {next_role}? [y/n]")

    case "full-auto":
      apply_advance(task, next_stage, next_role)
      if next_stage == "completed":
        archive_task(task)
        next_role = config.stage_assignments.researching
        # Researcher is spawned even in auto mode
      if state.active_agents.count >= state.max_parallel:
        state.queue.append({task: task_id, next_stage: next_stage, ...})
        notify_user("Task {task_id} queued (max_parallel reached).")
      else:
        agent = resolve_role(next_role)
        spawn_agent(agent, task)
        state.active_agents.append({task: task_id, role: next_role, started: now})

  # Process queue (full-auto only)
  if state.mode == "full-auto":
    process_queue(state, config)

  write_state(state)


fn apply_advance(task, next_stage, next_role):
  task.stage = next_stage
  task.status = "in_progress"
  task.assignee = next_role
  task.updated = now
  task.log.append("[{now}] controller: Advanced to {next_stage} (mode: {mode})")
  if next_stage == "fixing":
    # Save review report before advancing
    save_review_report(task)
  write_task(task)


fn process_queue(state, config):
  while state.active_agents.count < state.max_parallel and state.queue is not empty:
    entry = state.queue.find_first(where: waiting_on is empty)
    if entry is null:
      break
    state.queue.remove(entry)
    task = read_task_file(entry.task)
    role = config.stage_assignments[entry.next_stage]
    agent = resolve_role(role)
    spawn_agent(agent, task)
    state.active_agents.append({task: entry.task, role: role, started: now})


fn on_task_completed(task_id):
  # Re-evaluate waiting tasks when a task completes
  state = read_controller_state()
  for entry in state.queue:
    if task_id in entry.waiting_on:
      entry.waiting_on.remove(task_id)
  write_state(state)
  if state.mode == "full-auto":
    process_queue(state, config)
```

---

## Command Interface

The `/task controller` subcommand provides inspection and control of the orchestration layer.

### Subcommands

| Subcommand | Description |
|------------|-------------|
| `/task controller status` | Show active agents, queue, mode, last event |
| `/task controller mode <mode>` | Switch operating mode |
| `/task controller pause` | Pause auto-advancement (notify-only) |
| `/task controller resume` | Resume auto-advancement |

### `/task controller status`

Reads `.agent/controller-state.md` and displays current state.

```
Pipeline Controller Status
===========================
Mode:   semi-auto
Paused: no

Active Agents (2/3):
  TASK-004  implementing  coder         started 14:00
  TASK-005  planning      planner       started 14:05

Queue (2):
  TASK-006  -> implementing  waiting since 14:10  (ready)
  TASK-007  -> implementing  waiting since 14:12  (waiting on: TASK-006)

Last Event: agent_complete TASK-003 at 14:08
```

### `/task controller mode <mode>`

Changes the operating mode. Takes effect on the next event.

```
> /task controller mode full-auto

Controller mode changed: semi-auto -> full-auto
Effective immediately for next events.
Note: 2 queued tasks will auto-spawn when agent slots become available.
```

```
> /task controller mode manual

Controller mode changed: full-auto -> manual
Auto-advancement disabled. Use /task advance to progress tasks.
```

### `/task controller pause`

Suspends all automatic actions. The controller still processes events and updates state but does not advance tasks or spawn agents. All events produce notifications only.

```
> /task controller pause

Controller paused. All events will produce notifications only.
Active agents will finish their current work.
Run /task controller resume to re-enable automation.
```

### `/task controller resume`

Resumes normal operation under the current mode. Re-evaluates the queue immediately.

```
> /task controller resume

Controller resumed (mode: semi-auto).
Queue: 1 task ready to advance.
  TASK-006 -> implementing. Spawn coder? [y/n]
```

### Integration with `/task` Command

The `/task` command entry point (`commands/task.md`) is extended to route `controller` subcommands:

```
### `/task controller [status|mode|pause|resume]`

1. Parse the subcommand from `$ARGUMENTS`.
2. Read `.agent/controller-state.md`.
3. Execute the requested action:
   - `status`: Display state summary (see format above).
   - `mode <m>`: Validate mode is one of manual|semi-auto|full-auto. Update `mode` field. Update `last_event`. Write state file.
   - `pause`: Set `paused: true`. Update `last_event`. Write state file.
   - `resume`: Set `paused: false`. Update `last_event`. Write state file. If mode is full-auto, run process_queue.
4. If no subcommand, default to `status`.
```

---

## Dependency Enforcement

### How `depends_on` Works

Tasks declare dependencies in their frontmatter:

```yaml
---
id: TASK-007
depends_on: [TASK-005, TASK-006]
stage: planning
status: ready
---
```

### Enforcement Flow

```
Task TASK-007 agent completes (stage: planning, status: ready)
  |
  Controller reads depends_on: [TASK-005, TASK-006]
  |
  Check TASK-005 -> stage: completed         OK
  Check TASK-006 -> stage: implementing      NOT completed
  |
  Controller queues TASK-007:
    queue entry: {
      task: TASK-007,
      next_stage: implementing,
      waiting_since: now,
      depends_on: [TASK-005, TASK-006],
      waiting_on: [TASK-006]
    }
  |
  Notify user: "TASK-007 waiting on dependencies: TASK-006"
  |
  ... later, TASK-006 completes ...
  |
  Controller calls on_task_completed(TASK-006)
    -> Scans queue, finds TASK-007.waiting_on contains TASK-006
    -> Removes TASK-006 from waiting_on
    -> waiting_on is now empty -> TASK-007 is eligible for dequeue
  |
  In full-auto mode: process_queue spawns agent for TASK-007
  In semi-auto mode: ask user "TASK-007 dependencies satisfied. Spawn coder? [y/n]"
  In manual mode: notify "TASK-007 dependencies satisfied. Run /task advance TASK-007"
```

### Dependency Rules

| Rule | Behavior |
|------|----------|
| Dependency check timing | After agent completes, before advancing to next stage |
| What counts as "completed" | `stage: completed` in the dependency's task file |
| Circular dependencies | Not validated by controller. Detected at task creation time by `task-create` skill. |
| Cancelled dependency | Treated as not completed. User must either complete the dep, remove it from `depends_on`, or cancel the waiting task. |
| Dependency in BLOCKED state | Same as cancelled -- not completed. Controller notifies user of the blockage. |

---

## Error Recovery

### Agent Crash

An agent crash is detected when `SubagentStop` fires but the task's `status` field is still `in_progress` (the agent did not update it before stopping).

```
SubagentStop fires for TASK-004
  |
  Read TASK-004.md -> status: in_progress (unchanged)
  |
  Diagnosis: agent crashed or hit maxTurns without completing
  |
  Actions:
    1. Set task status: error
    2. Remove from active_agents
    3. Append to log: "[{time}] controller: Agent crashed (status unchanged after completion)"
    4. Update last_event: {type: agent_crash, task: TASK-004}
    5. Notify user: "TASK-004 agent crashed during {stage}. Options:
       - /task advance TASK-004  (retry with same role)
       - /task cancel TASK-004   (abandon task)
       - /task complete TASK-004 (force-complete, skip remaining stages)"
```

### Session Interruption

When a session ends (user closes terminal, network drop), all active agents are terminated. On next `SessionStart`, the controller detects these stale tasks.

```
SessionStart fires
  |
  Read controller-state.md -> active_agents has 2 entries
  |
  For each active agent:
    Read task file, check status
    |
    TASK-004: status: ready     -> Agent finished but wasn't processed
    TASK-005: status: in_progress -> Agent was interrupted
  |
  Clear active_agents (no agents survive session restart)
  |
  Present recovery table:
    Stale tasks from previous session:
    +---------+--------------+-------------+---------------+--------------------+
    | Task    | Stage        | Status      | Was Role      | Options            |
    +---------+--------------+-------------+---------------+--------------------+
    | TASK-004| implementing | ready       | coder         | Advance / Cancel   |
    | TASK-005| reviewing    | in_progress | code-reviewer | Retry / Cancel     |
    +---------+--------------+-------------+---------------+--------------------+
  |
  User chooses per task
```

### BLOCKED Tasks

A task becomes BLOCKED when `iterations >= max_iterations` (from `.agent/config.md`). The controller does not automatically recover BLOCKED tasks.

```
Reviewing -> failed, iterations = 3, max_iterations = 3
  |
  Controller sets:
    stage: BLOCKED
    status: BLOCKED
  |
  Appends to log: "[{time}] controller: BLOCKED after 3 failed review iterations"
  |
  Notify user: "TASK-004 is BLOCKED after 3 review cycles. Options:
    - /task advance TASK-004  (reset iterations, retry fixing)
    - /task complete TASK-004 (force-complete as-is)
    - /task cancel TASK-004   (abandon)"
```

Recovery from BLOCKED requires explicit user action via `/task advance` (which resets iterations to 0 and re-enters the fixing stage) or `/task complete`/`/task cancel`.

### Queue Overflow

When more tasks need agents than `max_parallel` allows, excess tasks enter the queue.

```
max_parallel: 3, active_agents: 3
  |
  TASK-008 ready to advance -> cannot spawn
  |
  Controller adds to queue:
    {task: TASK-008, next_stage: implementing, waiting_since: now}
  |
  Notify user: "TASK-008 queued for implementing (3/3 agent slots in use)."
  |
  When any active agent completes -> process_queue dequeues TASK-008
```

Queue ordering is strictly FIFO. Tasks with unsatisfied dependencies (`waiting_on` not empty) are skipped during dequeue.

---

## Integration with Roles

The controller resolves agents through the roles system defined in `docs/designs/roles-design.md`. It never reads role templates directly -- only project-level instances.

### Resolution Flow

```
Controller needs to spawn agent for stage "implementing":
  |
  1. Read .agent/config.md -> stage_assignments.implementing = "coder"
  |
  2. Resolve role file (precedence from roles-design.md):
     a. .agent/roles/coder.md        # Project instance (highest priority)
     b. roles/templates/coder.md     # Plugin template
     c. agents/coder.md              # Legacy fallback
     NOTE: if .agent/roles/ exists and has files, ONLY (a) is used
  |
  3. Read role frontmatter -> model, maxTurns, tools, disallowedTools, etc.
  |
  4. Construct agent spawn command with:
     - Role frontmatter fields
     - Task-specific prompt: "Work on task at .agent/tasks/TASK-XXX.md..."
     - Knowledge bindings from role's knowledge field
  |
  5. Spawn agent
```

### What the Controller Reads

| Source | Field | Purpose |
|--------|-------|---------|
| `.agent/config.md` | `stage_assignments` | Maps stage name to role name |
| `.agent/config.md` | `max_iterations` | Determines BLOCKED threshold |
| `.agent/roles/{role}.md` | all frontmatter | Agent configuration for spawning |
| `.agent/roles/{role}.md` | `pipeline_stages` | Validated against requested stage (sanity check) |
| `.agent/controller-state.md` | all fields | Controller runtime state |
| `.agent/tasks/{id}.md` | `stage`, `status`, `iterations`, `depends_on` | Task state for transition logic |

### What the Controller Does NOT Read

| Source | Reason |
|--------|--------|
| `roles/templates/*.md` | Template management is `init-roles`' domain |
| `agents/*.md` | Only used as fallback when `.agent/roles/` does not exist |
| Role `inherits` field | Inheritance is resolved at instantiation time by `init-roles`, not at runtime |

### Fallback Behavior

When `.agent/roles/` does not exist (project has not run `init-roles`), the controller falls back to the hardcoded stage-to-agent map:

```
planning     -> agents/planner.md
implementing -> agents/implementer.md
reviewing    -> agents/reviewer.md
fixing       -> agents/implementer.md
researching  -> agents/researcher.md
```

This preserves backward compatibility with projects that use the original agent definitions without the roles system.

---

## Controller Initialization

The controller state file is created by the `task-init` skill alongside other `.agent/` files. Default state:

```yaml
---
mode: semi-auto
max_parallel: 3
active_agents: []
queue: []
last_event: null
paused: false
---

# Controller State

This file is managed by the pipeline controller. Do not edit manually unless performing recovery.
```

If `.agent/controller-state.md` does not exist when a hook fires, the hook skips controller logic and falls back to the existing behavior (notify user about task status, suggest `/task advance`).
