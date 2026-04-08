# Hooks Schema

Formal schema definitions for hook rule configuration, event input contexts, and output action objects.

## Hook Rule Schema

```json
{
  "id": "string (required) — unique identifier, kebab-case",
  "event": "string (required) — one of: PreToolUse, PostToolUse, SubagentStop, StageTransition, TaskCompleted, InstructionsLoaded",
  "matcher": {
    "tools": "string[] (optional) — tool names; omit to match all; ['*'] matches all explicitly",
    "roles": "string[] (optional) — role names; omit to match all",
    "stages": "string[] (optional) — stage names; omit to match all",
    "tags": "string[] (optional) — task tag values; omit to match all",
    "tasks": "string[] (optional) — specific task IDs; omit to match all",
    "from": "string (optional, StageTransition only) — source stage",
    "to": "string (optional, StageTransition only) — target stage"
  },
  "action": "string (required) — one of: block, check, notify, log, inject, skip",
  "mode": "string (required) — one of: enforce, advisory, always",
  "enabled": "boolean (required) — false disables the hook without removing it",
  "description": "string (optional) — human-readable purpose",
  "message": "string (optional) — for notify action: message template",
  "content": "string (optional) — for inject action: content to add to agent prompt",
  "checks": "array (optional) — for check action: list of validation checks",
  "command": "string (optional) — for check action (shorthand for single command check)"
}
```

### Check Object Schema

```json
{
  "type": "string — 'command' (only type supported currently)",
  "command": "string — shell command to run; supports {{build_command}} and {{test_command}} templates",
  "expect": "string — 'exit_0' (command must exit with code 0)"
}
```

## PreToolUse Input Context

```json
{
  "event": "PreToolUse",
  "tool": "string — tool name (Write, Edit, Read, Glob, Grep, Bash, ...)",
  "parameters": {
    "file_path": "string (optional) — for file-based tools",
    "command": "string (optional) — for Bash tool",
    "pattern": "string (optional) — for Glob/Grep"
  },
  "agent": {
    "role": "string",
    "task_id": "string",
    "stage": "string"
  },
  "working_folders": {
    "resolved": "string[] — absolute paths of declared working folders",
    "packages": "string[] — package names"
  }
}
```

## PreToolUse Output Actions

```json
{
  "injected_instructions": "string — text to append to agent prompt",
  "hook_ids_applied": "string[] — IDs of hooks that contributed to this injection"
}
```

## PostToolUse Input Context

```json
{
  "event": "PostToolUse",
  "tool": "string",
  "parameters": {
    "file_path": "string (optional)"
  },
  "result": "string — 'success' or 'error'",
  "agent": {
    "role": "string",
    "task_id": "string",
    "stage": "string"
  }
}
```

## PostToolUse Output Actions

```json
{
  "injected_instructions": "string",
  "hook_ids_applied": "string[]"
}
```

## SubagentStop Input Context

```json
{
  "event": "SubagentStop",
  "agent": {
    "role": "string",
    "task_id": "string",
    "stage": "string",
    "model": "string",
    "started_at": "string (ISO timestamp)",
    "completed_at": "string (ISO timestamp)"
  },
  "task": {
    "id": "string",
    "status": "string — final status set by the agent",
    "stage": "string",
    "iteration": "number",
    "adventure_id": "string (optional)",
    "tags": "string[]"
  }
}
```

## SubagentStop Output Actions

```json
{
  "actions_taken": [
    {
      "hook_id": "string",
      "action": "string",
      "result": "string — 'metrics_recorded', 'notification_queued', 'check_passed', 'check_failed'"
    }
  ],
  "blocked": "boolean — true if any enforce-mode check failed",
  "notifications": "string[] — channel names queued for notification"
}
```

## StageTransition Input Context

```json
{
  "event": "StageTransition",
  "task": {
    "id": "string",
    "title": "string",
    "current_stage": "string",
    "proposed_stage": "string",
    "iteration": "number",
    "adventure_id": "string (optional)"
  },
  "transition": {
    "from": "string",
    "to": "string",
    "reason": "string — why the transition is being proposed"
  },
  "config": {
    "test_command": "string",
    "build_command": "string",
    "max_iterations": "number"
  }
}
```

## StageTransition Output Actions

```json
{
  "transition_allowed": "boolean",
  "checks_passed": [
    { "hook_id": "string", "check": "string", "result": "pass" }
  ],
  "checks_failed": [
    { "hook_id": "string", "check": "string", "result": "fail", "output": "string" }
  ],
  "notifications_queued": "string[] — channel names"
}
```

## TaskCompleted Input Context

```json
{
  "event": "TaskCompleted",
  "task": {
    "id": "string",
    "title": "string",
    "adventure_id": "string (optional)",
    "tags": "string[]",
    "iterations": "number",
    "files": "string[]"
  },
  "adventure": {
    "id": "string (optional)",
    "total_tasks": "number",
    "completed_tasks": "number",
    "remaining_tasks": "number"
  },
  "metrics": {
    "total_duration_min": "number",
    "agents_used": "string[]"
  }
}
```

## TaskCompleted Output Actions

```json
{
  "actions_taken": [
    {
      "hook_id": "string",
      "action": "string",
      "result": "string"
    }
  ],
  "notifications_sent": "string[] — channel names",
  "adventure_complete": "boolean (optional)"
}
```

## InstructionsLoaded Input Context

```json
{
  "event": "InstructionsLoaded",
  "agent": {
    "role": "string",
    "task_id": "string",
    "stage": "string",
    "model": "string"
  },
  "instructions": {
    "role_template": "string — path to role template",
    "knowledge_files": "string[] — knowledge files being loaded",
    "skill_files": "string[] — skill files being loaded"
  }
}
```

## InstructionsLoaded Output Actions

```json
{
  "injections": [
    {
      "hook_id": "string",
      "content": "string — text injected into agent prompt"
    }
  ]
}
```

## Valid Event-Action Combinations

| Event | block | check | notify | log | inject | skip |
|-------|-------|-------|--------|-----|--------|------|
| PreToolUse | ✓ | — | — | ✓ | ✓ | ✓ |
| PostToolUse | — | — | ✓ | ✓ | ✓ | ✓ |
| SubagentStop | — | ✓ | ✓ | ✓ | — | ✓ |
| StageTransition | ✓ | ✓ | ✓ | ✓ | — | ✓ |
| TaskCompleted | — | ✓ | ✓ | ✓ | — | ✓ |
| InstructionsLoaded | — | — | — | ✓ | ✓ | ✓ |

## Valid Mode Values Per Action

| Action | enforce | advisory | always |
|--------|---------|----------|--------|
| block | ✓ | — | — |
| check | ✓ | ✓ | — |
| notify | — | ✓ | ✓ |
| log | — | — | ✓ |
| inject | — | — | ✓ |
| skip | ✓ | ✓ | ✓ |
