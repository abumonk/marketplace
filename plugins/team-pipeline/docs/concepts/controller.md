# Controller

> System-level orchestration layer that launches, monitors, and manages agents across the pipeline.

## Problem

The pipeline currently requires manual orchestration. The user runs `/task advance TASK-XXX` after each stage completes. There is no automation for:

- Detecting when an agent finishes work
- Advancing tasks to the next stage
- Spawning the correct agent for the next stage
- Managing multiple concurrent tasks
- Handling timeouts or stuck agents
- Enforcing resource limits (max parallel agents)

This works for single-task workflows but breaks down with multiple tasks, long-running pipelines, or when the user is not actively monitoring the session.

## Concept

The controller is **not an agent**. It is infrastructure -- a coordination layer built from hooks and a state-management skill. It has no LLM reasoning of its own. It follows deterministic rules to advance the pipeline state machine.

### Mechanism

Claude Code has no persistent background processes. The controller operates **event-driven** through hooks:

1. **SubagentStop hook** -- Fires when any spawned agent completes. The hook reads the task file the agent was working on, checks the updated `status`, and invokes the controller logic.
2. **SessionStart hook** -- On session start, checks for stale tasks (agents that were running when the last session ended) and prompts recovery.
3. **Stop hook** -- (Existing) Reminds user about tasks needing attention. Enhanced to show controller state.

### Controller Logic (deterministic, no LLM)

```
on agent_complete(task_id):
  read task file
  match (stage, status):
    (planning, ready)       -> set implementing, spawn implementer
    (implementing, ready)   -> set reviewing, spawn reviewer
    (reviewing, passed)     -> set completed, archive, spawn researcher
    (reviewing, failed)     -> check iterations, set fixing or BLOCKED
    (fixing, ready)         -> set reviewing, spawn reviewer
    (researching, done)     -> finalize
  update timestamps
  append to log
  notify messenger
```

This is the same logic currently in `/task advance` but triggered automatically.

### State File

`.agent/controller-state.md`:

```yaml
---
mode: semi-auto
max_parallel: 3
active_agents:
  - task: TASK-004
    role: implementer
    started: 2026-02-10T14:00:00Z
    pid: agent-abc123
  - task: TASK-005
    role: planner
    started: 2026-02-10T14:05:00Z
    pid: agent-def456
queue:
  - task: TASK-006
    next_stage: implementing
    waiting_since: 2026-02-10T14:10:00Z
---
```

### Operating Modes

| Mode | Behavior |
|------|----------|
| `manual` | Current behavior. Notify only. User runs `/task advance`. |
| `semi-auto` | Auto-advance stages. Ask user before spawning agents. |
| `full-auto` | Auto-advance and auto-spawn. Notify on completion/failure only. |

Default: `semi-auto`. Configurable in `.agent/config.md`.

## Relationship to Current System

The controller **subsumes** the advancement logic in `/task advance`. The command still works as a manual override, but in `semi-auto` or `full-auto` mode, the controller handles advancement automatically.

The `/task` command gains a subcommand: `/task controller [status|mode|pause|resume]` to inspect and control the orchestration layer.

The Stop hook in `hooks/hooks.json` is replaced by the controller's more capable hook chain.

## Key Abstractions

**Pipeline State Machine** -- The existing stage/status transitions, now formally owned by the controller instead of spread across the `/task` command.

**Agent Registry** -- The controller tracks which agents are running, what tasks they serve, and when they started. Sourced from `.agent/controller-state.md`.

**Task Queue** -- When `max_parallel` is reached, new tasks wait in a queue. FIFO by default, priority-overridable.

**Mode** -- Determines how much autonomy the controller has. User can switch modes mid-session.

**Recovery** -- On session start, the controller detects orphaned tasks (agents that were running when the session ended) and offers options: restart, skip, or mark as failed.

## Interaction Patterns

- **roles** -- The controller reads `.agent/roles/` to resolve which agent to spawn for a given stage. If a task has `tags: [frontend]` and a `designer` role serves `implementing` for frontend tasks, the controller routes accordingly.
- **messenger** -- Every controller action (advance, spawn, block, queue) emits an event. The messenger picks up these events and routes them to configured channels.
- **init-roles** -- After roles are initialized, the controller becomes aware of new agent types it can spawn.
- **learn** -- No direct interaction. Learn operates outside the pipeline.

## Open Questions

1. **Hook implementation** -- SubagentStop hook receives agent output. Can it reliably extract the task ID the agent was working on? Likely yes via the agent prompt which always includes the task path.
2. **Parallel task routing** -- If two tasks need `implementing` at the same time and there's one `implementer` role, does the controller serialize or clone? Likely serialize (queue).
3. **Timeout policy** -- How long before an agent is considered stuck? Configurable per-role via `maxTurns` already, but wall-clock timeout may also be needed.
4. **Error recovery** -- If an agent crashes (not just fails review), how does the controller detect and handle it? SubagentStop should still fire.
5. **Cross-task dependencies** -- Tasks can have `depends_on`. Should the controller enforce this (don't advance TASK-005 until TASK-004 completes)?

## Future Possibilities

- **Priority scheduling** -- Tasks with `priority: high` jump the queue.
- **Resource-aware routing** -- Use cheaper models (haiku) for simple tasks, reserve opus for complex ones.
- **Pipeline visualization** -- Generate a live status board (ASCII or HTML) showing all tasks and their positions.
- **Multi-session coordination** -- Controller state persists across sessions, enabling long-running pipelines that span multiple Claude Code conversations.
- **Webhook triggers** -- External systems (CI/CD, GitHub) can trigger controller actions via incoming webhooks.
