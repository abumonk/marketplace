---
name: task-status
description: Display the current status of all tasks in the pipeline, grouped by stage
---

# Task Pipeline Status

## Steps

1. Check that `.agent/tasks/` exists. If not, tell the user to run `/task-init` first.

2. Read all `.md` files in `.agent/tasks/` (not in `archive/`).

3. Parse the YAML frontmatter of each task file to extract: `id`, `title`, `stage`, `status`, `assignee`, `iterations`, `updated`.

4. Display as a table grouped by stage, ordered: planning, implementing, reviewing, fixing, blocked, then completed tasks from `archive/` (last 5 only):

   ```
   ## Pipeline Status

   | Stage        | Task     | Title                    | Assignee    | Status      | Iterations |
   |-------------|----------|--------------------------|-------------|-------------|------------|
   | PLANNING     | TASK-004 | Add rate limiting        | planner     | in_progress | 0          |
   | IMPLEMENTING | TASK-003 | Refactor auth middleware | implementer | in_progress | 0          |
   | REVIEWING    | TASK-002 | Add user endpoints       | reviewer    | in_progress | 1          |
   | FIXING       | TASK-005 | Fix login flow           | implementer | in_progress | 2          |

   ### Recently Completed (last 5)
   | Task     | Title                   | Iterations | Completed  |
   |----------|------------------------|------------|------------|
   | TASK-001 | Database connection pool| 0          | 2026-02-08 |
   ```

5. Flag any tasks with `iterations >= 3` as BLOCKED.

6. If a task has `status: ready` or `status: passed` or `status: failed`, suggest the next action:
   - `ready` in `planning` stage: "Ready to advance to implementing"
   - `ready` in `implementing` stage: "Ready to advance to reviewing"
   - `passed` in `reviewing` stage: "Ready to complete"
   - `failed` in `reviewing` stage: "Ready to advance to fixing (iteration {n+1})"

7. If `.agent/adventures/` exists, check for adventure tasks:
   - For each displayed task, if it has an `adventure_id` field, show it in parentheses after the title
   - Example: `| TASK-005 | Register endpoint (ADV-001) | implementing | in_progress | 0 |`
   - After the main table, add a brief adventure summary:
     ```
     ### Adventures
     | ID | Title | State | Progress |
     |----|-------|-------|----------|
     | ADV-001 | User Management API | active | 5/8 tasks |
     ```
   - Suggest `/adventure-status` for detailed adventure view
