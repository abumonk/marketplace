# Lifecycle Hook System — Detailed Design

## Hook Configuration Format

### File: `.agent/hooks.md`

YAML frontmatter containing an array of hook rules, with a markdown body providing documentation.

```yaml
---
version: "1.0"
hooks:
  - id: enforce-working-folders
    event: PreToolUse
    matcher:
      tools: [Write, Edit, Read, Glob, Grep]
    action: block
    mode: enforce
    description: "Block file operations outside declared working folders"
    enabled: true

  - id: log-bash-usage
    event: PreToolUse
    matcher:
      tools: [Bash]
    action: log
    mode: advisory
    description: "Log Bash usage for post-hoc review"
    enabled: true

  - id: run-lint-after-edit
    event: PostToolUse
    matcher:
      tools: [Write, Edit]
      stages: [implementing, fixing]
    action: notify
    mode: advisory
    message: "Remind agent to run lint after file modifications"
    enabled: false

  - id: quality-gate-before-review
    event: StageTransition
    matcher:
      from: implementing
      to: reviewing
    action: check
    mode: enforce
    checks:
      - type: command
        command: "{{test_command}}"
        expect: exit_0
    description: "Run tests before advancing to review"
    enabled: false

  - id: record-agent-completion
    event: SubagentStop
    matcher:
      roles: ["*"]
    action: log
    mode: always
    description: "Record agent completion metrics"
    enabled: true

  - id: adventure-completion-check
    event: TaskCompleted
    matcher:
      tags: [adventure]
    action: notify
    mode: advisory
    description: "Check if adventure is complete when an adventure task finishes"
    enabled: true

  - id: inject-hook-awareness
    event: InstructionsLoaded
    matcher:
      roles: [coder, reviewer, researcher]
    action: inject
    mode: always
    content: "Active hooks are configured in .agent/hooks.md. The lead agent enforces them."
    enabled: true
---

# Hook Configuration

This file defines lifecycle hooks for the pipeline. The lead agent evaluates
these rules during orchestration events.

## How Hooks Work

1. An event occurs (agent completes, stage transition proposed, tool use detected)
2. The lead agent reads this file and finds matching hooks
3. For each matching hook, the lead applies the specified action

## Modes

- **enforce**: Violations block the action.
- **advisory**: Generates a recommendation.
- **always**: Always fires (logging, metrics).
```

## Supported Events

### 1. PreToolUse

**When**: Before an agent uses a tool (Write, Edit, Read, Glob, Grep, Bash).

**Key design decision**: The lead cannot intercept tool calls in real-time (subagents run independently). PreToolUse hooks are **injected as instructions** into the agent's prompt before spawning. They are preventive-by-instruction, not preventive-by-interception.

**Context object**:
```json
{
  "event": "PreToolUse",
  "tool": "Write",
  "parameters": { "file_path": "/path/to/file.ts" },
  "agent": { "role": "coder", "task_id": "TASK-042", "stage": "implementing" },
  "working_folders": { "resolved": ["/project/src/", "/project/tests/"] }
}
```

**Actions**:
- `block` — Inject: "You MUST NOT use {tools} on paths outside: {resolved_folders}"
- `log` — Inject: "Log all {tools} usage in the task log"
- `skip` — No injection

### 2. PostToolUse

**When**: After an agent uses Write, Edit, or Bash.

**Key design decision**: Like PreToolUse, evaluated at spawn time by injecting instructions. The lead cannot observe individual tool calls mid-session.

**Context object**:
```json
{
  "event": "PostToolUse",
  "tool": "Write",
  "parameters": { "file_path": "/project/src/api/handler.ts" },
  "result": "success",
  "agent": { "role": "coder", "task_id": "TASK-042", "stage": "implementing" }
}
```

**Actions**:
- `notify` — Inject: "After every {tools} operation, run: {command}"
- `log` — Inject logging instructions
- `skip` — No injection

### 3. SubagentStop

**When**: After a subagent completes execution (returns control to the lead).

**Evaluation**: Real-time. The lead reads hook rules after each subagent returns and applies matching actions before proposing next steps.

**Context object**:
```json
{
  "event": "SubagentStop",
  "agent": {
    "role": "coder",
    "task_id": "TASK-042",
    "stage": "implementing",
    "started_at": "2026-03-05T14:00:00Z",
    "completed_at": "2026-03-05T14:12:00Z"
  },
  "task": {
    "id": "TASK-042",
    "status": "ready",
    "stage": "implementing",
    "iteration": 0,
    "adventure_id": "ADV-009"
  }
}
```

**Actions**:
- `log` — Record metrics to `.agent/metrics.md`
- `notify` — Send notification via messenger channels
- `check` — Run validation command before proposing advancement
- `skip` — No action

### 4. StageTransition

**When**: The lead proposes advancing a task from one stage to another.

**Evaluation**: Real-time. The lead evaluates StageTransition hooks before including the transition in its proposal. If an enforce-mode hook fails, the lead blocks the transition.

**Context object**:
```json
{
  "event": "StageTransition",
  "task": {
    "id": "TASK-042",
    "current_stage": "implementing",
    "proposed_stage": "reviewing",
    "iteration": 0
  },
  "transition": { "from": "implementing", "to": "reviewing" },
  "config": { "test_command": "npm test", "build_command": "npm run build" }
}
```

**Actions**:
- `check` (enforce) — Run command; if fails, block transition
- `check` (advisory) — Run command; if fails, include warning in proposal
- `block` — Unconditionally block transition
- `notify` — Queue notification
- `log` — Record event

### 5. TaskCompleted

**When**: A task reaches the `completed` stage (after researcher finishes).

**Context object**:
```json
{
  "event": "TaskCompleted",
  "task": {
    "id": "TASK-042",
    "adventure_id": "ADV-009",
    "tags": ["adventure", "backend"],
    "iterations": 1
  },
  "adventure": {
    "id": "ADV-009",
    "total_tasks": 6,
    "completed_tasks": 4,
    "remaining_tasks": 2
  }
}
```

**Actions**:
- `check` — Verify adventure completion status
- `notify` — Send completion notification
- `log` — Record final metrics
- `skip` — No action

### 6. InstructionsLoaded

**When**: Agent instructions are assembled before spawning a subagent.

**Evaluation**: Real-time. The lead evaluates InstructionsLoaded hooks to determine what additional context to inject. This is where PreToolUse and PostToolUse hooks are translated into agent instructions.

**Context object**:
```json
{
  "event": "InstructionsLoaded",
  "agent": { "role": "coder", "task_id": "TASK-042", "stage": "implementing" },
  "instructions": {
    "role_template": "roles/templates/coder.md",
    "knowledge_files": ["patterns.md", "decisions.md"],
    "skill_files": ["testing/SKILL.md"]
  }
}
```

**Actions**:
- `inject` — Add text to agent's prompt context
- `log` — Record what was injected
- `skip` — No injection

## Matcher Format

Each matcher field is optional; omitted fields match everything.

| Field | Type | Events | Example |
|-------|------|--------|---------|
| `tools` | `string[]` | PreToolUse, PostToolUse | `[Write, Edit]` |
| `roles` | `string[]` | All | `[coder, reviewer]` |
| `stages` | `string[]` | All | `[implementing, fixing]` |
| `tags` | `string[]` | SubagentStop, TaskCompleted | `[adventure]` |
| `tasks` | `string[]` | All | `[TASK-042]` |
| `from` | `string` | StageTransition | `implementing` |
| `to` | `string` | StageTransition | `reviewing` |

Use `["*"]` in any array field to explicitly match all values. A missing field also matches all values.

### Matching Algorithm

```
function matchHook(hook, context):
  if hook.event != context.event: return false
  if hook.enabled == false: return false
  for each matcher field in hook.matcher:
    if field value is ["*"]: continue  (matches all)
    if field value does not include context value for that field: return false
  return true
```

Multiple hooks can match the same event. They are evaluated in array order. If any enforce-mode hook blocks, the action is blocked regardless of subsequent hooks.

## Lead Agent Evaluation Flow

### During InstructionsLoaded (Before Agent Spawn)

When the lead assembles an agent's prompt:

1. Read `.agent/hooks.md`
2. Filter hooks where `event` is `PreToolUse`, `PostToolUse`, or `InstructionsLoaded` and matcher matches the agent role/stage
3. For each matching hook, generate instruction text:
   - `enforce-working-folders`: "You MUST NOT modify files outside: {resolved_folders}. If you need a file outside scope, log it and stop."
   - `log-bash-usage`: "Log all Bash commands and their purposes in the task log."
   - `run-lint-after-edit`: "After every Write/Edit, run: {lint_command}"
   - `inject` action: include the hook's `content` field verbatim
4. Append generated instructions to the agent's prompt context
5. Record applied hook IDs in lead-state under `last_event`

### During SubagentStop (After Agent Returns)

1. Read `.agent/hooks.md`
2. Filter hooks where `event` is `SubagentStop` and matcher matches
3. For each matching hook:
   - `log` action: record to metrics (already done by default; hooks formalize the rule)
   - `notify` action: queue notification for messenger dispatch
   - `check` action: run validation before proposing advancement
4. If any enforce-mode check fails, note it in the proposal as a blocker
5. Continue with standard SubagentStop evaluation (read task, propose next step)

### During StageTransition (Before Proposing Advancement)

1. Read `.agent/hooks.md`
2. Filter hooks where `event` is `StageTransition` and `from`/`to` match
3. For each matching hook:
   - `check` (enforce): run command. If it fails, do NOT propose the transition.
   - `check` (advisory): run command. If it fails, include a warning in the proposal.
   - `block`: do NOT propose the transition (unconditional block).
   - `notify`: queue notifications for enabled messenger channels.
4. Include hook evaluation results in the proposal

### During TaskCompleted (After Researcher Finishes)

1. Read `.agent/hooks.md`
2. Filter hooks where `event` is `TaskCompleted` and matcher matches
3. Execute `check` actions (adventure completion verification)
4. Execute `notify` actions (send completion notifications)
5. Execute `log` actions (record final metrics)
6. Continue with existing adventure completion detection flow

## Backward Compatibility

- Missing `.agent/hooks.md`: no hooks evaluated, pipeline behavior unchanged
- `enabled: false` on any hook: hook never fires
- Empty `matcher`: hook fires for all events of that type
- `advisory` mode hooks: never block pipeline progress
- No new runtime dependencies, no external processes required
