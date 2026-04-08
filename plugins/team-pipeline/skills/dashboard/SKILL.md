---
name: dashboard
description: Generate the Universal Command Center Dashboard from .agent/adventures/ data.
argument-hint: "[--open]"
---

# Dashboard

Generate a single self-contained HTML dashboard file at `.agent/dashboard.html` by scanning all adventure data from `.agent/adventures/`. The output is the Universal Command Center Dashboard with tabbed navigation across 6 views (Command Center + 5 project tabs).

## Project Keyword Mapping Table

Use this table in Step 7 to classify each adventure by its title. Check in order — first match wins. Unmatched adventures go to the "unassigned" bucket.

| Project | Slug | Keywords | Path | Description |
|---------|------|----------|------|-------------|
| Pipeline DSL | pipeline-dsl | "Pipeline DSL", "DSL" | projects/team-pipeline/dsl/ | Visual schema language for pipeline definitions |
| Team MCP | team-mcp | "MCP Server", "MCP Tools", "MCP" | projects/team-mcp/ | MCP server for pipeline state access |
| Team Pipeline | team-pipeline | "Pipeline" (not "DSL"), "Agent", "Step2Step", "SRS", "Automation", "Review Pipeline" | projects/team-pipeline/ | Task processing pipeline plugin (6-stage, multi-agent) |
| Binartlab | binartlab | "Binartlab", "Platform", "Mobile", "Backend", "Vertical Slice", "Control UI", "UX Design" | projects/binartlab/ | Agent orchestration platform (8 npm workspace packages) |
| Marketplace | marketplace | "Marketplace" | marketplace/ | Local plugin marketplace (claudovka-marketplace) |

**Ordering note**: Pipeline DSL and Team MCP are checked before Team Pipeline to avoid false matches on the word "Pipeline". First keyword match wins.

## Steps

### 1. Validate Environment

Check that `.agent/adventures/` exists. If not, tell the user: "No adventures found. Use `/start-adventure` to create one."

Check that `.agent/` is writable by verifying you can see the directory.

### 2. Scan Adventures

Glob all files matching `.agent/adventures/ADV-*/manifest.md`. For each manifest file found:

**Parse frontmatter** (the YAML block between the first `---` delimiters):
- `id` — adventure ID (e.g., `ADV-020`)
- `title` — adventure title
- `state` — current state (concept, planning, active, review, blocked, completed, cancelled)
- `created` — ISO timestamp
- `updated` — ISO timestamp
- `tasks` — array of task IDs

**Parse Target Conditions table** from the markdown body (lines matching `| TC-` pattern):
- Extract TC-ID, Description, and Status columns
- Count total TCs and how many have `Status: passed` (case-insensitive)

Collect each adventure into a data structure:
```
adventure = {
  id, title, state, created, updated,
  taskIds: [...],
  tcs: { total: N, passed: N, pending: N, failed: N },
  tasks: [],        // filled in step 3
  metrics: {},      // filled in step 4
  logEntries: [],   // filled in step 5
  docs: {},         // filled in step 6
  projectSlug: ''   // filled in step 7
}
```

### 3. Scan Task Files

For each adventure, read its task files. Check two locations:

**Location A** — adventure-local tasks: `.agent/adventures/{ADV-ID}/tasks/{ADV-ID-prefix}-T*.md`
  - Glob files matching `.agent/adventures/{ADV-ID}/tasks/*.md` (exclude archive/ subdirectory)

**Location B** — shared task pool fallback: for any task ID in the manifest's `tasks` array that starts with `TASK-`, read `.agent/tasks/{TASK-ID}.md`

For each task file, parse frontmatter:
- `id`, `title`, `stage`, `status`, `assignee`, `iterations`, `created`, `updated`, `target_conditions`

Collect into the adventure's `tasks` array.

### 4. Scan Metrics

For each adventure, read `.agent/adventures/{ADV-ID}/metrics.md` if it exists.

**Parse frontmatter**:
- `total_tokens_in`, `total_tokens_out`, `total_duration`, `total_cost`, `agent_runs`

**Parse Agent Runs table** (lines matching `| ` after the `## Agent Runs` heading):
- Extract columns: Agent, Task, Model, Tokens In, Tokens Out, Duration, Turns, Result
- Skip header and separator rows

Store in the adventure's `metrics` object:
```
metrics = {
  tokens_in, tokens_out, duration, cost, agent_runs,
  runs: [{ agent, task, model, tokens_in, tokens_out, duration, turns, result }, ...]
}
```

### 5. Scan Adventure Log

For each adventure, read `.agent/adventures/{ADV-ID}/adventure.log` if it exists.

Parse each line with the pattern: `[{timestamp}] {agent} | "{message}"`

Extract the last 20 entries (tail of file). Store as:
```
logEntries = [{ timestamp, agent, message }, ...]
```

### 6. Count Documents

For each adventure, count files in these subdirectories:

- Designs: glob `.agent/adventures/{ADV-ID}/designs/*.md` — count files, collect filenames
- Plans: glob `.agent/adventures/{ADV-ID}/plans/*.md`
- Schemas: glob `.agent/adventures/{ADV-ID}/schemas/*.md`
- Roles: glob `.agent/adventures/{ADV-ID}/roles/*.md`
- Tests: glob `.agent/adventures/{ADV-ID}/tests/*.md`

Store in `docs`:
```
docs = {
  designs: { count: N, files: [...] },
  plans: { count: N, files: [...] },
  schemas: { count: N, files: [...] },
  roles: { count: N, files: [...] },
  tests: { count: N, files: [...] }
}
```

### 7. Classify Adventures by Project

After scanning all adventures, classify each into a project using the keyword mapping table above.

For each adventure:
1. Take the adventure's `title` and convert to lowercase for comparison
2. Check keywords in this strict order:
   - **Pipeline DSL** (slug: `pipeline-dsl`): title contains "pipeline dsl" OR "dsl"
   - **Team MCP** (slug: `team-mcp`): title contains "mcp server" OR "mcp tools" OR "mcp"
   - **Team Pipeline** (slug: `team-pipeline`): title contains "pipeline" OR "agent" OR "step2step" OR "srs" OR "automation" OR "review pipeline"
   - **Binartlab** (slug: `binartlab`): title contains "binartlab" OR "platform" OR "mobile" OR "backend" OR "vertical slice" OR "control ui" OR "ux design"
   - **Marketplace** (slug: `marketplace`): title contains "marketplace"
3. First keyword match assigns `adventure.projectSlug = slug`
4. If no keyword matches: `adventure.projectSlug = "unassigned"`

After classifying, group adventures into per-project arrays:
```
projectAdventures = {
  'pipeline-dsl': [...],
  'team-mcp': [...],
  'team-pipeline': [...],
  'binartlab': [...],
  'marketplace': [...],
  'unassigned': [...]
}
```

### 8. Compute Statistics

After classifying adventures, compute both global and per-project statistics.

**Global stats**:
- `totalAdventures` — count of all adventures
- `activeCount` — count where state is `active`, `planning`, or `review`
- `totalTasks` — sum of all task IDs across all adventures
- `totalCost` — sum of all `metrics.cost` values (format as `$N.NN`)
- `generatedAt` — current ISO timestamp

**Per-project stats**: For each project slug (including "unassigned"), compute:
- `totalAdventures` — count of adventures in this project
- `activeAdventures` — count where state is `active`, `planning`, or `review`
- `totalTasks` — sum of task IDs for this project's adventures
- `tcPassed` — sum of `tcs.passed` for all adventures in this project
- `tcTotal` — sum of `tcs.total` for all adventures in this project
- `tcPassRate` — `tcPassed / tcTotal * 100` formatted as `"N%"` (or `"—"` if tcTotal is 0)

**Merged activity feed**: Collect all `logEntries` from all adventures. Each entry should carry `adventureId` and `projectSlug` from its parent adventure. Sort all entries by timestamp descending. Take the top 15 entries. Store as `activityFeed`.

**Active adventures list**: Filter all adventures where state is `active`, `planning`, or `review`. Sort by `updated` descending. Take top 10. Store as `activeAdventuresList`.

### 9. Generate HTML

Build a single self-contained HTML file. Use template literal construction — build each section as a string and concatenate.

**Important**: The HTML must have NO external dependencies — no CDN links, no `<link rel="stylesheet" href="...">`, no `<script src="...">`. All CSS goes in a `<style>` tag; all JS goes in `<script>` tags.

#### 9a. HTML Head

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Command Center</title>
<style>
:root {
  --bg-primary: #0a0a0f;
  --bg-card: #1a1a2e;
  --bg-detail: #12121f;
  --border: #2a2a3e;
  --text-primary: #e0e0e0;
  --text-secondary: #888;
  --accent: #00d4ff;
  --success: #22c55e;
  --warning: #f59e0b;
  --error: #ef4444;
  --info: #3b82f6;
  --purple: #8b5cf6;
  --cyan: #06b6d4;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  background: var(--bg-primary);
  color: var(--text-primary);
  font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
  font-size: 14px;
  line-height: 1.5;
}
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }

/* Header */
.header {
  background: var(--bg-card);
  border-bottom: 1px solid var(--border);
  padding: 20px 32px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.header-title {
  font-size: 22px;
  font-weight: 700;
  color: var(--accent);
  letter-spacing: -0.5px;
}
.header-meta {
  color: var(--text-secondary);
  font-size: 12px;
}
.header-stats {
  display: flex;
  gap: 24px;
  flex-wrap: wrap;
}
.stat {
  text-align: center;
}
.stat-value {
  font-size: 20px;
  font-weight: 700;
  color: var(--accent);
}
.stat-label {
  font-size: 11px;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* Main tab bar */
.main-tabs {
  display: flex;
  background: var(--bg-card);
  border-bottom: 1px solid var(--border);
  overflow-x: auto;
}
.main-tab {
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--text-secondary);
  padding: 12px 20px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  transition: color 0.15s, border-color 0.15s;
}
.main-tab:hover { color: var(--text-primary); }
.main-tab.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
}

/* Project views */
.project-view { display: none; }
.project-view.active { display: block; }

/* Filters */
.filters {
  padding: 12px 32px;
  border-bottom: 1px solid var(--border);
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}
.filters-label {
  color: var(--text-secondary);
  font-size: 12px;
  margin-right: 4px;
}
.filter-btn {
  background: var(--bg-card);
  border: 1px solid var(--border);
  color: var(--text-secondary);
  padding: 4px 14px;
  border-radius: 20px;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.15s;
}
.filter-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.filter-btn.active {
  background: var(--accent);
  border-color: var(--accent);
  color: #000;
  font-weight: 600;
}

/* Adventure Grid */
.grid-section {
  padding: 24px 32px;
}
.grid-section-title {
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: var(--text-secondary);
  margin-bottom: 16px;
}
.adventure-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
}

/* Adventure Card */
.adventure-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 16px;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.adventure-card:hover {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent)22;
}
.adventure-card.expanded {
  border-color: var(--accent);
}
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 8px;
  gap: 8px;
}
.card-id {
  font-size: 11px;
  color: var(--text-secondary);
  font-weight: 600;
  letter-spacing: 0.5px;
}
.card-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 4px;
  flex: 1;
  min-width: 0;
}
.state-badge {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  padding: 2px 8px;
  border-radius: 12px;
  flex-shrink: 0;
}
.state-planning   { background: #3b82f620; color: #3b82f6; border: 1px solid #3b82f640; }
.state-implementing { background: #f59e0b20; color: #f59e0b; border: 1px solid #f59e0b40; }
.state-reviewing  { background: #8b5cf620; color: #8b5cf6; border: 1px solid #8b5cf640; }
.state-fixing     { background: #ef444420; color: #ef4444; border: 1px solid #ef444440; }
.state-completed  { background: #22c55e20; color: #22c55e; border: 1px solid #22c55e40; }
.state-complete   { background: #22c55e20; color: #22c55e; border: 1px solid #22c55e40; }
.state-researching { background: #06b6d420; color: #06b6d4; border: 1px solid #06b6d440; }
.state-active     { background: #00d4ff20; color: #00d4ff; border: 1px solid #00d4ff40; }
.state-review     { background: #f59e0b20; color: #f59e0b; border: 1px solid #f59e0b40; }
.state-concept    { background: #88888820; color: #888; border: 1px solid #88888840; }
.state-blocked    { background: #ef444420; color: #ef4444; border: 1px solid #ef444440; }
.state-cancelled  { background: #88888820; color: #888; border: 1px solid #88888840; }
.state-paused     { background: #8b5cf620; color: #8b5cf6; border: 1px solid #8b5cf640; }

/* Progress bar */
.progress-wrap {
  margin: 10px 0 8px;
}
.progress-label {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-secondary);
  margin-bottom: 4px;
}
.progress-bar-bg {
  background: var(--border);
  border-radius: 4px;
  height: 6px;
  overflow: hidden;
}
.progress-bar-fill {
  height: 100%;
  border-radius: 4px;
  background: linear-gradient(90deg, var(--info), var(--success));
  transition: width 0.3s;
}

/* Card footer */
.card-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 8px;
}
.card-tasks {
  font-size: 11px;
  color: var(--text-secondary);
}
.card-date {
  font-size: 11px;
  color: var(--text-secondary);
}

/* Detail Panel */
.detail-panel {
  display: none;
  background: var(--bg-detail);
  border: 1px solid var(--border);
  border-top: none;
  border-radius: 0 0 8px 8px;
  margin-top: -1px;
}
.detail-panel.open {
  display: block;
}

/* Tabs */
.tab-nav {
  display: flex;
  border-bottom: 1px solid var(--border);
  padding: 0 16px;
  gap: 0;
}
.tab-btn {
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--text-secondary);
  padding: 10px 16px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  transition: color 0.15s, border-color 0.15s;
  margin-bottom: -1px;
}
.tab-btn:hover { color: var(--text-primary); }
.tab-btn.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
}
.tab-content {
  padding: 16px;
}
.tab-pane { display: none; }
.tab-pane.active { display: block; }

/* Tables */
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
th {
  text-align: left;
  color: var(--text-secondary);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-size: 10px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
}
td {
  padding: 6px 8px;
  border-bottom: 1px solid var(--border)88;
  vertical-align: middle;
}
tr:last-child td { border-bottom: none; }
tr:hover td { background: #ffffff08; }

/* Stage badge (task stages) */
.stage-badge {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 2px 6px;
  border-radius: 10px;
  display: inline-block;
}
.stage-planning      { background: #3b82f620; color: #3b82f6; }
.stage-implementing  { background: #f59e0b20; color: #f59e0b; }
.stage-reviewing     { background: #8b5cf620; color: #8b5cf6; }
.stage-fixing        { background: #ef444420; color: #ef4444; }
.stage-completed     { background: #22c55e20; color: #22c55e; }
.stage-researching   { background: #06b6d420; color: #06b6d4; }

/* Status dot */
.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  display: inline-block;
  margin-right: 4px;
}
.dot-in_progress { background: var(--warning); }
.dot-done        { background: var(--success); }
.dot-blocked     { background: var(--error); }
.dot-cancelled   { background: var(--text-secondary); }

/* Doc list */
.doc-category { margin-bottom: 12px; }
.doc-category-title {
  font-size: 11px;
  font-weight: 700;
  color: var(--accent);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 4px;
}
.doc-file {
  font-size: 11px;
  color: var(--text-secondary);
  padding: 1px 0 1px 12px;
}
.doc-empty {
  font-size: 11px;
  color: var(--text-secondary);
  font-style: italic;
}

/* Metrics grid */
.metrics-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}
.metric-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 12px;
  text-align: center;
}
.metric-value {
  font-size: 18px;
  font-weight: 700;
  color: var(--accent);
}
.metric-label {
  font-size: 10px;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-top: 2px;
}

/* Log entries */
.log-entry {
  display: flex;
  gap: 8px;
  padding: 4px 0;
  border-bottom: 1px solid var(--border)44;
  font-size: 11px;
  font-family: 'Consolas', 'Courier New', monospace;
}
.log-entry:last-child { border-bottom: none; }
.log-ts { color: var(--text-secondary); flex-shrink: 0; }
.log-agent { color: var(--accent); flex-shrink: 0; font-weight: 600; min-width: 100px; }
.log-msg { color: var(--text-primary); }

/* Agent Activity section */
.section {
  padding: 0 32px 32px;
}
.section-title {
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: var(--text-secondary);
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border);
}

/* Footer */
.footer {
  background: var(--bg-card);
  border-top: 1px solid var(--border);
  padding: 12px 32px;
  text-align: center;
  color: var(--text-secondary);
  font-size: 11px;
  margin-top: 32px;
}

/* Empty state */
.empty-state {
  color: var(--text-secondary);
  font-style: italic;
  font-size: 12px;
  padding: 8px 0;
}

/* Collapsed group for detail within grid */
.adventure-group {
  display: contents;
}

/* Command Center sections */
.cc-section {
  padding: 24px 32px;
  border-bottom: 1px solid var(--border);
}
.cc-section:last-child { border-bottom: none; }
.cc-section-title {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: var(--text-secondary);
  margin-bottom: 16px;
}

/* Summary strip */
.summary-strip {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}
.project-stat-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 16px 20px;
  flex: 1;
  min-width: 160px;
  border-left: 3px solid var(--accent);
}
.project-stat-card.has-active { border-left-color: var(--warning); }
.project-stat-card.all-done { border-left-color: var(--success); }
.project-stat-name {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 8px;
}
.project-stat-row {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}
.project-stat-item {
  text-align: center;
}
.project-stat-value {
  font-size: 16px;
  font-weight: 700;
  color: var(--accent);
}
.project-stat-label {
  font-size: 10px;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

/* Active adventures list */
.active-adventures-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.active-adv-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 6px;
}
.active-adv-id {
  font-size: 11px;
  font-weight: 700;
  color: var(--text-secondary);
  min-width: 70px;
  flex-shrink: 0;
}
.active-adv-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.active-adv-project {
  font-size: 10px;
  color: var(--cyan);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  flex-shrink: 0;
}
.active-adv-progress {
  width: 80px;
  flex-shrink: 0;
}
.active-adv-date {
  font-size: 11px;
  color: var(--text-secondary);
  flex-shrink: 0;
  min-width: 80px;
  text-align: right;
}

/* Activity feed */
.activity-feed {
  display: flex;
  flex-direction: column;
  gap: 0;
  font-family: 'Consolas', 'Courier New', monospace;
  font-size: 11px;
}
.feed-entry {
  display: flex;
  gap: 10px;
  padding: 5px 0;
  border-bottom: 1px solid var(--border)44;
  align-items: baseline;
}
.feed-entry:last-child { border-bottom: none; }
.feed-ts {
  color: var(--text-secondary);
  flex-shrink: 0;
  min-width: 140px;
}
.feed-project {
  color: var(--cyan);
  flex-shrink: 0;
  min-width: 90px;
  font-weight: 600;
}
.feed-adv-id {
  color: var(--purple);
  flex-shrink: 0;
  min-width: 70px;
}
.feed-agent {
  color: var(--accent);
  flex-shrink: 0;
  min-width: 90px;
  font-weight: 600;
}
.feed-msg {
  color: var(--text-primary);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Quick actions */
.quick-actions {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}
.action-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 16px 20px;
  min-width: 160px;
  text-align: center;
  flex: 1;
}
.action-card-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 4px;
}
.action-card-cmd {
  font-size: 11px;
  color: var(--accent);
  font-family: 'Consolas', 'Courier New', monospace;
}

/* Project header */
.project-header {
  padding: 20px 32px 0;
}
.project-header h2 {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 4px;
}
.project-header-desc {
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 4px;
}
.project-header-path {
  font-size: 11px;
  color: var(--accent);
  font-family: 'Consolas', 'Courier New', monospace;
}

/* Project stats bar */
.project-stats-bar {
  display: flex;
  gap: 24px;
  padding: 16px 32px;
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
}
.project-stats-bar .stat-value {
  font-size: 16px;
}

/* Unassigned section */
.unassigned-section {
  padding: 24px 32px;
  border-top: 1px solid var(--border);
}
.unassigned-title {
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: var(--warning);
  margin-bottom: 16px;
}
</style>
</head>
```

#### 9b. Header Section

```html
<body>
<div class="header">
  <div>
    <div class="header-title">Command Center</div>
    <div class="header-meta">Generated: {generatedAt}</div>
  </div>
  <div class="header-stats">
    <div class="stat">
      <div class="stat-value">{totalAdventures}</div>
      <div class="stat-label">Adventures</div>
    </div>
    <div class="stat">
      <div class="stat-value">{activeCount}</div>
      <div class="stat-label">Active</div>
    </div>
    <div class="stat">
      <div class="stat-value">{totalTasks}</div>
      <div class="stat-label">Tasks</div>
    </div>
    <div class="stat">
      <div class="stat-value">{totalCost}</div>
      <div class="stat-label">Total Cost</div>
    </div>
  </div>
</div>
```

#### 9c. Tab Bar

Replace the old global filter bar with a main tab bar:

```html
<div class="main-tabs">
  <button class="main-tab active" data-project="command-center" onclick="switchProject('command-center', this)">Command Center</button>
  <button class="main-tab" data-project="team-pipeline" onclick="switchProject('team-pipeline', this)">Team Pipeline</button>
  <button class="main-tab" data-project="binartlab" onclick="switchProject('binartlab', this)">Binartlab</button>
  <button class="main-tab" data-project="team-mcp" onclick="switchProject('team-mcp', this)">Team MCP</button>
  <button class="main-tab" data-project="pipeline-dsl" onclick="switchProject('pipeline-dsl', this)">Pipeline DSL</button>
  <button class="main-tab" data-project="marketplace" onclick="switchProject('marketplace', this)">Marketplace</button>
</div>
```

#### 9d. Command Center View

Open a project view div for the Command Center (active by default):

```html
<div class="project-view active" id="view-command-center">
```

**Section 1 — Cross-Project Summary Strip**:

```html
<div class="cc-section">
  <div class="cc-section-title">Projects</div>
  <div class="summary-strip">
```

For each of the 5 projects (pipeline-dsl, team-mcp, team-pipeline, binartlab, marketplace), output a `.project-stat-card`. Set class modifier based on whether the project has active adventures: if `activeAdventures > 0`, add class `has-active`; if `totalAdventures > 0` and `activeAdventures === 0`, add class `all-done`; otherwise no extra class.

```html
    <div class="project-stat-card {modifier}">
      <div class="project-stat-name">{projectName}</div>
      <div class="project-stat-row">
        <div class="project-stat-item">
          <div class="project-stat-value">{stats.totalAdventures}</div>
          <div class="project-stat-label">Adventures</div>
        </div>
        <div class="project-stat-item">
          <div class="project-stat-value">{stats.activeAdventures}</div>
          <div class="project-stat-label">Active</div>
        </div>
        <div class="project-stat-item">
          <div class="project-stat-value">{stats.totalTasks}</div>
          <div class="project-stat-label">Tasks</div>
        </div>
        <div class="project-stat-item">
          <div class="project-stat-value">{stats.tcPassRate}</div>
          <div class="project-stat-label">TC Pass</div>
        </div>
      </div>
    </div>
```

Close the summary strip section:
```html
  </div>
</div>
```

**Section 2 — Active Adventures Panel**:

Show the `activeAdventuresList` (top 10, filtered to state active/planning/review, sorted by updated descending).

```html
<div class="cc-section">
  <div class="cc-section-title">Active Adventures</div>
  <div class="active-adventures-list">
```

For each adventure in `activeAdventuresList`:
- Compute TC percentage: `pct = tcs.total > 0 ? Math.round(tcs.passed / tcs.total * 100) : 0`
- Format updated date as `YYYY-MM-DD`

```html
    <div class="active-adv-item">
      <span class="active-adv-id">{adventure.id}</span>
      <span class="active-adv-title">{adventure.title}</span>
      <span class="active-adv-project">{adventure.projectSlug}</span>
      <span class="state-badge state-{adventure.state}">{adventure.state}</span>
      <div class="active-adv-progress">
        <div class="progress-bar-bg">
          <div class="progress-bar-fill" style="width:{pct}%"></div>
        </div>
      </div>
      <span class="active-adv-date">{updated YYYY-MM-DD}</span>
    </div>
```

If `activeAdventuresList` is empty:
```html
    <p class="empty-state">No active adventures.</p>
```

Close the section:
```html
  </div>
</div>
```

**Section 3 — Recent Activity Feed**:

Show the `activityFeed` (top 15, merged from all adventures, sorted newest-first).

```html
<div class="cc-section">
  <div class="cc-section-title">Recent Activity</div>
  <div class="activity-feed">
```

For each entry in `activityFeed`:
```html
    <div class="feed-entry">
      <span class="feed-ts">{entry.timestamp}</span>
      <span class="feed-project">{entry.projectSlug || 'unassigned'}</span>
      <span class="feed-adv-id">{entry.adventureId}</span>
      <span class="feed-agent">{entry.agent}</span>
      <span class="feed-msg">{entry.message}</span>
    </div>
```

If `activityFeed` is empty:
```html
    <p class="empty-state">No activity recorded.</p>
```

Close the section:
```html
  </div>
</div>
```

**Section 4 — Quick Actions**:

Static reference cards for common pipeline commands.

```html
<div class="cc-section">
  <div class="cc-section-title">Quick Actions</div>
  <div class="quick-actions">
    <div class="action-card">
      <div class="action-card-title">Generate Dashboard</div>
      <div class="action-card-cmd">/dashboard</div>
    </div>
    <div class="action-card">
      <div class="action-card-title">View Roadmap</div>
      <div class="action-card-cmd">.agent/roadmap.md</div>
    </div>
    <div class="action-card">
      <div class="action-card-title">Adventure Status</div>
      <div class="action-card-cmd">/adventure-status</div>
    </div>
    <div class="action-card">
      <div class="action-card-title">Task Status</div>
      <div class="action-card-cmd">/task-status</div>
    </div>
  </div>
</div>
```

**Section 5 — Unassigned Adventures** (conditional):

Only output this section if `projectAdventures['unassigned']` has at least one adventure.

```html
<div class="unassigned-section">
  <div class="unassigned-title">Unassigned Adventures ({count})</div>
  <div class="adventure-grid">
    {adventure cards for unassigned adventures — same card+detail panel layout as sections below}
  </div>
</div>
```

Close the Command Center view:
```html
</div><!-- view-command-center -->
```

#### 9e. Project Views

For each of the 5 projects (in order: team-pipeline, binartlab, team-mcp, pipeline-dsl, marketplace), generate a project view div.

**Project metadata** to use when generating each view:

| Slug | Name | Description | Path |
|------|------|-------------|------|
| team-pipeline | Team Pipeline | Task processing pipeline plugin (6-stage, multi-agent) | projects/team-pipeline/ |
| binartlab | Binartlab | Agent orchestration platform (8 npm workspace packages) | projects/binartlab/ |
| team-mcp | Team MCP | MCP server for pipeline state access | projects/team-mcp/ |
| pipeline-dsl | Pipeline DSL | Visual schema language for pipeline definitions | projects/team-pipeline/dsl/ |
| marketplace | Marketplace | Local plugin marketplace (claudovka-marketplace) | marketplace/ |

For each project, get `adventures = projectAdventures[slug]` (may be empty array). Get `stats = perProjectStats[slug]`.

Sort adventures by `updated` descending.

```html
<div class="project-view" id="view-{slug}">

  <div class="project-header">
    <h2>{projectName}</h2>
    <div class="project-header-desc">{description}</div>
    <div class="project-header-path">{path}</div>
  </div>

  <div class="project-stats-bar">
    <div class="stat">
      <div class="stat-value">{stats.totalAdventures}</div>
      <div class="stat-label">Adventures</div>
    </div>
    <div class="stat">
      <div class="stat-value">{stats.activeAdventures}</div>
      <div class="stat-label">Active</div>
    </div>
    <div class="stat">
      <div class="stat-value">{stats.totalTasks}</div>
      <div class="stat-label">Tasks</div>
    </div>
    <div class="stat">
      <div class="stat-value">{stats.tcPassRate}</div>
      <div class="stat-label">TC Pass Rate</div>
    </div>
  </div>

  <div class="filters">
    <span class="filters-label">Filter:</span>
    <button class="filter-btn active" onclick="filterProjectAdventures('{slug}', 'all', this)">All</button>
    <button class="filter-btn" onclick="filterProjectAdventures('{slug}', 'active', this)">Active</button>
    <button class="filter-btn" onclick="filterProjectAdventures('{slug}', 'review', this)">Review</button>
    <button class="filter-btn" onclick="filterProjectAdventures('{slug}', 'planning', this)">Planning</button>
    <button class="filter-btn" onclick="filterProjectAdventures('{slug}', 'completed', this)">Completed</button>
    <button class="filter-btn" onclick="filterProjectAdventures('{slug}', 'concept', this)">Concept</button>
    <button class="filter-btn" onclick="filterProjectAdventures('{slug}', 'blocked', this)">Blocked</button>
    <button class="filter-btn" onclick="filterProjectAdventures('{slug}', 'cancelled', this)">Cancelled</button>
  </div>

  <div class="grid-section">
    <div class="adventure-grid">
```

If `adventures` is empty, output:
```html
      <p class="empty-state">No adventures in this project yet.</p>
```

Otherwise, for each adventure in the sorted list, output the same card+detail panel structure as below (card element followed by detail-panel element, both wrapped in `adventure-group`):

```html
      <div class="adventure-group" data-state="{state}">
        <div class="adventure-card" id="card-{id}" data-id="{id}" onclick="toggleDetail('{id}')">
          <div class="card-header">
            <div>
              <div class="card-id">{id}</div>
              <div class="card-title">{title}</div>
            </div>
            <span class="state-badge state-{state}">{state}</span>
          </div>
          <div class="progress-wrap">
            <div class="progress-label">
              <span>Progress</span>
              <span>{tcs.passed}/{tcs.total} TCs</span>
            </div>
            <div class="progress-bar-bg">
              <div class="progress-bar-fill" style="width:{pct}%"></div>
            </div>
          </div>
          <div class="card-footer">
            <span class="card-tasks">{taskIds.length} tasks</span>
            <span class="card-date">{created YYYY-MM-DD}</span>
          </div>
        </div>
        <div class="detail-panel" id="detail-{id}">
          <div class="tab-nav">
            <button class="tab-btn active" data-adv="{id}" data-tab="tasks" onclick="switchTab('{id}', 'tasks', this)">Tasks</button>
            <button class="tab-btn" data-adv="{id}" data-tab="docs" onclick="switchTab('{id}', 'docs', this)">Documents</button>
            <button class="tab-btn" data-adv="{id}" data-tab="metrics" onclick="switchTab('{id}', 'metrics', this)">Metrics</button>
            <button class="tab-btn" data-adv="{id}" data-tab="log" onclick="switchTab('{id}', 'log', this)">Log</button>
          </div>
          <div class="tab-content">
            <div class="tab-pane active" id="tab-{id}-tasks">
              {tasks tab content}
            </div>
            <div class="tab-pane" id="tab-{id}-docs">
              {docs tab content}
            </div>
            <div class="tab-pane" id="tab-{id}-metrics">
              {metrics tab content}
            </div>
            <div class="tab-pane" id="tab-{id}-log">
              {log tab content}
            </div>
          </div>
        </div>
      </div>
```

Where `pct = tcs.total > 0 ? Math.round(tcs.passed / tcs.total * 100) : 0`.

**Tasks tab content**: A `<table>` with columns: Task ID | Title | Stage | Status | Assignee | Iters | Created.

For each task in `adventure.tasks`:
```html
<table>
  <thead>
    <tr>
      <th>Task ID</th><th>Title</th><th>Stage</th><th>Status</th><th>Assignee</th><th>Iters</th><th>Created</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>{task.id}</td>
      <td>{task.title}</td>
      <td><span class="stage-badge stage-{task.stage}">{task.stage}</span></td>
      <td><span class="status-dot dot-{task.status}"></span>{task.status}</td>
      <td>{task.assignee || '-'}</td>
      <td>{task.iterations || 0}</td>
      <td>{task.created YYYY-MM-DD}</td>
    </tr>
  </tbody>
</table>
```

If no tasks: `<p class="empty-state">No tasks scanned for this adventure.</p>`

**Documents tab content**: For each category (designs, plans, schemas, roles, tests):
```html
<div class="doc-category">
  <div class="doc-category-title">Designs ({count})</div>
  {for each file: <div class="doc-file">{filename}</div>}
  {if count is 0: <span class="doc-empty">none</span>}
</div>
```

**Metrics tab content**: Show summary numbers and agent runs table:
```html
<div class="metrics-grid">
  <div class="metric-card">
    <div class="metric-value">{tokens_in formatted}</div>
    <div class="metric-label">Tokens In</div>
  </div>
  <div class="metric-card">
    <div class="metric-value">{tokens_out formatted}</div>
    <div class="metric-label">Tokens Out</div>
  </div>
  <div class="metric-card">
    <div class="metric-value">${cost}</div>
    <div class="metric-label">Cost</div>
  </div>
  <div class="metric-card">
    <div class="metric-value">{agent_runs}</div>
    <div class="metric-label">Agent Runs</div>
  </div>
</div>
```

Format token numbers as "45.2K" for thousands, "1.2M" for millions. If metrics is empty/missing: `<p class="empty-state">No metrics recorded.</p>`

If `metrics.runs` array is non-empty, follow with a table with columns: Agent | Task | Model | Tokens In | Tokens Out | Duration | Turns | Result.

**Log tab content**: Show up to last 20 log entries in reverse-chronological order (newest first):
```html
<div class="log-entry">
  <span class="log-ts">{timestamp}</span>
  <span class="log-agent">{agent}</span>
  <span class="log-msg">{message}</span>
</div>
```

If no log entries: `<p class="empty-state">No log entries found.</p>`

Close the adventure grid and project view:
```html
    </div><!-- adventure-grid -->
  </div><!-- grid-section -->
</div><!-- view-{slug} -->
```

Repeat the above structure for all 5 projects.

#### 9f. Agent Activity Section

After all project views (outside any `.project-view` div, always visible), output the Agent Activity table. Collect all `runs` entries from all adventures. Display the 30 most recent (sort by adventure `updated` descending):

```html
<div class="section">
  <div class="section-title">Agent Activity (all adventures)</div>
  <table>
    <thead>
      <tr>
        <th>Adventure</th>
        <th>Agent</th>
        <th>Task</th>
        <th>Model</th>
        <th>Tokens In</th>
        <th>Tokens Out</th>
        <th>Duration</th>
        <th>Turns</th>
        <th>Result</th>
      </tr>
    </thead>
    <tbody>
      {rows}
    </tbody>
  </table>
</div>
```

If no agent activity data: show `<p class="empty-state">No agent runs recorded.</p>` instead of the table.

#### 9g. Footer

```html
<div class="footer">
  Claudovka Command Center v2 &mdash; {totalAdventures} adventures &mdash; Generated {generatedAt}
</div>
```

#### 9h. Inline JavaScript

Embed all JS in a single `<script>` tag at the bottom of `<body>`:

```javascript
// Switch main project tab
function switchProject(projectId, btn) {
  document.querySelectorAll('.main-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.project-view').forEach(v => v.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('view-' + projectId).classList.add('active');
}

// Toggle adventure detail panel
function toggleDetail(id) {
  const card = document.getElementById('card-' + id);
  const panel = document.getElementById('detail-' + id);
  const isOpen = panel.classList.contains('open');
  // Close all open panels first
  document.querySelectorAll('.detail-panel.open').forEach(p => p.classList.remove('open'));
  document.querySelectorAll('.adventure-card.expanded').forEach(c => c.classList.remove('expanded'));
  // Open this one if it wasn't already open
  if (!isOpen) {
    panel.classList.add('open');
    card.classList.add('expanded');
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

// Switch tabs within a detail panel
function switchTab(advId, tabName, btn) {
  // Deactivate all tabs in this panel
  document.querySelectorAll('[data-adv="' + advId + '"]').forEach(b => b.classList.remove('active'));
  // Hide all panes in this panel
  ['tasks', 'docs', 'metrics', 'log'].forEach(t => {
    const pane = document.getElementById('tab-' + advId + '-' + t);
    if (pane) pane.classList.remove('active');
  });
  // Activate selected
  btn.classList.add('active');
  const pane = document.getElementById('tab-' + advId + '-' + tabName);
  if (pane) pane.classList.add('active');
}

// Filter adventures within a project view by state
function filterProjectAdventures(projectSlug, state, btn) {
  document.querySelectorAll('#view-' + projectSlug + ' .filter-btn')
    .forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('#view-' + projectSlug + ' .adventure-group')
    .forEach(group => {
      if (state === 'all' || group.dataset.state === state) {
        group.style.display = 'contents';
      } else {
        group.style.display = 'none';
      }
    });
}
```

Close body and html:
```html
</script>
</body>
</html>
```

### 10. Write Output

Write the complete generated HTML string to `.agent/dashboard.html`. If the file already exists, overwrite it.

### 11. Report Stats

After writing the file, report to the user:

```
Command Center generated at .agent/dashboard.html

Adventures scanned:   {totalAdventures}
Tasks scanned:        {totalTasks}
Active adventures:    {activeCount}
Total cost tracked:   {totalCost}
Projects classified:  {pipeline-dsl: N, team-mcp: N, team-pipeline: N, binartlab: N, marketplace: N, unassigned: N}

Open the file in a browser to view.
```

If the optional `--open` argument was provided (i.e., `$ARGUMENTS` contains `--open`), attempt to open the file:
- On Windows: use `start .agent/dashboard.html`
- On macOS: use `open .agent/dashboard.html`
- On Linux: use `xdg-open .agent/dashboard.html`
