# Lead Role Design

**Date**: 2026-02-10
**Status**: Concept
**Replaces**: Controller (hooks), Messenger (hooks)

---

## Overview

The lead is an LLM-powered orchestration agent (sonnet) that replaces the deterministic hook-based controller and stateless messenger with a single intelligent agent. It observes the entire pipeline, reasons about state transitions, crafts contextual notifications, and proposes actions to the user.

**Core principle: Full authority, zero autonomy.** The lead has the knowledge and capability to manage every aspect of the pipeline - task advancement, role assignment, config changes, notifications - but it never acts without user approval. It operates as a report-and-propose advisor.

## What It Replaces

| Current System | Lead Replacement |
|----------------|-----------------|
| Controller hooks (deterministic transitions) | Intelligent transition proposals with reasoning |
| Messenger hooks (stateless notifications) | Contextual, prioritized communications |
| Manual `/task advance` commands | Proactive recommendations |
| Fixed transition rules | Judgment-based decisions |
| `controller-state.md` | `lead-state.md` |
| Controller subcommands | `/task lead` |

## What Changes

- Transition rules become guidelines, not hard-coded logic
- The lead can notice patterns (repeated review failures, blocked dependencies) and propose strategic actions
- Notifications become contextual - crafted based on what actually matters, not just event type

---

## Trigger Model

### Automatic Triggers (Lightweight)

On **SubagentStop**, **SessionStart**, and **Stop** hook events, the lead performs a silent state update:

- Reads task files and controller state
- Updates internal situational awareness
- Evaluates: does anything need user attention?

If **nothing noteworthy**: no output, no interruption. Silence by default.

If **something needs attention**: surfaces a proposal to the user.

### Attention-Worthy Conditions

| Condition | Urgency |
|-----------|---------|
| Agent completed, task ready to advance | Normal |
| Review failed, task needs fixing assignment | Normal |
| Task blocked (max iterations, missing dependency) | High |
| Multiple tasks ready, prioritization needed | Normal |
| Pipeline idle, queued tasks waiting | Low |
| Agent crashed or timed out | High |
| All tasks in stage completed | Info |

### On-Demand Trigger

User calls `/task lead`. The lead performs full analysis:

- Current pipeline state summary
- Pending decisions that need user input
- Recommendations with reasoning
- Proposed next actions as a numbered list

---

## Proposal Format

When the lead surfaces a recommendation:

```
## Pipeline Update

**Event**: TASK-004 implementing completed by coder
**Status**: Ready for review

### Recommendation

1. **Advance TASK-004 to reviewing** -> assign code-reviewer
   Reason: Implementation complete, no blockers, tests passing per agent output

2. **Start TASK-006 implementing** -> assign coder
   Reason: Dependencies resolved (TASK-004 was blocking), queue position 1

### Also noting
- TASK-007 still blocked on TASK-005 (in reviewing)
- Pipeline load: 1/3 parallel slots used

Awaiting your decision.
```

---

## Decision Reasoning

The lead applies judgment beyond simple transition rules:

| Situation | Deterministic Controller | Lead Reasoning |
|-----------|------------------------|----------------|
| Review failed 3rd time | BLOCKED status, stop | Proposes: reassign to different role, split task, or adjust scope |
| Two tasks ready, one slot | FIFO queue order | Proposes based on priority, dependencies, and downstream impact |
| Agent crashed | Retry blindly | Analyzes crash context, proposes retry with adjustments or reassignment |
| All implementing done | Advance each individually | Proposes batch advancement, notes review bottleneck risk |
| User absent, queue backing up | Stalls | Summarizes accumulated state on next SessionStart |

---

## State Management

Persistent state in `.agent/lead-state.md`:

```yaml
---
last_analysis: 2026-02-10T14:30:00Z
pending_proposals: 2
decisions_awaiting:
  - advance TASK-004 to reviewing
  - start TASK-006 implementing
pattern_notes:
  - "TASK-003 failed review twice - scope may be too broad"
session_context:
  tasks_completed_today: 3
  avg_stage_duration_mins: 12
mode: semi-auto
max_parallel: 3
active_agents:
  - task: TASK-004
    role: coder
    started: 2026-02-10T14:00:00Z
    agent_id: agent-abc123
queue:
  - task: TASK-006
    next_stage: implementing
    waiting_since: 2026-02-10T14:10:00Z
    depends_on: []
paused: false
---
```

Combines previous controller-state + messenger state + lead's own analysis notes into a single file.

---

## Messenger Integration

### Channel Behavior

| Channel | When | Content Style |
|---------|------|---------------|
| Terminal | Always, on attention-worthy events | Structured proposal (full detail) |
| Discord/Slack/Telegram | Configurable per severity | Concise summary with key facts |

### Message Crafting

The lead writes messages based on actual context instead of filling templates:

**Old messenger output:**
```
[pipeline] TASK-004 advanced to reviewing (code-reviewer assigned)
```

**Lead output:**
```
[pipeline] TASK-004 -> reviewing (code-reviewer)
  Context: Implemented auth middleware, 3 files changed
  Note: This unblocks TASK-006 and TASK-007
```

### External Channel Dispatch

Same curl-based mechanism as current messenger. The lead composes payloads (Discord embeds, Telegram HTML, Slack Block Kit) dynamically rather than from templates.

### Channel Configuration

Simplified `.agent/messenger.md`:

```yaml
---
channels:
  discord:
    enabled: true
    webhook_url_env: DISCORD_WEBHOOK_URL
    events: [high, normal]
  telegram:
    enabled: false
    bot_token_env: TELEGRAM_BOT_TOKEN
    chat_id_env: TELEGRAM_CHAT_ID
    events: [all]
  slack:
    enabled: false
    webhook_url_env: SLACK_WEBHOOK_URL
    events: [high]
  terminal:
    enabled: true
    events: [all]
---
```

Event filtering is severity-based (`high`, `normal`, `low`, `info`) rather than event-type-based.

---

## Architecture

### Role Template

`roles/templates/lead.md`:

```yaml
---
name: lead
description: Pipeline orchestrator and advisor. Observes all stages, proposes transitions, manages notifications.
model: sonnet
maxTurns: 10
memory: project
tools: [Read, Glob, Grep, Write, Edit, Bash, Task]
disallowedTools: []
skills: []
knowledge: [pipeline-rules, roles, decisions]
pipeline_stages: [all]
---
```

### Hook Triggers

Three prompt-based hooks that invoke the lead agent:

| Hook Event | Behavior |
|------------|----------|
| SubagentStop | Lightweight: read state, evaluate, surface if attention-worthy |
| SessionStart | Full: summarize accumulated state, list pending decisions |
| Stop | Info: brief pipeline status in session closing |

Each hook spawns the lead agent with context injection (event type, task ID, agent output summary).

### Command

`/task lead` - On-demand full pipeline analysis and recommendations.

### Constraints

- maxTurns capped at 10 - proposes, doesn't execute long chains
- Cannot spawn other agents directly - proposes, user approves, pipeline spawns
- Bash access limited to curl (notifications) and read-only commands
- Writes only to lead-state.md and messenger channels

---

## Removals

| Removed | Reason |
|---------|--------|
| Controller SubagentStop hook | Replaced by lead agent |
| Controller SessionStart hook | Replaced by lead agent |
| Controller Stop hook | Replaced by lead agent |
| Messenger SubagentStop hook | Absorbed into lead |
| Messenger SessionStart hook | Absorbed into lead |
| `controller-state.md` | Replaced by `lead-state.md` |
| `/task controller *` subcommands | Replaced by `/task lead` |
| `message_templates` in messenger config | Lead generates messages dynamically |

---

## Migration Path

1. Add lead role template and hooks
2. Keep old controller/messenger hooks disabled but present
3. Update `/task` command to support `lead` subcommand
4. Remove old hooks once lead is validated
