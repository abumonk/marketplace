---
name: task-migrate
description: Migrate existing tasks, TODOs, and issues from external sources into the team-pipeline task system
disable-model-invocation: true
---

# Migrate Tasks Into Pipeline

Import existing work items from user-specified sources into `.agent/tasks/` as properly formatted task files.

## Steps

1. Check that `.agent/tasks/` exists. If not, tell the user to run `/task-init` first.

2. Ask the user: "What sources should I import tasks from?" and suggest these options:
   - **Source code TODOs** - Scan for `TODO`, `FIXME`, `HACK`, `XXX` comments
   - **GitHub/GitLab issues** - Import open issues via `gh issue list` or API
   - **Markdown files** - Parse task lists from specific `.md` files (README, CHANGELOG, roadmap, etc.)
   - **Git history** - Scan recent commits for "WIP", "partial", "temporary" mentions
   - **Custom** - User provides a file path or describes what to import

   Let the user select one or more sources. Wait for their response.

3. For each selected source, scan and collect raw items:

   ### Source: Code TODOs
   - Run `Grep` for pattern `(TODO|FIXME|HACK|XXX)[\s:]+(.*)` across all source files
   - Exclude `.agent/`, `node_modules/`, `vendor/`, `.git/`, `dist/`, `build/`
   - Collect: file path, line number, comment text

   ### Source: GitHub Issues
   - Run: `gh issue list --state open --limit 50 --json number,title,body,labels`
   - Collect: issue number, title, body, labels

   ### Source: Markdown Files
   - Ask user which files to scan
   - Parse lines matching `- [ ]` (unchecked task items)
   - Collect: file path, task text

   ### Source: Git History
   - Run: `git log --oneline -50 --grep="WIP\|partial\|temporary\|TODO\|fixme" -i`
   - Collect: commit hash, message

   ### Source: Custom
   - Ask user to describe or paste the items
   - Collect: whatever the user provides

4. Present all collected items to the user as a numbered list:
   ```
   Found 12 items to import:

    1. [TODO]  src/auth.ts:42 - Implement token refresh logic
    2. [TODO]  src/api.ts:88 - Add rate limiting
    3. [FIXME] src/db.ts:15 - Connection pool leaks on error
    4. [GH#12] Add user profile endpoint
    5. [GH#15] Fix login redirect loop
    6. [MD]    README.md - Set up CI/CD pipeline
    7. [MD]    README.md - Write API documentation
    ...
   ```

5. Ask the user: "Which items should I import? (Enter numbers, ranges like 1-5, or 'all')"

6. Ask the user: "Should I group related items into single tasks, or create one task per item?"
   - If grouping: suggest groups based on file proximity, topic similarity, or labels. Show the proposed groups and let the user adjust.
   - If one-per-item: proceed directly.

7. For each task to create, determine the next available TASK-ID (scan `.agent/tasks/` for highest number, continue incrementing).

8. Create each task file at `.agent/tasks/{TASK-ID}.md`:

   ```markdown
   ---
   id: {TASK-ID}
   title: {derived title}
   stage: planning
   status: in_progress
   created: {ISO timestamp}
   updated: {ISO timestamp}
   iterations: 0
   assignee: planner
   files: [{source files if known}]
   depends_on: []
   tags: [{derived from source, labels, or file paths}]
   ---

   ## Description
   {Compiled from source text. Include original location references.}

   ## Source
   - **Origin**: {source type} (e.g., "TODO in src/auth.ts:42", "GitHub Issue #12")
   - **Original text**: {verbatim original text}

   ## Acceptance Criteria
   - [ ] {Derived from the item description}
   - [ ] Original source marker removed or resolved

   ## Design
   <!-- Filled by planner agent -->

   ## Log
   - [{timestamp}] migrated: Imported from {source type}
   ```

9. After creating all task files, display a summary:
   ```
   Migration complete:
   - Imported: 8 tasks (TASK-001 through TASK-008)
   - Skipped: 4 items (by user choice)
   - Sources: 3 TODO comments, 2 GitHub issues, 3 markdown items

   Run `/task status` to see the pipeline.
   Run `/task advance TASK-XXX` to start processing a task.
   ```

10. Ask the user: "Should I spawn the planner agent for any of these tasks now?"

## Rules

- Never auto-import everything -- always let the user select
- Preserve original text verbatim in the Source section
- Derive titles from source text, keep them short (under 60 chars)
- Derive tags from: file paths (e.g., `src/auth/` -> `auth`), GitHub labels, or TODO category
- If a `files` field can be pre-populated from the source location, do so
- Do not delete or modify original source markers (TODOs, issues) -- that happens during implementation
- If the user selects grouping, never group items from different sources unless they are clearly related
