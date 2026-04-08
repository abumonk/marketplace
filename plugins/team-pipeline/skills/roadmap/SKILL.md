---
name: roadmap
description: View and manage the project roadmap. Supports subcommands: view (default), update, milestone, goal, note.
argument-hint: "[view|update|milestone <project> <name> [date]|goal <text>|note <text>]"
---

# Roadmap

View and manage the Claudovka ecosystem roadmap stored at `.agent/roadmap.md`.

## Steps

### 1. Parse Subcommand

Parse `$ARGUMENTS` to determine what to do. Take the first word as the subcommand (case-insensitive).

- Empty or `view` -> proceed to the **View** path (Steps 3a–3c)
- `update` -> proceed to the **Update** path (Steps 4a–4d)
- `milestone` -> proceed to the **Milestone** path (Steps 5a–5b)
- `goal` -> proceed to the **Goal** path (Step 6)
- `note` -> proceed to the **Note** path (Step 7)
- Anything else -> show usage and stop:

> **Unknown subcommand.** Usage:
> - `/roadmap` — view ecosystem overview and per-project status
> - `/roadmap update` — force full refresh of all derived fields
> - `/roadmap milestone <project-id> <milestone-name> [YYYY-MM-DD]` — add or update a milestone
> - `/roadmap goal <text>` — append a strategic goal
> - `/roadmap note <text>` — append a session note

### 2. Validate Roadmap File (All Subcommands)

Check that `.agent/roadmap.md` exists. If it does **not** exist:

> **No roadmap found at `.agent/roadmap.md`.**
> Run `/roadmap-init` to bootstrap one from the current ecosystem state.

STOP. Do not continue any further.

If the file exists but the YAML frontmatter cannot be parsed (no valid `version` or `projects` field), warn:

> **Warning: roadmap frontmatter appears corrupt.**
> You can run `/roadmap-init --force` to rebuild from scratch, or edit `.agent/roadmap.md` manually to fix the YAML.

STOP.

---

## View Path (Steps 3a–3c)

### 3a. Read Roadmap Data

Read `.agent/roadmap.md`. Parse:

1. **Frontmatter** — extract `version`, `last_updated`, `last_session_read`, `projects` array, and `ecosystem_stats`.
2. **Body sections** — extract the text of:
   - `## Strategic Goals` (all content under that heading until the next `##`)
   - `## Session Notes` (all content under that heading until end of file or next `##`)
   - For each project section (`### <project-id>`), extract any `#### Milestones` and `#### Next Up` content.

### 3b. Display Ecosystem Overview

Print the following header block:

```
# Roadmap — Ecosystem Overview

Last updated: {last_updated}   Last viewed: {last_session_read or "never"}

Adventures: {ecosystem_stats.total_adventures} total, {ecosystem_stats.completed_adventures} completed
Tasks:      {ecosystem_stats.total_tasks} total, {ecosystem_stats.completed_tasks} completed
TCs:        {ecosystem_stats.passed_tcs}/{ecosystem_stats.total_tcs} passed
```

Then write a 1–2 sentence summary based on the data. Example:
> "5 of {N} adventures are active across team-pipeline, binartlab, and marketplace. Overall ecosystem health is green."

Determine overall health as the worst health value across all projects in the `projects` array (red > yellow > green).

### 3c. Display Per-Project Status Cards

For each project entry in the frontmatter `projects` array, print a status card:

```
### {project.id}

Health: {health}  |  Open Tasks: {open_tasks}  |  Current: {current_adventure or "idle"}
Completed adventures: {completed_adventures}
```

If the project's health is `yellow`, append: `(has blocked adventure)`
If the project's health is `red`, append: `(stale or multiple blocks — review needed)`

If the body contains `#### Milestones` content for this project with non-placeholder rows, show a compact milestones list:
```
Milestones:
  - {name} | {target} | {status}
```

If the body contains `#### Next Up` content for this project (non-placeholder), show it:
```
Next up: {content}
```

After all project cards, show the last 2–3 entries from the `## Session Notes` section (most recent first). If the section is empty or only contains the placeholder, skip it.

Then show the `## Strategic Goals` section content (truncated to first 5 bullets if more than 5 are present, with a note: "… and {N} more. Run `/roadmap` view to see all in the file.").

### 3d. Update last_session_read

Rewrite the `last_session_read` field in the frontmatter of `.agent/roadmap.md` to the current ISO timestamp (e.g., `2026-04-07T14:35:00Z`). Only modify that one field — leave all other frontmatter and the body unchanged.

---

## Update Path (Steps 4a–4d)

### 4a. Scan Adventures

Glob all files matching `.agent/adventures/*/manifest.md`. For each:

1. Read and parse the YAML frontmatter — extract `id`, `title`, `state`, `updated`, `tasks`.
2. Parse the `## Target Conditions` table from the body — count `total_tcs` (all TC rows) and `passed_tcs` (rows where Status column is `passed` or `done`, case-insensitive).
3. Record `taskDir` = `.agent/adventures/{id}/tasks/`.

If a manifest has missing or unparseable `id` field, log a warning inline:
> "Warning: skipping corrupt manifest at `.agent/adventures/{dirname}/manifest.md`"

Skip it and continue.

### 4b. Count Tasks Per Adventure

For each adventure from Step 4a, count task files in its `taskDir` (glob `*.md`, exclude any in an `archive/` subdirectory). For each task file, read the frontmatter and note whether `stage !== "completed"` and `status !== "done"`. The count of such files is the adventure's `open_tasks`.

### 4c. Map Adventures to Projects and Compute Per-Project Stats

Use the same project registry as `/roadmap-init`:

| Project ID    | Path                          |
|---------------|-------------------------------|
| team-pipeline | `projects/team-pipeline`      |
| binartlab     | `projects/binartlab`          |
| marketplace   | `marketplace`                 |
| team-mcp      | `projects/team-mcp`           |
| pipeline-dsl  | `projects/team-pipeline/dsl`  |

For each adventure, determine its project mapping using these heuristics (apply in order):

**Heuristic A — File path matching** (from manifest body and design files in `.agent/adventures/{id}/designs/`):
- Path contains `projects/team-pipeline/dsl` -> `pipeline-dsl`
- Path contains `projects/team-pipeline` -> `team-pipeline`
- Path contains `projects/binartlab` -> `binartlab`
- Path contains `projects/team-mcp` -> `team-mcp`
- Path contains `marketplace` (not preceded by `projects/`) -> `marketplace`
- Path contains `.agent/` only -> `ecosystem` (cross-cutting)

**Heuristic B — Keyword fallback** (when no file paths matched, from title and concept text):
- "binartlab", "web-api", "web-ui", "core package" -> `binartlab`
- "MCP", "team-mcp" -> `team-mcp`
- "marketplace" -> `marketplace`
- "DSL", "pipeline-dsl", "schema language" -> `pipeline-dsl`
- "pipeline", "team-pipeline", "task processing" -> `team-pipeline`
- No match or title contains "ecosystem", "roadmap", "workspace" -> `ecosystem`

`ecosystem` adventures are attributed to all five projects.

For each project, recompute:
- `completed_adventures`: count mapped adventures with `state === "completed"`
- `current_adventure`: most recently updated mapped adventure with `state === "active"` (by `updated` timestamp); null if none
- `open_tasks`: sum of open task counts from Step 4b for all active mapped adventures
- `health`:
  - Start `green`
  - `yellow` if any mapped adventure has `state === "blocked"`
  - `red` if 2+ mapped adventures are blocked, OR if `current_adventure.updated` is more than 7 days before today

### 4d. Recompute Ecosystem Stats and Rewrite Roadmap

Compute ecosystem totals:
- `total_adventures`: count of all successfully scanned adventures
- `completed_adventures`: count with `state === "completed"`
- `total_tasks`: sum of all task file counts across all adventures
- `completed_tasks`: sum of task files where `stage === "completed"` or `status === "done"`
- `total_tcs`: sum of `total_tcs` from all adventures
- `passed_tcs`: sum of `passed_tcs` from all adventures

Rewrite `.agent/roadmap.md`:

1. **Frontmatter**: Update `last_updated` to now. Update all `projects` entries with recomputed stats. Update `ecosystem_stats`. Preserve `last_session_read` and any `milestones` arrays unchanged.

2. **Body — regenerate these sections** (overwrite with fresh content):
   - `## Ecosystem Overview` paragraph
   - Each project's `#### Active Work` subsection
   - Each project's `#### Recent Completions` subsection (last 3–5 completed adventures, sorted by `updated` descending)

3. **Body — preserve verbatim** (do not modify):
   - `## Strategic Goals` section
   - Each project's `#### Milestones` subsection
   - Each project's `#### Next Up` subsection
   - `## Session Notes` section
   - `## Dependency Map` section

After rewriting, report to the user:

```
Roadmap updated at .agent/roadmap.md

Projects:    5
Adventures:  {total_adventures} total, {completed_adventures} completed
Active:      {N} adventures
Open Tasks:  {total open_tasks across all projects}
TCs:         {passed_tcs}/{total_tcs} passed
```

---

## Milestone Path (Steps 5a–5b)

### 5a. Parse and Validate Arguments

The arguments after `milestone` are: `<project-id> <milestone-name> [target-date]`.

Parse the remaining arguments (everything after the `milestone` keyword) from `$ARGUMENTS`:
- First token -> `project-id`
- Remaining tokens before any `YYYY-MM-DD` pattern (or to end) -> `milestone-name` (may be multiple words)
- Final token if it matches `YYYY-MM-DD` format -> `target-date`

If `project-id` is missing or `milestone-name` is empty:

> **Usage**: `/roadmap milestone <project-id> <name> [YYYY-MM-DD]`
> Example: `/roadmap milestone team-pipeline v0.14-beta 2026-05-01`

STOP.

Read `.agent/roadmap.md` frontmatter. Get the list of known project IDs from the `projects` array. If the parsed `project-id` is not in that list:

> **Unknown project ID**: `{project-id}`
> Valid project IDs: team-pipeline, binartlab, marketplace, team-mcp, pipeline-dsl

STOP.

### 5b. Add or Update Milestone

Find the `#### Milestones` subsection under `### {project-id}` in the roadmap body.

If the subsection contains a placeholder line (e.g., starts with `_No milestones`), replace it with a milestone table:

```
| Name | Target | Status | Notes |
|------|--------|--------|-------|
| {milestone-name} | {target-date or "TBD"} | planned | |
```

If a milestone table already exists:
- Check if a row with the exact same `milestone-name` already exists (case-insensitive match).
- If it exists: update the `Target` cell to `{target-date or existing value}` and leave `Status` and `Notes` unchanged.
- If it does not exist: append a new row: `| {milestone-name} | {target-date or "TBD"} | planned | |`

Update `last_updated` in the frontmatter to the current ISO timestamp.

Confirm to the user:

> Milestone **{milestone-name}** added to **{project-id}** (target: {target-date or "TBD"}).

---

## Goal Path (Step 6)

Parse the text after `goal` in `$ARGUMENTS`. If empty:

> **Usage**: `/roadmap goal <text>`
> Example: `/roadmap goal Ship pipeline-dsl v1.0 by end of Q2`

STOP.

Find the `## Strategic Goals` section in the roadmap body. Append a new bullet at the end of that section:

```
- {text} (added {YYYY-MM-DD})
```

Use today's date for the `added` stamp.

Update `last_updated` in the frontmatter to the current ISO timestamp.

Confirm to the user:

> Strategic goal added: **{text}**

---

## Note Path (Step 7)

Parse the text after `note` in `$ARGUMENTS`. If empty:

> **Usage**: `/roadmap note <text>`
> Example: `/roadmap note Finished ADV-019 milestone, roadmap system is live`

STOP.

Find the `## Session Notes` section in the roadmap body.

If the section contains only a placeholder line, replace it with the new note entry. Otherwise append after the last existing entry.

Add the note as:

```
### {YYYY-MM-DD HH:MM}
{text}
```

Use the current local date/time for the timestamp.

**Trim to 10 entries**: After appending, count the number of `### ` subsection entries in `## Session Notes`. If there are more than 10, remove the oldest entries (those appearing earliest in the section) until only 10 remain.

Update `last_updated` in the frontmatter to the current ISO timestamp.

Confirm to the user:

> Session note added ({YYYY-MM-DD HH:MM}).
