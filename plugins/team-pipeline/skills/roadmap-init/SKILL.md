---
name: roadmap-init
description: Bootstrap .agent/roadmap.md from current ecosystem state. Scans adventures, maps to projects, computes stats, migrates strategic context.
argument-hint: "[--force]"
---

# Roadmap Init

Bootstrap `.agent/roadmap.md` from the current ecosystem state. Scans all adventures, maps them to the five registered projects, computes per-project and ecosystem stats, migrates strategic context from root `roadmap.md` if present, builds the dependency map, and writes the complete roadmap file.

Running this skill again overwrites `.agent/roadmap.md` with freshly computed state (idempotent).

## Steps

### 1. Validate Environment

Check that `.agent/` exists in the current working directory. If it does not exist, tell the user:

> "No `.agent/` directory found. Run `/task-init` first to set up the pipeline."

STOP. Do not continue.

Check whether `.agent/adventures/` exists. If it does NOT exist, warn the user:

> "No adventures directory found at `.agent/adventures/`. Roadmap will be created with empty project data."

Continue regardless -- the roadmap file should still be created even with no adventure data.

### 2. Define Project Registry

Hardcode the five ecosystem projects. These are the top-level logical projects tracked by the roadmap:

| Project ID    | Path                        | Description                              |
|---------------|-----------------------------|------------------------------------------|
| team-pipeline | `projects/team-pipeline`    | Task processing pipeline plugin          |
| binartlab     | `projects/binartlab`        | Agent orchestration platform (8 packages)|
| marketplace   | `marketplace`               | Local plugin marketplace                 |
| team-mcp      | `projects/team-mcp`         | MCP server for pipeline state            |
| pipeline-dsl  | `projects/team-pipeline/dsl`| Visual schema language                   |

Initialize each project entry with:
- `status: active`
- `health: green`
- `completed_adventures: 0`
- `current_adventure: null`
- `open_tasks: 0`
- `milestones: []`
- `adventures: []` (list of adventure IDs mapped to this project, filled in Step 4)

### 3. Scan Adventures

Glob all files matching `.agent/adventures/*/manifest.md`.

For each manifest found:

1. Read the file and parse the YAML frontmatter (the block between the first pair of `---` delimiters).
2. Extract fields: `id`, `title`, `state`, `created`, `updated`, `tasks`.
3. Parse the **Target Conditions** table from the body (lines matching `| TC-`). Count:
   - `total_tcs`: count of TC rows
   - `passed_tcs`: count where the Status column is `passed` or `done` (case-insensitive)
4. Collect into an adventure data structure:

```
adventure = {
  id,           // e.g., "ADV-019"
  title,
  state,        // concept | planning | active | review | blocked | completed | cancelled
  created,
  updated,
  tasks,        // array of task IDs from frontmatter
  total_tcs,
  passed_tcs,
  taskDir,      // path: .agent/adventures/{id}/tasks/
  designDir,    // path: .agent/adventures/{id}/designs/
  projects: [], // filled in Step 4
}
```

**Error path**: If a manifest has missing or corrupt YAML frontmatter (no valid `id` field), log a warning:
> "Warning: skipping corrupt manifest at `.agent/adventures/{dirname}/manifest.md`"

Skip that adventure and continue.

### 4. Map Adventures to Projects

For each adventure, determine which project(s) it belongs to using the following heuristics (apply in order, most specific first):

**Heuristic A — File path matching:**

Read the adventure's concept text from the manifest body and any design files in `.agent/adventures/{id}/designs/`. Collect all file paths mentioned (lines that look like `path/to/file.md` or paths in markdown code blocks).

Match collected paths to projects using these rules (most-specific path wins):

- Path contains `projects/team-pipeline/dsl` -> `pipeline-dsl`
- Path contains `projects/team-pipeline` -> `team-pipeline`
- Path contains `projects/binartlab` -> `binartlab`
- Path contains `projects/team-mcp` -> `team-mcp`
- Path contains `marketplace` (but not `projects/`) -> `marketplace`
- Path contains `.agent/` only (cross-cutting) -> `ecosystem`

An adventure may match multiple projects (multi-project adventure).

**Heuristic B — Keyword fallback (when no file paths matched):**

Scan the adventure title and concept text for these keywords (case-insensitive):

- "binartlab", "web-api", "web-ui", "core package" -> `binartlab`
- "MCP", "team-mcp" -> `team-mcp`
- "marketplace" -> `marketplace`
- "DSL", "pipeline-dsl", "schema language" -> `pipeline-dsl`
- "pipeline", "team-pipeline", "task processing" -> `team-pipeline`

If keyword matching produces no result, or if the adventure clearly spans all projects (e.g., title contains "ecosystem", "roadmap", "workspace"), mark it as `ecosystem`.

**Build the mapping:**

Add each matched project ID to `adventure.projects`. Add the adventure ID to the `adventures[]` list on each matched project entry from Step 2.

`ecosystem` adventures are listed under all five projects in the per-project sections.

### 5. Compute Per-Project Stats

For each project in the registry, compute the following using the adventure mapping from Step 4:

**`completed_adventures`**: Count adventures mapped to this project where `state === "completed"`.

**`current_adventure`**: Find the most recently updated adventure mapped to this project with `state === "active"`. Use the `updated` timestamp to pick the most recent. If none, set to `null`.

**`open_tasks`**: For each active adventure mapped to this project, count task files in `.agent/adventures/{id}/tasks/` (exclude the `archive/` subdirectory). Read each task file's frontmatter and count those where `stage` is not `completed` and `status` is not `done`. Sum across all active adventures. If no active adventures, use 0.

**`health`**:
- Start with `green`.
- Set to `yellow` if any adventure mapped to this project has `state === "blocked"`.
- Set to `red` if two or more adventures are blocked, OR if the current active adventure's `updated` timestamp is more than 7 days before today (staleness check).
- If no adventures are mapped to this project, leave as `green`.

### 6. Compute Ecosystem Stats

After processing all adventures, compute global statistics:

- `total_adventures`: total count of adventure directories successfully scanned (not counting skipped corrupt ones)
- `completed_adventures`: count with `state === "completed"`
- `total_tasks`: for each adventure, count task files in its `tasks/` directory (exclude `archive/`). Sum all counts.
- `completed_tasks`: across all adventures, count task files where frontmatter `stage === "completed"` or `status === "done"`. Sum all counts.
- `total_tcs`: sum of `total_tcs` from all adventures
- `passed_tcs`: sum of `passed_tcs` from all adventures

### 7. Migrate Strategic Context

Check if `roadmap.md` exists at the workspace root (the directory containing `.agent/`).

**If `roadmap.md` exists**, read it and extract the following sections:

- **Feature Candidate Status** (or similar heading) -> copy verbatim into the **Strategic Goals** section of the new roadmap.
- **Upcoming Adventures** (or "Next Up") section -> note these for inclusion in per-project Next Up subsections. Map each mentioned adventure to the relevant project(s) using the project mapping from Step 4.
- **Dependency Graph** (or "Dependencies") section -> copy into the **Dependency Map** section of the new roadmap.
- **Notes** or **Session Notes** section -> copy as the first entry under **Session Notes** in the new roadmap, prefixed with: `> Migrated from root roadmap.md on {today}:`

**If `roadmap.md` does not exist at the workspace root**, use the following placeholder text for each section:

- Strategic Goals: `_No prior roadmap found. Add strategic goals with `/roadmap goal <text>`._`
- Dependency Map: `_No dependency data available. Run `/roadmap update` after adventures are created._`
- Session Notes: `_No prior session notes. Notes are added automatically by the roadmap hook or manually with `/roadmap note <text>`._`

### 8. Build Dependency Map

Scan all adventure manifests for dependency references. Look for these patterns in the concept text and body:

- "after ADV-NNN"
- "needs ADV-NNN"
- "requires ADV-NNN"
- "depends on ADV-NNN"
- "prerequisite: ADV-NNN"
- "blocked by ADV-NNN"

Also check the root `roadmap.md` dependency section if it was migrated in Step 7.

Build an adjacency list:

```
dependencies = {
  "ADV-019": ["ADV-001", "ADV-002"],   // ADV-019 depends on ADV-001 and ADV-002
  ...
}
```

From the adjacency list, identify:

- **Critical Path**: the longest chain of dependent adventures not yet completed. Walk the dependency graph starting from the most downstream active adventure.
- **Active Dependencies**: currently `active` adventures that appear in other adventures' dependency lists (they are blocking something).
- **Independent Work**: adventures with `state: concept` or `state: planning` that have no unmet dependencies (all their prerequisites are `completed`).

Format the dependency map as a text-based graph in the output (see Step 9 for format).

**Error path**: if dependency references point to adventure IDs not found in the scan (e.g., the adventure was removed), note them as "referenced but not found" and continue.

### 9. Generate Roadmap File

Write `.agent/roadmap.md`. If the file already exists, overwrite it.

#### Frontmatter

```yaml
---
version: "1.0"
last_updated: {ISO timestamp of now}
last_session_read: null
projects:
  - id: team-pipeline
    path: projects/team-pipeline
    status: active
    health: {computed}
    completed_adventures: {N}
    current_adventure: {id or null}
    open_tasks: {N}
    milestones: []
  - id: binartlab
    path: projects/binartlab
    status: active
    health: {computed}
    completed_adventures: {N}
    current_adventure: {id or null}
    open_tasks: {N}
    milestones: []
  - id: marketplace
    path: marketplace
    status: active
    health: {computed}
    completed_adventures: {N}
    current_adventure: {id or null}
    open_tasks: {N}
    milestones: []
  - id: team-mcp
    path: projects/team-mcp
    status: active
    health: {computed}
    completed_adventures: {N}
    current_adventure: {id or null}
    open_tasks: {N}
    milestones: []
  - id: pipeline-dsl
    path: projects/team-pipeline/dsl
    status: active
    health: {computed}
    completed_adventures: {N}
    current_adventure: {id or null}
    open_tasks: {N}
    milestones: []
ecosystem_stats:
  total_adventures: {N}
  completed_adventures: {N}
  total_tasks: {N}
  completed_tasks: {N}
  total_tcs: {N}
  passed_tcs: {N}
---
```

#### Body

```markdown
# Project Roadmap

> Generated by `/roadmap-init` on {today, YYYY-MM-DD}. Use `/roadmap` to view and `/roadmap update` to refresh.

## Ecosystem Overview

{Write a 2-3 sentence summary paragraph covering: total number of adventures, how many are active vs completed, which projects have active work, and overall health. Example: "The Claudovka ecosystem has {N} adventures tracked across 5 projects. {N} are active, {N} completed. {project names with active work} currently have active adventures. Overall ecosystem health is {green/yellow/red}."}

## Projects

### team-pipeline

**Status**: {health indicator: green/yellow/red} | **Open Tasks**: {N} | **Completed Adventures**: {N}

#### Active Work

{If current_adventure is non-null:}
- **{ADV-ID}: {title}** — {passed_tcs}/{total_tcs} TCs passed

{If no active adventure:}
_No active adventures._

#### Recent Completions

{List last 3-5 completed adventures for this project, sorted by updated timestamp descending:}
- {ADV-ID}: {title} (completed {date})

{If none:}
_No completed adventures yet._

#### Milestones

_No milestones set. Use `/roadmap milestone team-pipeline <name> [target-date]` to add one._

#### Next Up

{If a "Next Up" entry was migrated from root roadmap.md for this project, include it here. Otherwise:}
_No upcoming adventures planned. Use `/roadmap goal <text>` to set direction._

---

### binartlab

{Same subsection structure as team-pipeline above}

---

### marketplace

{Same subsection structure as team-pipeline above}

---

### team-mcp

{Same subsection structure as team-pipeline above}

---

### pipeline-dsl

{Same subsection structure as team-pipeline above}

---

## Strategic Goals

{Content migrated from root roadmap.md Feature Candidate section, or placeholder if none.}

## Dependency Map

{If dependencies were found in Step 8:}

### Adventure Dependencies

```
{adjacency list formatted as text graph, e.g.:}
ADV-019 (active)
  depends on: ADV-001 (completed), ADV-002 (completed)

ADV-020 (concept)
  depends on: ADV-019 (active)  <- not yet met
```

### Critical Path

{Longest chain, e.g.: "ADV-001 -> ADV-019 -> ADV-020 -> ADV-021"}

### Active Dependencies

{Adventures that are currently active and block downstream work:}
- {ADV-ID}: {title} — blocks {ADV-ID list}

### Independent Work

{Adventures ready to start (no unmet dependencies):}
- {ADV-ID}: {title} — {state}

{If no dependencies found:}
{Content migrated from root roadmap.md, or placeholder.}

## Session Notes

{Content migrated from root roadmap.md Notes section, or placeholder.}
```

After writing the file, confirm to the user:

```
Roadmap initialized at .agent/roadmap.md

Projects:       5
Adventures:     {total_adventures} total, {completed_adventures} completed
Active:         {active count} adventures
Open Tasks:     {sum of open_tasks across all projects}
TCs:            {passed_tcs}/{total_tcs} passed

Use /roadmap to view the roadmap.
```
