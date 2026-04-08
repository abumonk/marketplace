---
name: adventure-review
description: Run the full adventure review pipeline. Reviews all tasks, generates adventure report, and extracts knowledge.
argument-hint: <adventure-id>
---

# Adventure Review

Run the full adventure review pipeline for a completed or active adventure. Orchestrates task-level reviews, adventure-level synthesis, knowledge extraction suggestions, and finalization.

## Steps

### 1. Validate Environment

Check that `.agent/adventures/` exists. If not, tell the user: "No adventures found. Use `/start-adventure` to create one."

Parse `$ARGUMENTS` for an adventure ID (e.g., `/adventure-review ADV-021`).

If no ID is provided: glob `.agent/adventures/ADV-*/manifest.md`, parse the YAML frontmatter of each, and display a picker table of adventures with `state: active` or `state: completed`:

```
Available adventures for review:
| ID      | Title                  | State     | Tasks |
|---------|------------------------|-----------|-------|
| ADV-021 | Example Adventure      | active    | 8     |
```

Ask the user: "Provide an adventure ID to review (e.g., ADV-021):" and wait for input.

Once an ID is known, read `.agent/adventures/{ADV-ID}/manifest.md`.

**State validation:**
- If `state` is `concept`, `planning`, or `review`: tell the user "Adventure {ADV-ID} is in state '{state}' and is not ready for review." and stop.
- If `state` is `cancelled`: tell the user "Adventure {ADV-ID} is cancelled." and stop.
- If `state` is `active` or `completed`: proceed.

**Error Handling:** If the manifest file does not exist, report "Adventure {ADV-ID} not found at `.agent/adventures/{ADV-ID}/manifest.md`." and stop. If the manifest has no valid frontmatter (missing `---` delimiters or unparseable YAML), report "Manifest is malformed — cannot parse frontmatter." and stop.

### 2. Check Prerequisites

Read the `tasks` array from the manifest frontmatter. For each task ID, read its task file from `.agent/adventures/{ADV-ID}/tasks/{task-id}.md`.

Check whether every task has `stage: completed` or a review-terminal status (`status: passed` or `status: failed`).

Count tasks by stage:
- Completed: `stage: completed`
- In progress: any other stage
- Unreadable: task file could not be read

**If all tasks are completed:** proceed directly to Step 3.

**If any tasks are not completed:** display a table of incomplete tasks:

```
Incomplete tasks in {ADV-ID}:
| Task ID      | Title                        | Stage          | Status      |
|--------------|------------------------------|----------------|-------------|
| ADV021-T003  | Example task                 | implementing   | in_progress |
```

Ask the user: "These tasks are not yet completed. Options: (c) continue with partial review using only completed tasks, (w) wait until all tasks are complete. Enter 'c' or 'w':"

Wait for user input.
- If the user chooses to wait: stop.
- If the user chooses to continue: note which tasks are skipped and proceed with only the completed tasks.

**Error Handling:** If a task file cannot be read, log a warning ("`[{timestamp}] adventure-review | "warning: could not read {task-id}, excluding from review"`") to adventure.log and exclude that task from the eligible set. Do not crash.

### 3. Task-Level Review Orchestration

Ensure `.agent/adventures/{ADV-ID}/reviews/` directory exists. Create it if missing.

For each eligible task (completed tasks from Step 2):

1. Check if `.agent/adventures/{ADV-ID}/reviews/{task-id}-review.md` already exists.
   - If it exists: skip it. Report: "Skipping {task-id}: review already exists."
   - If it does not exist: spawn the `adventure-task-reviewer` agent with prompt:
     "Review the task at `.agent/adventures/{ADV-ID}/tasks/{task-id}.md` for adventure {ADV-ID}. Write your review report to `.agent/adventures/{ADV-ID}/reviews/{task-id}-review.md`."

2. Track progress: report "Reviewing task {N}/{total}: {task-id}..." before each spawn.

3. After each agent completes, verify the review file was created. If the file is absent, record the task as failed.

Present a summary when all tasks have been processed:

```
Task review summary:
  {N} reviewed (new)
  {M} skipped (pre-existing)
  {K} failed
```

**Error Handling:** If an `adventure-task-reviewer` agent fails (crash, timeout, or error):
- Append to adventure.log: `[{timestamp}] adventure-review | "task reviewer failed for {task-id}: {error}"`
- Continue with the remaining tasks — do not abort the entire review.
- Track the failed task in a failures list for the summary.

If any task reviews failed, ask the user: "{K} task review(s) failed. Options: (c) continue to adventure-level review with available reviews, (r) retry failed reviews. Enter 'c' or 'r':"

Wait for user input. If retry: re-spawn `adventure-task-reviewer` for each failed task before proceeding.

### 4. Adventure-Level Review

Verify that at least one task review file exists in `.agent/adventures/{ADV-ID}/reviews/`.

If no review files exist (all failed in Step 3): report "No task reviews available. Cannot proceed with adventure-level review." and stop.

Spawn the `adventure-reviewer` agent with prompt:
"Analyze adventure {ADV-ID} from manifest at `.agent/adventures/{ADV-ID}/manifest.md`. Read all task reviews in `.agent/adventures/{ADV-ID}/reviews/`. Write the adventure report to `.agent/adventures/{ADV-ID}/reviews/adventure-report.md`."

Wait for completion. Verify that `.agent/adventures/{ADV-ID}/reviews/adventure-report.md` was created.

If the report file was created, report: "Adventure report generated at `.agent/adventures/{ADV-ID}/reviews/adventure-report.md`"

**Note on report files:** The `adventure-reviewer` agent (spawned here) writes a task-synthesis report to `reviews/adventure-report.md`. The `adventure-reporter` agent (spawned by the SubagentStop hook after all tasks complete) writes terminal-state reports to `report-en.md` and `report-ru.md`. These are distinct outputs from different agents.

**Error Handling:** If the `adventure-reviewer` agent fails (crash, timeout, or the report file is absent after completion):
- Append to adventure.log: `[{timestamp}] adventure-review | "adventure reviewer failed: {error}"`
- Report to user: "Adventure-level review failed. Task reviews are available at `.agent/adventures/{ADV-ID}/reviews/`. You can review them manually or retry."
- Skip to Step 7 (finalize with partial results).

### 5. Present Knowledge Extraction Suggestions

Read `.agent/adventures/{ADV-ID}/reviews/adventure-report.md`.

Parse Section 6 ("Knowledge Extraction Suggestions") to extract the suggestion table and individual suggestion blocks. For each suggestion, extract: index number, type (pattern/issue/decision/feedback/process), target file, title, and content.

If `reviews/adventure-report.md` exists but has no Section 6 or no suggestions are found, report: "No knowledge extraction suggestions found in the adventure report." and skip to Step 7.

Present suggestions to the user grouped by type:

```
Knowledge Extraction Suggestions for {ADV-ID}:

PATTERNS:
  [1] {title} (-> {target_file})
  [2] {title} (-> {target_file})

ISSUES:
  [3] {title} (-> {target_file})

DECISIONS:
  [4] {title} (-> {target_file})

FEEDBACK:
  [5] {title} (-> {target_file})

PROCESS:
  [6] {title} (informational -- requires manual review)

Select suggestions to apply (numbers, ranges like 1-3, 'all', or 'none'):
```

Wait for user input. This is the approval gate — the user decides which knowledge suggestions to accept.

**Valid input formats:**
- Individual numbers: `1, 3, 5`
- Ranges: `1-3`
- Combined: `1-3, 5`
- `all` — apply all suggestions
- `none` — skip knowledge extraction entirely

### 6. Apply Approved Suggestions

Parse the user's selection into a list of approved suggestion indices. If the user entered `none`, skip to Step 7.

Filter out process-type suggestions from the auto-apply set (they are informational only; note them separately).

Spawn the `knowledge-extractor` agent with prompt:
"Apply knowledge suggestions from adventure {ADV-ID}. Read the adventure report at `.agent/adventures/{ADV-ID}/reviews/adventure-report.md`, Section 6. Apply suggestions with indices: {comma-separated list of approved indices}. Deduplicate against existing knowledge base files."

Wait for completion. Report: "{N} suggestions applied to knowledge base."

If any process-type suggestions were in the approved set, remind the user: "{M} process suggestion(s) require manual review and were not auto-applied. Review them in the adventure report."

**Error Handling:** If the `knowledge-extractor` agent fails (crash, timeout, or error):
- Append to adventure.log: `[{timestamp}] adventure-review | "knowledge extractor failed: {error}"`
- Report to user: "Knowledge extraction failed. The suggestions are still available in `.agent/adventures/{ADV-ID}/adventure-report.md` for manual application."
- Continue to Step 7.

### 7. Finalize

**Update the adventure manifest** at `.agent/adventures/{ADV-ID}/manifest.md`:
- Read the current `state` from frontmatter (save as `old_state`).
- If all eligible task reviews have `status: PASSED`: set `state: completed`.
- If any task review has `status: FAILED`: set `state: blocked` and note which tasks failed in the manifest body under a `## Blocked` section.
- Set `updated: {ISO timestamp}`.

**Append to adventure.log:**
```
[{timestamp}] adventure-review | "review complete: {N} tasks reviewed, {M} suggestions applied"
[{timestamp}] adventure-review | "state: {old_state} -> {new_state}"
```

**Present summary to user:**

```
Adventure Review Complete: {ADV-ID}

Task Reviews:      {N}/{total} tasks reviewed ({passed} passed, {failed} failed)
Adventure Report:  .agent/adventures/{ADV-ID}/adventure-report.md
Knowledge Applied: {N} suggestions applied to knowledge base
State:             {old_state} -> {new_state}
```

**Error Handling:** If the manifest update fails (file write error), report the error but still present the summary. The review artifacts (task reviews, adventure report, knowledge base updates) are the primary output; the state change is secondary.
