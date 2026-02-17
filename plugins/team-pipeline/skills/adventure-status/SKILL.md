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

For each adventure with `state: active`:

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

### 5. Display Completed Adventure Summaries

For each adventure with `state: completed`, show the `## Metrics Summary` section from the manifest.
