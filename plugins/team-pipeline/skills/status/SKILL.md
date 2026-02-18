---
name: status
description: Show task pipeline status
---

# Task Pipeline Status

1. Verify current directory has `.agent/tasks/` -- if not, tell user to run `/task-init` first and stop.

2. Read all `.md` files in `.agent/tasks/` (not in `archive/`).

3. Parse YAML frontmatter of each task: `id`, `title`, `status`, `assignee`, `updated`.

4. Group by status: blocked, in_progress, ready, done, archived.

5. Display as formatted table:

   ```
   | ID       | Title                    | Status      | Assignee    | Last Updated |
   |----------|--------------------------|-------------|-------------|--------------|
   | TASK-003 | Refactor auth middleware  | in_progress | implementer | 2026-02-15   |
   | TASK-005 | Fix login flow           | blocked     | implementer | 2026-02-13   |
   ```

6. Highlight any tasks stuck >24h (last updated more than 24 hours ago while status is `in_progress` or `blocked`). Mark with `[STUCK]` prefix on status.

7. If `.agent/adventures/` exists, append adventure summary after the main table.
