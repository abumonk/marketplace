# Lifecycle Hooks

## Problem

The lead agent manually checks tool usage during orchestration, but has no automated mechanism to enforce rules at specific pipeline events. Working folder boundaries are documented but not runtime-enforced — a subagent can write outside its declared working folders, and the violation is only detected post-hoc during review. Quality gates (run tests before advancing to review) are advisory, not enforced. Notifications require the lead to remember to dispatch them.

## Concept

A declarative hook system stored in `.agent/hooks.md` defines rules that the lead agent evaluates at specific pipeline events. Hooks are YAML-configured rules — each with an event type, matcher, action, and mode. The lead reads and applies hooks during its existing orchestration flow without any runtime dependencies or external processes.

Unlike Claude Code's imperative hooks (shell commands with exit codes), team-pipeline hooks are declarative: they describe what should happen, and the lead agent decides how to enforce them.

## Relationship to Current System

The hook system extends the lead agent's existing orchestration without replacing it:

- **Working folders** (`docs/concepts/working-folders.md`) — describes a `PreToolUse` hook conceptually (boundary enforcement), but has no implementation. The hook system *is* that implementation. The lead evaluates `PreToolUse` hooks by injecting boundary enforcement instructions into agent prompts before spawning.
- **Lead template** (`roles/templates/lead.md`) — already evaluates SubagentStop, StageTransition, and TaskCompleted events. Hook evaluation extends these existing flows without replacing them.
- **Messenger** (`.agent/messenger.md`) — hooks can trigger notifications via the messenger. The hook system specifies *when* to send (via events) rather than *where* (channels remain in messenger.md).
- **Metrics** (`.agent/metrics.md`) — `SubagentStop` and `TaskCompleted` hooks formalize the metrics recording that the lead already performs.

No new runtime dependencies. No external processes. No databases. The hooks file is a standard markdown + YAML frontmatter file, upgradeable via `reinit`.

## Key Abstractions

### Hook Rule

A single rule in `.agent/hooks.md` frontmatter. Fields:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier for this rule |
| `event` | string | Pipeline event that triggers this rule |
| `matcher` | object | Optional filter (tools, roles, stages, tags, from/to) |
| `action` | string | What to do when the rule fires |
| `mode` | string | `enforce` (blocking), `advisory` (warning), `always` (unconditional) |
| `enabled` | boolean | Whether this rule is active |
| `description` | string | Human-readable purpose |

### Supported Events

| Event | When | Evaluation Point |
|-------|------|-----------------|
| `PreToolUse` | Before agent uses a tool | Injected into agent prompt at spawn time |
| `PostToolUse` | After agent uses Write/Edit/Bash | Injected into agent prompt at spawn time |
| `SubagentStop` | Agent completes execution | Real-time, after agent returns |
| `StageTransition` | Stage advancement proposed | Real-time, before lead proposes transition |
| `TaskCompleted` | Task reaches completed stage | Real-time, after researcher finishes |
| `InstructionsLoaded` | Agent prompt assembled | Real-time, during agent spawn |

### Matcher

Optional filter fields. Omitting a field matches all values. Fields: `tools`, `roles`, `stages`, `tags`, `tasks`, `from`, `to`. Use `["*"]` to explicitly match all.

### Action Types

| Action | Description | Events |
|--------|-------------|--------|
| `block` | Prevent the operation or transition | PreToolUse, StageTransition |
| `check` | Run validation before proceeding | StageTransition, SubagentStop, TaskCompleted |
| `notify` | Send via messenger channels | All events |
| `log` | Record to metrics or task log | All events |
| `inject` | Add content to agent instructions | InstructionsLoaded, PreToolUse, PostToolUse |
| `skip` | Explicitly do nothing | All events |

### Mode

- **enforce**: The hook MUST be satisfied. Blocking hooks prevent the action unconditionally. Check hooks block if the check fails.
- **advisory**: The hook generates a recommendation. The lead may choose not to act on it.
- **always**: The hook fires regardless of other conditions (for logging and metrics).

## Interaction Patterns

### Hook Injection (InstructionsLoaded / PreToolUse / PostToolUse)

```
Lead spawns agent:
  1. Read .agent/hooks.md
  2. Find hooks: event = PreToolUse/PostToolUse/InstructionsLoaded, matcher matches role+stage
  3. Generate instruction text per action type:
     - block (PreToolUse)  → "You MUST NOT use {tools} outside: {working_folders}"
     - notify (PostToolUse) → "After every {tools} operation, run: {command}"
     - inject (InstructionsLoaded) → include hook content field verbatim
  4. Append generated instructions to spawn prompt
```

### Stage Transition Gate (StageTransition)

```
Lead proposes stage advance:
  1. Find hooks: event = StageTransition, from={current}, to={proposed}
  2. enforce + check → run command; if non-zero exit: block proposal, report failure
  3. advisory + check → run command; include result as note in proposal
  4. block          → unconditionally block proposal (e.g., maintenance window)
  5. notify         → queue for messenger dispatch
```

### Post-Agent Evaluation (SubagentStop)

```
Subagent returns:
  1. Find hooks: event = SubagentStop, matcher matches role+task
  2. log (always)   → append row to .agent/metrics.md
  3. notify         → queue notification for enabled channels
  4. check (enforce) → run validation; if fails, include as blocker in proposal
```

## Open Questions

1. Should hooks support `check` with file-based conditions (e.g., "check if file exists"), or only shell commands?
2. Should hooks have a `timeout` for `check` commands to prevent blocking the lead indefinitely?
3. Should there be a hook priority field for ordering enforcement when multiple hooks match the same event?

## Future Possibilities

- HTTP-based hook actions for external service integration (webhooks, Jira, Linear)
- Hook templates for common patterns (test-gate, lint-gate, notify-on-fail)
- Per-adventure hook overrides (different rules for different feature branches)
- Hook analytics: which hooks fire most often, how often do enforce hooks block
