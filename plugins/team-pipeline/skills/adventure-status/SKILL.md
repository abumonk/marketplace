---
name: adventure-status
description: Display the current status of all feature adventures
---

# Adventure Status

## Steps

### 1. Check Environment

Check that `.agent/adventures/` exists. If not, tell the user: "No adventures found. Use `/start-adventure` to create one."

### 2. Read Adventures

Read all directories in `.agent/adventures/` matching pattern `ADV-*`.

For each adventure directory, read `manifest.md` and parse the YAML frontmatter to extract: `id`, `title`, `state`, `created`, `updated`, `tasks`.

### 3. Display Overview

Display all adventures in a table:

```
## Feature Adventures

| ID | Title | State | Tasks | Created |
|----|-------|-------|-------|---------|
| ADV-001 | User Management API | active | 8 | 2026-02-17 |
| ADV-002 | Dashboard Redesign | planning | 0 | 2026-02-18 |
```

### 4. Display Active Adventure Details

For each adventure with `state: active`, `state: paused`, or `state: blocked`:

#### Target Conditions Progress

Read the `## Target Conditions` table from the manifest. Count by status:

```
### ADV-001: User Management API

**Target Conditions:** 8/12 passed, 2 pending, 1 failed, 1 blocked
| ID | Description | Status |
|----|-------------|--------|
| TC-001 | Users can register | passed |
| TC-005 | Rate limiting works | failed |
...
```

#### Task Progress

Read each task listed in the manifest's `tasks` field from `.agent/tasks/` (or archive). Display:

```
**Tasks:** 5/8 completed, 2 in progress, 1 blocked
| Task | Title | Stage | Status | Iterations |
|------|-------|-------|--------|------------|
| TASK-005 | Register endpoint | completed | done | 0 |
| TASK-008 | Rate limiter | fixing | in_progress | 2 |
...
```

#### Evaluation Summary

Read the `## Evaluations` table. Compute totals for tasks that have actuals:

```
**Cost:** $0.42 actual / $0.38 estimated (+11%)
**Tokens:** 280K actual / 250K estimated (+12%)
```

### 5. Display Reviewing Adventure Details

For each adventure with `state: reviewing`:

#### Review Progress

Read the `reviews/` directory in the adventure directory. Count files matching `*-review.md` (excluding `adventure-report.md`). Compare against total tasks from the manifest `tasks` field.

Display:

```
### ADV-XXX: {Title}

**Status: REVIEWING** — adventure review in progress

**Task Reviews:** {N}/{M} complete
| Task | Review File | Status |
|------|-------------|--------|
| ADV021-T001 | reviews/ADV021-T001-review.md | done |
| ADV021-T002 | - | pending |
...

**Adventure Report:** {generated | not yet generated}
  - File: reviews/adventure-report.md (if exists)

**Knowledge Extraction:** {N suggestions found | pending report | N applied}
```

#### Logic

1. List all task IDs from the manifest `tasks` field
2. For each task, check if `reviews/{task-id}-review.md` exists in the adventure directory
3. Check if `reviews/adventure-report.md` exists
4. If the adventure report exists, scan for a `## Knowledge Extraction` section and count suggestion items
5. Show aggregate counts: N/M task reviews complete, report generated/pending, knowledge suggestions count

### 6. Display Paused/Blocked Details

For adventures with `state: paused`: show the same details as active, but prefix with:
```
**Status: PAUSED** — tasks are not being processed
```

For adventures with `state: blocked`: show target conditions that failed, and the tasks responsible:
```
**Status: BLOCKED** — {N} target conditions failed
| TC | Description | Task | Status |
|----|-------------|------|--------|
| TC-005 | Rate limiting works | TASK-008 | failed |
```

### 7. Display Completed Adventure Summaries

For each adventure with `state: completed`, read `metrics.md` from the adventure directory and show:
```
**Tokens**: {total_tokens_in} in / {total_tokens_out} out
**Cost**: ${total_cost}
**Agent Runs**: {agent_runs}
```
If `report-en.md` exists, note: "Full report available at `.agent/adventures/{ADV-ID}/report-en.md`"

### 8. Display Cancelled Adventure Summaries

For each adventure with `state: cancelled`, show a one-line entry:
```
| ADV-003 | Feature X | cancelled | - | 2026-02-20 |
```
