# Init-Roles Skill Design

**Date:** 2026-02-10
**Status:** DRAFT
**Depends on:** `docs/designs/roles-design.md`, `docs/designs/controller-design.md`, `docs/concepts/init-roles.md`

---

## Overview

`init-roles` is an interactive skill that analyzes a project's tech stack and structure, recommends a set of roles from `roles/templates/`, and instantiates them into `.agent/roles/` with optional per-field overrides. It bridges the gap between generic plugin-level role templates and project-specific agent configurations, writing the `active_roles`, `stage_assignments`, and related metadata to `.agent/config.md` so the controller can resolve agents at runtime. It supports first-run setup, incremental add/remove, and template sync for keeping instances aligned with evolving templates.

---

## Decisions

| Question | Decision | Rationale |
|----------|----------|-----------|
| Mandatory roles | planner + reviewer are always RECOMMENDED, not enforced | Per roles-design.md, no mandatory roles. Any valid combination works. The skill pre-checks these two but the user can deselect them. A project with only `coder` + `code-reviewer` is valid. |
| Role dependencies (auto-install skills) | Warn and suggest `init-skills`. Do not auto-install. | Keeps concerns separated. `init-roles` manages roles, `init-skills` manages skills. Auto-installing creates hidden side effects. The warning is actionable: "coder requires skills [testing, linting]. Run /init-skills to install missing skills." |
| Team size presets | Yes: solo (3 roles), team (5 roles), full (all applicable) | Presets reduce decision fatigue on first run. The user customizes after selecting a preset. Presets are a starting point, not a constraint. |
| Project type detection accuracy | Best-effort heuristics + user override | File-based heuristics are reliable for common stacks. Edge cases (monorepos, polyglot projects) get a "detected: X -- is this correct?" prompt. The user always confirms or overrides. |
| Multiple instances of same role | Yes, with suffix: `coder-frontend.md` | Per roles-design.md. The user provides the suffix during `--add`. Each instance has its own overrides and appears independently in `active_roles` and `stage_assignments`. |

---

## Project Analysis Heuristics

### File Signals to Project Type

| Signal Files | Project Type |
|-------------|-------------|
| `package.json` + (`react` or `next` or `vue` or `svelte` or `angular` in dependencies) | `frontend` |
| `package.json` + (`express` or `fastify` or `koa` or `hono` in dependencies) | `backend-node` |
| `package.json` + frontend framework + backend framework | `fullstack` |
| `requirements.txt` or `pyproject.toml` or `setup.py` | `python` |
| `Cargo.toml` | `rust` |
| `go.mod` | `go` |
| `pom.xml` or `build.gradle` or `build.gradle.kts` | `java` |
| `Dockerfile` + `docker-compose.yml` (no application framework detected) | `infra` |
| `src/` + `tests/` + no frontend framework detected | `backend-generic` |
| None of the above | `unknown` |

Detection is greedy: check in order, first match wins. For `fullstack`, both frontend and backend signals must be present in the same `package.json`. If signals point to multiple types (e.g., `package.json` with React AND a `requirements.txt` for a Python backend), the skill lists all detected types and asks the user to pick one or confirm "multi" which maps to `fullstack`.

### Project Type to Recommended Roles

| Project Type | Recommended Roles |
|-------------|------------------|
| `frontend` | planner, coder, code-reviewer, ux-designer, researcher |
| `backend-node` | planner, coder, code-reviewer, qa-tester, researcher |
| `backend-generic` | planner, coder, code-reviewer, qa-tester, researcher |
| `fullstack` | planner, coder, code-reviewer, ux-designer, qa-tester, researcher |
| `python` | planner, coder, code-reviewer, qa-tester, researcher |
| `rust` | planner, coder, code-reviewer, qa-tester, researcher |
| `go` | planner, coder, code-reviewer, qa-tester, researcher |
| `java` | planner, coder, code-reviewer, qa-tester, researcher |
| `infra` | planner, devops, code-reviewer, researcher |
| `unknown` | planner, implementer, reviewer, researcher |

The `unknown` type falls back to the original four agents. The recommendations populate the preset selection in the interactive flow.

---

## Presets

### Preset Definitions

| Preset | Roles Included | Purpose |
|--------|---------------|---------|
| `solo` | planner, implementer, reviewer | Minimal set. Same as legacy `agents/` directory. One role per core stage. |
| `team` | planner, coder, code-reviewer, researcher + 1 project-type-specific role | Extended set. Replaces generic implementer/reviewer with specialized coder/code-reviewer. Adds researcher for knowledge extraction. |
| `full` | All roles recommended for the detected project type | Complete coverage. Every applicable role is instantiated. |

### Preset Contents by Project Type

| Project Type | solo | team | full |
|-------------|------|------|------|
| `frontend` | planner, implementer, reviewer | planner, coder, code-reviewer, researcher, ux-designer | planner, coder, code-reviewer, researcher, ux-designer, designer, qa-tester |
| `backend-node` | planner, implementer, reviewer | planner, coder, code-reviewer, researcher, qa-tester | planner, coder, code-reviewer, researcher, qa-tester, devops, designer |
| `backend-generic` | planner, implementer, reviewer | planner, coder, code-reviewer, researcher, qa-tester | planner, coder, code-reviewer, researcher, qa-tester, devops, designer |
| `fullstack` | planner, implementer, reviewer | planner, coder, code-reviewer, researcher, ux-designer | planner, coder, code-reviewer, researcher, ux-designer, qa-tester, designer, devops |
| `python` | planner, implementer, reviewer | planner, coder, code-reviewer, researcher, qa-tester | planner, coder, code-reviewer, researcher, qa-tester, devops, designer |
| `rust` | planner, implementer, reviewer | planner, coder, code-reviewer, researcher, qa-tester | planner, coder, code-reviewer, researcher, qa-tester, devops |
| `go` | planner, implementer, reviewer | planner, coder, code-reviewer, researcher, qa-tester | planner, coder, code-reviewer, researcher, qa-tester, devops |
| `java` | planner, implementer, reviewer | planner, coder, code-reviewer, researcher, qa-tester | planner, coder, code-reviewer, researcher, qa-tester, devops |
| `infra` | planner, implementer, reviewer | planner, devops, code-reviewer, researcher, qa-tester | planner, devops, code-reviewer, researcher, qa-tester, designer |
| `unknown` | planner, implementer, reviewer | planner, coder, code-reviewer, researcher, implementer | planner, coder, code-reviewer, researcher, implementer, reviewer, qa-tester |

The `solo` preset is identical across all project types -- it always uses the three base roles. The `team` preset adds the project-type-specific role as the 5th role. The `full` preset includes all roles from the recommendation table plus additional applicable roles.

---

## Interactive Flow

### First Run (no `.agent/roles/` exists)

**Step 1: Check prerequisites**

```
Read .agent/ directory.
If .agent/ does not exist:
  "No .agent/ directory found. Run /task-init first."
  STOP.
If .agent/roles/ already exists and contains .md files:
  Enter UPDATE MODE (see Update/Sync Mechanism).
```

**Step 2: Analyze project**

```
Analyzing project...

Detected signals:
  - package.json (found)
  - Dependencies: react 18.2, next 14.0
  - src/ directory with components/
  - tests/ directory

Project type: frontend

Is this correct? [yes / override]
```

If the user types an override, present the list of valid project types and let them pick:

```
Available project types:
  1. frontend
  2. backend-node
  3. backend-generic
  4. fullstack
  5. python
  6. rust
  7. go
  8. java
  9. infra

Select project type [1-9]:
```

**Step 3: Select preset**

```
Select a role preset:

  solo  - 3 roles: planner, implementer, reviewer
          Minimal setup, same as default pipeline agents.

  team  - 5 roles: planner, coder, code-reviewer, researcher, ux-designer
          Extended team with project-specific roles.

  full  - 7 roles: planner, coder, code-reviewer, researcher, ux-designer, designer, qa-tester
          Full coverage for frontend project.

Preset [solo/team/full]:
```

**Step 4: Customize selection**

After the user picks a preset, show the selected roles with checkboxes:

```
Selected roles (team preset for frontend):

  [x] planner          opus    planning
  [x] coder            sonnet  implementing, fixing
  [x] code-reviewer    opus    reviewing
  [x] researcher       haiku   researching
  [x] ux-designer      sonnet  planning

Available but not selected:
  [ ] implementer      sonnet  implementing, fixing
  [ ] reviewer         opus    reviewing
  [ ] designer         opus    planning
  [ ] qa-tester        sonnet  reviewing
  [ ] devops           sonnet  implementing, fixing

Add or remove roles? [enter to continue / +role / -role]
```

The user can type `+qa-tester` to add or `-ux-designer` to remove. Entering nothing accepts the current selection.

**Step 5: Per-role overrides (optional)**

```
Customize any role before instantiation? [enter to skip / role-name]
```

If the user types a role name:

```
Customizing: coder

  model:    sonnet   [sonnet/opus/haiku]  ->
  maxTurns: 50       [number]             ->
  tools:    Read, Glob, Grep, Write, Edit, Bash
            Remove any? [tool-name / enter to keep]
  knowledge: patterns, decisions, conventions
            Add project-specific? [name / enter to keep]

Changes to coder:
  (none)

Customize another role? [enter to skip / role-name]
```

If the user changes a field:

```
Customizing: coder

  model: sonnet -> haiku

Changes to coder:
  model: sonnet -> haiku (will be tracked in overrides)

Customize another role? [enter to skip / role-name]
```

**Step 6: Stage assignments**

Generate `stage_assignments` automatically from the selected roles. When multiple roles serve the same stage, ask the user:

```
Stage assignments (auto-generated):

  planning:      planner
  implementing:  coder
  reviewing:     code-reviewer
  fixing:        coder
  researching:   researcher

Note: ux-designer also serves "planning" but planner is assigned.
      ux-designer is available for tag-based routing by the controller.

Accept stage assignments? [yes / edit]
```

If the user types `edit`:

```
Editing stage assignments:

  planning [planner]:      -> (enter role name or keep)
  implementing [coder]:    ->
  reviewing [code-reviewer]: ->
  fixing [coder]:          ->
  researching [researcher]: ->
```

**Step 7: Skill dependency check**

```
Checking skill dependencies...

  coder requires: testing, linting
  code-reviewer requires: linting

  testing   - available
  linting   - NOT INSTALLED

Warning: 1 missing skill. Run /init-skills after setup to install.

Continue anyway? [yes/no]
```

**Step 8: Confirmation and write**

```
Ready to initialize roles:

  Directory: .agent/roles/
  Roles:     planner, coder, code-reviewer, researcher, ux-designer
  Overrides: coder (model: haiku)
  Project:   frontend
  Preset:    team

Proceed? [yes/no]
```

On `yes`:

```
Creating .agent/roles/
  - planner.md          (from template: planner)
  - coder.md            (from template: coder, overrides: model)
  - code-reviewer.md    (from template: code-reviewer)
  - researcher.md       (from template: researcher)
  - ux-designer.md      (from template: ux-designer)

Updating .agent/config.md
  - active_roles: [planner, coder, code-reviewer, researcher, ux-designer]
  - stage_assignments: {planning: planner, implementing: coder, reviewing: code-reviewer, fixing: coder, researching: researcher}
  - project_type: frontend
  - roles_initialized: 2026-02-10T14:00:00Z
  - roles_plugin_version: 0.1.0

Roles initialized. 5 roles active.
Run /init-skills to install missing skills (linting).
```

---

## Role Instantiation Process

When a role is instantiated from a template, the following steps occur in order:

### Step 1: Read Template

Read `roles/templates/{template-name}.md` from the plugin directory. Parse YAML frontmatter and markdown body (system prompt).

### Step 2: Resolve Inheritance

If the template has `inherits: {parent-name}`:

1. Read `roles/templates/{parent-name}.md`.
2. Validate: parent must exist, max depth is 2 levels, no cycles.
3. Merge: start with parent fields, then overlay child fields.
4. For list fields (`tools`, `disallowedTools`, `skills`, `knowledge`, `pipeline_stages`): child list replaces parent list entirely.
5. For the system prompt body: child body replaces parent body entirely.

Result is the "resolved template" -- the fully-merged field set.

### Step 3: Apply User Overrides

For each field the user changed during customization:

1. Replace the resolved template value with the user-specified value.
2. Add the field name to the `overrides` list.

If the user changed the system prompt body, add `system_prompt` to the `overrides` list.

### Step 4: Set Instance Metadata

Add instance-specific fields to the frontmatter:

```yaml
source_template: coder              # Template this was created from
template_version: 0.1.0             # Plugin version at instantiation time
overrides:                           # Fields the user intentionally changed
  - model
```

These fields are NOT present in the template -- they are added by `init-roles` during instantiation.

### Step 5: Write Instance File

Write the complete role instance to `.agent/roles/{role-name}.md`:

```yaml
---
name: coder
description: >
  Implements features and fixes with emphasis on code quality,
  testing, and adherence to project conventions.
source_template: coder
template_version: 0.1.0
inherits: implementer
model: haiku
maxTurns: 50
memory: project
tools: [Read, Glob, Grep, Write, Edit, Bash]
disallowedTools: []
skills: [testing, linting]
knowledge: [patterns, decisions, conventions]
pipeline_stages: [implementing, fixing]
overrides:
  - model
---

# System Prompt

(Full system prompt text from resolved template, or user-overridden version)
```

### Step 6: Update config.md

Merge the following fields into `.agent/config.md` frontmatter. Existing fields (like `build_command`, `test_command`, `max_iterations`) are preserved.

```yaml
active_roles:
  - planner
  - coder
  - code-reviewer
  - researcher
  - ux-designer
stage_assignments:
  planning: planner
  implementing: coder
  reviewing: code-reviewer
  fixing: coder
  researching: researcher
project_type: frontend
roles_initialized: 2026-02-10T14:00:00Z
roles_plugin_version: 0.1.0
```

The `active_roles` list contains every role instance filename (without `.md`). The `stage_assignments` map assigns exactly one role per pipeline stage. Roles that serve a stage but are not assigned (like `ux-designer` for `planning`) remain available for tag-based controller routing but are not the default.

---

## Update/Sync Mechanism

Running `init-roles --sync` (or running `init-roles` when `.agent/roles/` already exists and choosing "sync") compares each instance against its source template.

### Sync Process

**Step 1: Inventory**

```
Read all .md files in .agent/roles/ (excluding .archive/).
For each file, read source_template and template_version from frontmatter.
Files with no source_template are custom roles -- skip them.
```

**Step 2: Compare**

For each instance with a `source_template`:

1. Read `roles/templates/{source_template}.md`.
2. Resolve inheritance (same as instantiation).
3. Compare each frontmatter field between the resolved template and the instance.
4. Skip fields listed in the instance's `overrides` -- these are intentionally different.
5. Record diffs for fields that changed in the template but were not user-overridden.

**Step 3: Present Diffs**

```
Syncing roles against templates (plugin version 0.2.0)...

coder.md (template_version: 0.1.0 -> 0.2.0):
  model: haiku (local override, keeping)
  maxTurns: 50 -> 60 (template updated)
    Accept? [y/n]
  skills: [testing, linting] -> [testing, linting, formatting] (template updated)
    Accept? [y/n]

code-reviewer.md (template_version: 0.1.0 -> 0.2.0):
  No changes.

planner.md (template_version: 0.1.0 -> 0.2.0):
  System prompt updated (8 lines changed).
    View diff? [y/n]
    Accept? [y/n]

researcher.md (template_version: 0.1.0 -> 0.2.0):
  No changes.

ux-designer.md (template_version: 0.1.0 -> 0.2.0):
  knowledge: [patterns, conventions] -> [patterns, conventions, decisions] (template updated)
    Accept? [y/n]
```

**Step 4: Apply Accepted Changes**

For each accepted change:

1. Update the field in the instance file.
2. Update `template_version` to the current plugin version.
3. Write the instance file.

For rejected changes:

1. Add the field to the `overrides` list (the user is now intentionally diverging).
2. Update `template_version` to the current plugin version.
3. Write the instance file.

**Step 5: Report**

```
Sync complete:
  - coder.md: 1 accepted, 1 rejected (skills added to overrides)
  - planner.md: 1 accepted (system prompt)
  - ux-designer.md: 1 accepted
  - code-reviewer.md: no changes
  - researcher.md: no changes

All roles now at template_version: 0.2.0
```

### Handling New and Removed Templates

If the plugin added new templates since the last sync:

```
New templates available since 0.1.0:
  - data-engineer (serves: implementing, fixing)

Add any? [+data-engineer / enter to skip]
```

If the plugin removed a template that an instance references:

```
Warning: template "legacy-role" no longer exists in plugin.
  Instance .agent/roles/legacy-role.md is now a custom role (no future sync).
  source_template field will be cleared.
```

---

## Add/Remove Operations

### `init-roles --add {role-name}`

Adds a new role to an existing `.agent/roles/` setup.

**Flow:**

```
> /init-roles --add qa-tester

Reading template: qa-tester
  Model:    sonnet
  Stages:   reviewing
  Skills:   testing
  Inherits: reviewer

Customize before adding? [enter to skip / yes]
```

If `yes`, show the same per-role override flow as first-run Step 5.

```
Adding qa-tester to .agent/roles/...

  Created: .agent/roles/qa-tester.md

Updating .agent/config.md:
  active_roles: added qa-tester
  stage_assignments: qa-tester serves "reviewing" but code-reviewer is already assigned.
    Reassign reviewing to qa-tester? [y/n]
```

If the user says yes, update `stage_assignments.reviewing` to `qa-tester`. If no, `qa-tester` is active but not the default for any stage (available for tag-based routing).

**Adding a named variant:**

```
> /init-roles --add coder-frontend

Template "coder-frontend" not found. Did you mean to create a variant of "coder"?
Base template [coder / other]: coder

Creating variant: coder-frontend (based on coder template)

Customize before adding? [enter to skip / yes]
```

The variant is instantiated with `source_template: coder` and `name: coder-frontend`. The filename is `coder-frontend.md`.

### `init-roles --remove {role-name}`

Removes a role from the active set.

**Flow:**

```
> /init-roles --remove ux-designer

Removing ux-designer...

  Moving: .agent/roles/ux-designer.md -> .agent/roles/.archive/ux-designer.md

Updating .agent/config.md:
  active_roles: removed ux-designer
  stage_assignments: ux-designer was not assigned to any stage. No changes needed.

Role removed. 4 roles active.
```

If the role is assigned to a stage:

```
> /init-roles --remove code-reviewer

Warning: code-reviewer is assigned to stage "reviewing".

Removing will leave the reviewing stage unassigned.
Options:
  1. Reassign reviewing to reviewer (available, serves reviewing)
  2. Reassign reviewing to qa-tester (available, serves reviewing)
  3. Remove anyway (stage will have no assigned role)

Choice [1/2/3]:
```

The `.archive/` directory is created inside `.agent/roles/` on first remove. Archived roles retain all their content and can be manually restored by moving them back.

---

## Config.md Extensions

`init-roles` writes the following fields to the YAML frontmatter of `.agent/config.md`. These fields coexist with existing fields (`build_command`, `test_command`, `max_iterations`, etc.).

### Schema

```yaml
---
# ... existing fields ...
build_command: npm run build
test_command: npm test
max_iterations: 3

# === Roles Configuration (written by init-roles) ===
active_roles:
  - planner
  - coder
  - code-reviewer
  - researcher
  - ux-designer
stage_assignments:
  planning: planner
  implementing: coder
  reviewing: code-reviewer
  fixing: coder
  researching: researcher
project_type: frontend
roles_initialized: 2026-02-10T14:00:00Z
roles_plugin_version: 0.1.0
---

# Project Pipeline Configuration

Edit the frontmatter above to match your project's build and test commands.
```

### Field Reference

| Field | Type | Written By | Read By | Description |
|-------|------|-----------|---------|-------------|
| `active_roles` | list[string] | init-roles | controller | Names of all active role instances. Matches filenames in `.agent/roles/` without `.md`. |
| `stage_assignments` | map[string, string] | init-roles | controller | Maps each pipeline stage to exactly one role name. The controller uses this as the single source of truth for stage routing. |
| `project_type` | string | init-roles | init-roles (sync) | Detected or user-specified project type. Used for recommendations on subsequent runs. |
| `roles_initialized` | datetime (ISO 8601) | init-roles | init-roles (sync) | Timestamp of the first `init-roles` run. Set once, never updated. |
| `roles_plugin_version` | string | init-roles | init-roles (sync) | Plugin version at last `init-roles` run. Used to detect template updates during `--sync`. |

### Interaction with Controller

The controller reads `stage_assignments` and `active_roles` from `config.md` to resolve which agent to spawn. Per the controller design:

- `stage_assignments` is the single source of truth for routing.
- The controller reads `.agent/roles/{assigned-role}.md` for agent frontmatter.
- If `.agent/roles/` does not exist, the controller falls back to `agents/` directory with the hardcoded stage-to-agent map.

`init-roles` never writes to `.agent/controller-state.md`. The controller manages its own state independently.

---

## SKILL.md Specification

The actual skill file at `skills/init-roles/SKILL.md`:

```yaml
---
name: init-roles
description: Initialize and manage project-specific roles from templates. Analyzes project type, recommends roles, instantiates to .agent/roles/ with optional overrides.
disable-model-invocation: true
argument-hint: "[--sync | --add <role> | --remove <role>]"
---
```

```markdown
# Initialize Roles

Create, update, and manage project-specific role instances from plugin templates.

## Arguments

Parse `$ARGUMENTS` for the operation mode:
- (empty): First-run setup or interactive update
- `--sync`: Compare instances against templates and apply updates
- `--add <role-name>`: Add a single role to the project
- `--remove <role-name>`: Remove a role from the project

## Steps: Default Mode (no arguments)

1. Check that `.agent/` exists. If not, tell the user to run `/task-init` first and STOP.

2. Check if `.agent/roles/` exists and contains `.md` files.
   - If yes: tell the user "Roles already initialized. Use --sync, --add, or --remove." List current active roles from `.agent/config.md` `active_roles`. STOP.
   - If no: continue to first-run setup.

3. Analyze the project to detect project type:
   - Read `package.json` (if exists) for framework dependencies.
   - Read `requirements.txt`, `pyproject.toml`, `setup.py` (if exist).
   - Read `Cargo.toml`, `go.mod`, `pom.xml`, `build.gradle` (if exist).
   - Check for `Dockerfile`, `docker-compose.yml`.
   - Check for `src/`, `tests/` directories.
   - Apply the heuristics table from the design doc to determine project type.
   - Show the detected type and signals. Ask the user to confirm or override.

4. Present preset options based on detected project type:
   - `solo`: planner, implementer, reviewer
   - `team`: planner, coder, code-reviewer, researcher + project-type-specific role
   - `full`: all applicable roles for the detected type
   - Show role names, models, and pipeline stages for each preset.
   - Ask the user to select a preset.

5. Show selected roles with toggle interface:
   - List selected roles with `[x]` prefix.
   - List available but unselected roles with `[ ]` prefix.
   - Accept `+role-name` to add, `-role-name` to remove.
   - Enter to continue.

6. Ask if the user wants to customize any role:
   - For each role the user names, show: model, maxTurns, tools, knowledge.
   - Accept changes. Track changed fields for the `overrides` list.
   - Enter to skip.

7. Generate stage assignments from selected roles:
   - For each pipeline stage, pick the first role whose `pipeline_stages` includes that stage.
   - Priority order: specialized roles before generic ones (coder before implementer, code-reviewer before reviewer).
   - If multiple roles serve the same stage, note the unassigned ones.
   - Show assignments and ask user to accept or edit.

8. Check skill dependencies:
   - For each selected role, read its `skills` field.
   - Check which skills are available in the plugin.
   - Warn about missing skills. Suggest running `/init-skills`.

9. Show final confirmation:
   - List all roles to be created, any overrides, stage assignments.
   - Ask for confirmation.

10. On confirmation:
    - Create `.agent/roles/` directory.
    - For each selected role:
      a. Read the template from `roles/templates/{name}.md`.
      b. Resolve inheritance if `inherits` is set.
      c. Apply any user overrides.
      d. Add `source_template`, `template_version`, and `overrides` fields.
      e. Write to `.agent/roles/{name}.md`.
    - Update `.agent/config.md` frontmatter with:
      `active_roles`, `stage_assignments`, `project_type`, `roles_initialized`, `roles_plugin_version`.
    - Report results.

## Steps: --sync Mode

1. Check `.agent/roles/` exists. If not, tell user to run `init-roles` first. STOP.

2. Read all `.md` files in `.agent/roles/` (exclude `.archive/`).

3. For each file with a `source_template` field:
   a. Read the corresponding template from `roles/templates/`.
   b. Resolve inheritance.
   c. Compare each frontmatter field.
   d. Skip fields in the instance's `overrides` list.
   e. Collect diffs.

4. If no diffs found across all roles, report "All roles up to date." STOP.

5. Present diffs per role, one field at a time:
   - Show field name, old value, new value.
   - Ask user to accept or reject each change.
   - Accepted: update field in instance.
   - Rejected: add field to `overrides` list.

6. Update `template_version` in every synced instance to current plugin version.

7. Write updated instance files. Report summary.

## Steps: --add Mode

1. Parse role name from `$ARGUMENTS`.

2. Check if `roles/templates/{role-name}.md` exists.
   - If not: check if the name contains a hyphen (e.g., `coder-frontend`). Extract the base name before the last hyphen. If that template exists, treat as a named variant.
   - If still not found: list available templates and STOP.

3. Show template summary (model, stages, skills, inherits).

4. Ask if user wants to customize before adding. Apply overrides if yes.

5. Instantiate: read template, resolve inheritance, apply overrides, write to `.agent/roles/{role-name}.md`.

6. Update `.agent/config.md`:
   - Add to `active_roles`.
   - Check if any of the role's `pipeline_stages` are unassigned or if user wants to reassign. Update `stage_assignments` accordingly.

7. Report result.

## Steps: --remove Mode

1. Parse role name from `$ARGUMENTS`.

2. Check if `.agent/roles/{role-name}.md` exists. If not, list active roles and STOP.

3. Check if the role is assigned to any stage in `stage_assignments`.
   - If yes: warn the user. List other roles that serve the same stage. Ask to reassign or remove anyway.

4. Create `.agent/roles/.archive/` if it does not exist.

5. Move `.agent/roles/{role-name}.md` to `.agent/roles/.archive/{role-name}.md`.

6. Update `.agent/config.md`:
   - Remove from `active_roles`.
   - Remove from `stage_assignments` (or reassign per user choice).

7. Report result.
```
