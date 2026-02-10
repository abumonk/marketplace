# Communication Layer Design

**Date**: 2026-02-10
**Status**: Concept
**Components**: Messenger role, Metrics tool, Structured messages, Question store

---

## Overview

A communication layer for the team-pipeline that enables structured agent-to-user interaction. Four interconnected components provide question delivery, answer collection, performance tracking, and message formatting.

### Architecture

```
Agents (planner, coder, reviewer...)
    |
    | write structured questions to
    v
.agent/questions/pending.md
    |
    | SubagentStop fires -> lead sees blocked_on_question
    | lead proposes: "present questions to user"
    | user approves -> lead invokes messenger
    v
Messenger role (haiku) reads pending.md
    | formats and presents to user in terminal
    | user selects option
    | messenger writes answer
    v
.agent/questions/ready.md
    |
    | agent re-invoked, reads answer, continues work
    v
.agent/questions/archive.md (processed)

Lead also:
    | writes to .agent/metrics.md on every SubagentStop
    | reads metrics when making proposals (cost, efficiency, load)
```

### Component Summary

| # | Component | Type | Model | Purpose |
|---|-----------|------|-------|---------|
| 1 | Messenger | Role (agent) | haiku | Question lifecycle: present, collect answers, manage timeouts |
| 2 | Metrics | Data file | -- | `.agent/metrics.md` - agent performance log for lead |
| 3 | Structured messages | Convention | -- | Standard question format with options A-D |
| 4 | Question store | Three data files | -- | `pending.md`, `ready.md`, `archive.md` |

---

## 1. Question Store (`.agent/questions/`)

Three files with clear lifecycle separation.

### Lifecycle

```
Agent writes question -> pending.md
                              |
                    User answers (via messenger)
                              |
                         ready.md
                              |
                    Agent reads answer, continues work
                              |
                        archive.md
```

### File 1: `.agent/questions/pending.md`

Questions waiting for user answers.

```markdown
---
last_updated: 2026-02-10T15:30:00Z
count: 2
next_id: 6
---

## Q-005 | TASK-009 | planner

**Context**: Designing payment integration, two viable approaches
**Question**: Should we support multiple payment providers?

- **A**: Stripe only (faster, simpler)
- **B**: Multi-provider with adapter pattern (flexible, more work)

**Default**: A
**Timeout**: 60min
**Asked**: 2026-02-10T15:20:00Z

---

## Q-004 | TASK-007 | coder

**Context**: Implementing auth middleware, found two valid session stores
**Question**: Which session storage should I use?

- **A**: Redis (fast, requires Redis server)
- **B**: Database-backed (no extra infra, slower)
- **C**: In-memory (simplest, lost on restart)

**Default**: B
**Timeout**: 30min
**Asked**: 2026-02-10T15:10:00Z
```

### File 2: `.agent/questions/ready.md`

Answered questions waiting for agent pickup.

```markdown
---
last_updated: 2026-02-10T15:28:00Z
count: 1
---

## Q-003 | TASK-003 | reviewer

**Context**: Review found test coverage at 62%
**Question**: Block on coverage or pass with note?

- **A**: Block (require 80%+)
- **B**: Pass with note (coverage improvement as follow-up task)

**Answer**: B
**Answered**: 2026-02-10T15:28:00Z
**Answered-via**: terminal
```

### File 3: `.agent/questions/archive.md`

Processed questions. Append-only history.

```markdown
---
last_updated: 2026-02-10T15:00:00Z
count: 2
---

## Q-002 | TASK-001 | planner

**Question**: REST or GraphQL for the API?
**Answer**: A (REST)
**Asked**: 2026-02-10T14:00:00Z
**Answered**: 2026-02-10T14:05:00Z
**Processed**: 2026-02-10T14:10:00Z

---

## Q-001 | TASK-001 | planner

**Question**: TypeScript strict mode?
**Answer**: A (Yes)
**Asked**: 2026-02-10T13:50:00Z
**Answered**: 2026-02-10T13:52:00Z
**Processed**: 2026-02-10T14:00:00Z
```

### Ownership

| Actor | pending.md | ready.md | archive.md |
|-------|-----------|----------|------------|
| Agent (writes question) | Append new Q | -- | -- |
| Messenger (collects answer) | Remove Q | Append Q with answer | -- |
| Agent (reads answer) | -- | Remove Q | Append Q with processed timestamp |
| Lead (timeout check) | Read for expired | -- | -- |

### ID Management

`next_id` in `pending.md` frontmatter. Any agent writing a new question increments it. IDs are global and never reused.

### Timeout Handling

Lead checks `pending.md` during hook cycle. If `Asked` + `Timeout` < now:
- Apply default answer
- Move to `ready.md` with `Answered-via: timeout`

---

## 2. Structured Message Format (Agent Convention)

### Format

All agents use this format when writing to `.agent/questions/pending.md`:

```markdown
## Q-{next_id} | {TASK-ID} | {role} | pending

**Context**: {1-2 sentences of why this question arose}
**Question**: {Clear, specific question ending with ?}

- **A**: {option label} ({brief rationale})
- **B**: {option label} ({brief rationale})
- **C**: {option label} ({brief rationale})

**Default**: {letter}
**Timeout**: {minutes}min
**Asked**: {ISO timestamp}
```

### Constraints

| Rule | Why |
|------|-----|
| Max 4 options (A-D) | Keeps choices manageable, fits future channel UIs |
| Each option label max 30 chars | Scannable on any display |
| Rationale in parentheses | Extra context, not essential |
| Default required | Pipeline never blocks indefinitely |
| Timeout required (15-120 min) | Same reason |
| Context max 2 sentences | Questions should be scannable |
| Question must be self-contained | User may not have full task context |

### Agent behavior

- Agent writes question to `pending.md` (increment `next_id`, update `count`, `last_updated`)
- Agent sets task status to `blocked_on_question`
- Agent stops (does not wait for answer in same turn)
- On re-invocation: agent reads `ready.md` for its answers, moves processed questions to `archive.md`

### What agents do NOT write to questions

- No reports (reports go to task file logs)
- No status updates (lead's job)
- No multi-part questions (split into separate Q entries)

---

## 3. Messenger Role

### Identity

```yaml
name: messenger
description: >
  Question lifecycle manager. Presents agent questions to user,
  collects answers, manages timeouts and defaults. Channel-agnostic
  with terminal as primary channel.
model: haiku
maxTurns: 5
tools: [Read, Glob, Grep, Write, Edit]
disallowedTools: [Bash, Task]
skills: []
knowledge: []
pipeline_stages: [all]
```

Haiku -- pure I/O, no reasoning needed. No Bash -- terminal output is direct (Bash added later for external channels).

### Three Operations

Invoked by lead with a mode parameter.

#### Present

Show pending questions to user and collect answers.

```
Read .agent/questions/pending.md
For each question, format and present:

  +-- Q-005 | TASK-009 | planner -----------------+
  |                                                |
  |  Should we support multiple payment providers? |
  |                                                |
  |  Context: Designing payment integration        |
  |                                                |
  |  A) Stripe only (faster, simpler)              |
  |  B) Multi-provider with adapter (flexible)     |
  |                                                |
  |  Default: A (in 58min)                         |
  +------------------------------------------------+

  Answer Q-005 [A/B]:

User types answer letter.
Messenger writes answer to ready.md, removes from pending.md.
Updates frontmatter counts in both files.

Multiple pending questions: present one at a time.
```

#### Timeout

Apply defaults to expired questions.

```
Read .agent/questions/pending.md
For each question where Asked + Timeout < now:
  Apply Default as Answer
  Move to ready.md with Answered-via: timeout
  Remove from pending.md
```

Runs as part of lead's hook cycle before presenting new questions.

#### Status

Report question store state.

```
Questions:
  Pending:  2 (Q-005, Q-004)
  Ready:    1 (Q-003 - awaiting agent pickup)
  Archived: 8
```

### What messenger does NOT do

- Does not decide when to present questions (lead decides)
- Does not re-invoke agents (lead proposes, user approves)
- Does not interpret answers (agents read raw answer letter)

---

## 4. Metrics Tool (`.agent/metrics.md`)

### Purpose

Passive data file giving the lead performance insight for orchestration decisions.

### Format

```yaml
---
last_updated: 2026-02-10T16:00:00Z
totals:
  tokens_in: 145200
  tokens_out: 38400
  agents_spawned: 12
  tasks_completed: 5
  avg_turns_per_agent: 8.3
---
```

### Agent Log (append-only table)

```markdown
## Agent Log

| timestamp | task | role | model | stage | turns | tokens_in | tokens_out | duration_min | result |
|-----------|------|------|-------|-------|-------|-----------|------------|-------------|--------|
| 2026-02-10T14:00 | TASK-001 | planner | opus | planning | 12 | 18500 | 4200 | 8 | ready |
| 2026-02-10T14:10 | TASK-001 | coder | sonnet | implementing | 28 | 42000 | 12000 | 15 | ready |
| 2026-02-10T14:30 | TASK-001 | code-reviewer | opus | reviewing | 6 | 15000 | 3500 | 4 | passed |
```

### Data Collection

Lead appends an entry on every SubagentStop. Data sourced from:
- Task ID, role, model: from prompt context and role file
- Turns: from agent metadata
- Tokens: from API usage data if available, otherwise estimated
- Duration: timestamp diff from lead-state active_agents
- Result: task status after agent finished

### Token Estimation (fallback)

If exact counts unavailable:
- haiku: ~800 tokens/turn
- sonnet: ~2500 tokens/turn
- opus: ~4000 tokens/turn

### How Lead Uses Metrics

Judgment-based, not threshold-based:
- **Cost**: "TASK-003 has used 85k tokens across 3 agents. Consider simplifying."
- **Efficiency**: "code-reviewer averages 6 turns but took 18 on TASK-005."
- **Load**: "3 opus agents this session, 0 haiku. Consider haiku for research."
- **Budget**: "Session total: 245k tokens. ~30k per task."

---

## Integration Flow

### Complete Example

```
1. User runs /task create "Add payment integration"
2. Planner agent starts on TASK-009

3. Planner needs input - writes to .agent/questions/pending.md:
   Q-005 | TASK-009 | planner | pending
   "Should we support multiple payment providers?"
   A: Stripe only  B: Multi-provider
   Default: A  Timeout: 60min

4. Planner sets task status: blocked_on_question, stops

5. SubagentStop fires -> lead hook runs
6. Lead reads questions/pending.md -> sees Q-005
7. Lead reads metrics.md -> notes planner used 12 turns, 18k tokens
8. Lead proposes:
   "TASK-009 planner blocked on question Q-005.
    1. Present Q-005 to user via messenger
    2. Continue with other queued tasks while waiting
    Awaiting your decision."

9. User approves -> lead invokes messenger (present mode)
10. Messenger formats Q-005, presents to user in terminal
11. User types: A
12. Messenger writes Answer: A to ready.md, removes from pending.md

13. Lead proposes:
    "Q-005 answered: Stripe only.
     1. Re-invoke planner on TASK-009 (will read answer from ready.md)"
14. User approves -> planner resumes, reads answer, continues design
15. Planner moves Q-005 from ready.md to archive.md

16. Lead writes metrics entry: planner, 12+N turns, Xk tokens, Ymin, ready
```

### New Task Status

One new status value: `blocked_on_question`

Agent wrote a question and stopped. Task cannot advance until the question is answered. Lead treats this as attention-worthy (always surfaces proposal).

### Responsibilities Boundary

| Action | Owner |
|--------|-------|
| Write questions | Any agent |
| Decide to present questions | Lead (proposes to user) |
| Format and present questions | Messenger |
| Collect answers | Messenger |
| Write answers to ready.md | Messenger |
| Read answers and continue | Original agent |
| Move processed to archive.md | Original agent |
| Record metrics | Lead (on SubagentStop) |
| Interpret metrics | Lead (in proposals) |
| Apply timeouts | Lead (triggers messenger timeout) |

---

## Files Created by task-init

When `/task-init` runs, it creates:

```
.agent/
  questions/
    pending.md    (empty, next_id: 1)
    ready.md      (empty)
    archive.md    (empty)
  metrics.md      (empty totals)
```

## Roles Added

```
roles/templates/
  messenger.md    (haiku, question lifecycle)
```

Messenger added to team/full presets in init-roles alongside lead.
