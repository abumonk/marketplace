---
name: init-roles
description: Initialize and manage project-specific roles from templates. Analyzes project type, recommends roles, instantiates to .agent/roles/ with optional overrides.
disable-model-invocation: true
argument-hint: "[--sync | --add <role> | --remove <role>]"
---

# Initialize Roles

Create, update, and manage project-specific role instances from plugin templates.

## Arguments

Parse `$ARGUMENTS` for the operation mode:
- (empty): First-run setup or interactive update
- `--sync`: Compare instances against templates and apply updates
- `--add <role-name>`: Add a single role to the project
- `--remove <role-name>`: Remove a role from the project

## Steps: Default Mode (no arguments)

### 1. Check Prerequisites

Check that `.agent/` exists. If not, tell the user to run `/task-init` first and STOP.

### 2. Check Existing Roles

Check if `.agent/roles/` exists and contains `.md` files.
- If yes: tell the user "Roles already initialized. Use --sync, --add, or --remove." List current active roles from `.agent/config.md` `active_roles`. STOP.
- If no: continue to first-run setup.

### 3. Analyze Project Type

Detect the project type by checking for signal files in this order (first match wins):

| Signal Files | Project Type |
|-------------|-------------|
| `package.json` with `react` or `next` or `vue` or `svelte` or `angular` in dependencies | `frontend` |
| `package.json` with `express` or `fastify` or `koa` or `hono` in dependencies | `backend-node` |
| `package.json` with BOTH frontend framework AND backend framework | `fullstack` |
| `requirements.txt` or `pyproject.toml` or `setup.py` | `python` |
| `Cargo.toml` | `rust` |
| `go.mod` | `go` |
| `pom.xml` or `build.gradle` or `build.gradle.kts` | `java` |
| `Dockerfile` + `docker-compose.yml` (no application framework detected) | `infra` |
| `src/` + `tests/` (no frontend framework detected) | `backend-generic` |
| None of the above | `unknown` |

Detection steps:
- Glob for `package.json`. If found, read it and check `dependencies` and `devDependencies` for framework names.
- Glob for `requirements.txt`, `pyproject.toml`, `setup.py`.
- Glob for `Cargo.toml`, `go.mod`, `pom.xml`, `build.gradle`, `build.gradle.kts`.
- Glob for `Dockerfile`, `docker-compose.yml`.
- Glob for `src/`, `tests/`.

If signals point to multiple types (e.g., package.json with React AND a requirements.txt), list all detected types and ask the user to pick one or confirm "fullstack".

Show the detected type and signals. Ask the user to confirm or override:
```
Detected signals:
  - {file} (found)
  - Dependencies: {list}

Project type: {type}

Is this correct? [yes / override]
```

If override, present the list: frontend, backend-node, backend-generic, fullstack, python, rust, go, java, infra.

### 4. Present Preset Options

Show three presets based on the detected project type:

**Preset contents by project type:**

| Project Type | solo | team | full |
|-------------|------|------|------|
| `frontend` | planner, implementer, reviewer | lead, planner, coder, code-reviewer, researcher, ux-designer | lead, planner, coder, code-reviewer, researcher, ux-designer, designer, qa-tester |
| `backend-node` | planner, implementer, reviewer | lead, planner, coder, code-reviewer, researcher, qa-tester | lead, planner, coder, code-reviewer, researcher, qa-tester, devops, designer |
| `backend-generic` | planner, implementer, reviewer | lead, planner, coder, code-reviewer, researcher, qa-tester | lead, planner, coder, code-reviewer, researcher, qa-tester, devops, designer |
| `fullstack` | planner, implementer, reviewer | lead, planner, coder, code-reviewer, researcher, ux-designer | lead, planner, coder, code-reviewer, researcher, ux-designer, qa-tester, designer, devops |
| `python` | planner, implementer, reviewer | lead, planner, coder, code-reviewer, researcher, qa-tester | lead, planner, coder, code-reviewer, researcher, qa-tester, devops, designer |
| `rust` | planner, implementer, reviewer | lead, planner, coder, code-reviewer, researcher, qa-tester | lead, planner, coder, code-reviewer, researcher, qa-tester, devops |
| `go` | planner, implementer, reviewer | lead, planner, coder, code-reviewer, researcher, qa-tester | lead, planner, coder, code-reviewer, researcher, qa-tester, devops |
| `java` | planner, implementer, reviewer | lead, planner, coder, code-reviewer, researcher, qa-tester | lead, planner, coder, code-reviewer, researcher, qa-tester, devops |
| `infra` | planner, implementer, reviewer | lead, planner, devops, code-reviewer, researcher, qa-tester | lead, planner, devops, code-reviewer, researcher, qa-tester, designer |
| `unknown` | planner, implementer, reviewer | lead, planner, coder, code-reviewer, researcher, implementer | lead, planner, coder, code-reviewer, researcher, implementer, reviewer, qa-tester |

Display format:
```
Select a role preset:

  solo  - {count} roles: {list}
          Minimal setup, same as default pipeline agents.

  team  - {count} roles: {list}
          Extended team with project-specific roles.

  full  - {count} roles: {list}
          Full coverage for {project_type} project.

Preset [solo/team/full]:
```

### 5. Customize Selection

Show selected roles with toggle interface:
```
Selected roles ({preset} preset for {project_type}):

  [x] {role}    {model}    {stages}
  ...

Available but not selected:
  [ ] {role}    {model}    {stages}
  ...

Add or remove roles? [enter to continue / +role / -role]
```

Accept `+role-name` to add or `-role-name` to remove. Enter to continue.

### 6. Per-Role Overrides (optional)

Ask: `Customize any role before instantiation? [enter to skip / role-name]`

If the user names a role, show its fields:
```
Customizing: {role}

  model:    {value}   [sonnet/opus/haiku]  ->
  maxTurns: {value}   [number]             ->
  tools:    {list}
            Remove any? [tool-name / enter to keep]
  knowledge: {list}
            Add project-specific? [name / enter to keep]
```

Track changed fields for the `overrides` list. Repeat for each role the user wants to customize.

### 7. Generate Stage Assignments

Auto-generate `stage_assignments` from selected roles. Priority order: specialized roles before generic ones (coder before implementer, code-reviewer before reviewer).

For each pipeline stage, pick the first role whose `pipeline_stages` includes that stage:
- planning: prefer planner, then designer, then ux-designer
- implementing: prefer coder, then implementer, then devops
- reviewing: prefer code-reviewer, then reviewer, then qa-tester
- fixing: prefer coder, then implementer, then devops
- researching: prefer researcher

Show assignments:
```
Stage assignments (auto-generated):

  planning:      {role}
  implementing:  {role}
  reviewing:     {role}
  fixing:        {role}
  researching:   {role}

{Note any roles that serve a stage but are not assigned.}

Accept stage assignments? [yes / edit]
```

If edit, let the user reassign each stage.

### 8. Skill Dependency Check

For each selected role, read its `skills` field from the template.
Check which skills are available (Glob for `skills/*/SKILL.md` in plugin directories).

Report:
```
Checking skill dependencies...

  {role} requires: {skills}

  {skill}   - available
  {skill}   - NOT INSTALLED

Warning: {n} missing skill(s). Run /init-skills after setup to install.

Continue anyway? [yes/no]
```

### 9. Confirmation

Show final summary:
```
Ready to initialize roles:

  Directory: .agent/roles/
  Roles:     {list}
  Overrides: {role} ({fields})
  Project:   {project_type}
  Preset:    {preset}

Proceed? [yes/no]
```

### 10. Write

On confirmation:

a. Create `.agent/roles/` directory.

b. For each selected role:
   1. Read the template from `roles/templates/{name}.md` (using `${CLAUDE_PLUGIN_ROOT}/roles/templates/{name}.md`).
   2. If the template has `inherits: {parent}`, read the parent template. Merge: start with parent fields, then overlay child fields. For list fields (tools, disallowedTools, skills, knowledge, pipeline_stages) the child list replaces the parent list entirely. The child system prompt body replaces the parent body entirely.
   3. Apply any user overrides from step 6. Replace the field value with the user-specified value.
   4. Add instance metadata fields:
      - `source_template: {template-name}`
      - `template_version: 0.1.0`
      - `overrides: [{list of changed field names}]` (empty list if no overrides)
   5. Write the complete role instance to `.agent/roles/{name}.md`.

c. Update `.agent/config.md` frontmatter (preserve existing fields, merge new):
   ```yaml
   active_roles:
     - {role1}
     - {role2}
     - ...
   stage_assignments:
     planning: {role}
     implementing: {role}
     reviewing: {role}
     fixing: {role}
     researching: {role}
   project_type: {detected_type}
   roles_initialized: {ISO 8601 timestamp}
   roles_plugin_version: 0.1.0
   ```

d. Report results:
```
Creating .agent/roles/
  - {name}.md    (from template: {template}, overrides: {fields or none})
  ...

Updating .agent/config.md
  - active_roles: [{list}]
  - stage_assignments: {map}
  - project_type: {type}

Roles initialized. {count} roles active.
{If missing skills: "Run /init-skills to install missing skills ({list})."}
```

## Steps: --sync Mode

### 1. Check Prerequisites

Check `.agent/roles/` exists and contains `.md` files. If not, tell user to run `init-roles` first. STOP.

### 2. Inventory Instances

Read all `.md` files in `.agent/roles/` (exclude `.archive/` directory).
For each file, read `source_template` and `template_version` from frontmatter.
Files with no `source_template` are custom roles -- skip them.

### 3. Compare Against Templates

For each instance with a `source_template`:
1. Read `${CLAUDE_PLUGIN_ROOT}/roles/templates/{source_template}.md`.
2. If the template has `inherits`, resolve inheritance (same as instantiation).
3. Compare each frontmatter field between the resolved template and the instance.
4. Skip fields listed in the instance's `overrides` list -- these are intentionally different.
5. Record diffs for fields that changed in the template but were not user-overridden.

### 4. Present Diffs

If no diffs found across all roles, report "All roles up to date." STOP.

For each role with diffs:
```
{name}.md (template_version: {old} -> {new}):
  {field}: {old_value} (local override, keeping)
  {field}: {old_value} -> {new_value} (template updated)
    Accept? [y/n]
```

If the system prompt body changed:
```
  System prompt updated ({n} lines changed).
    View diff? [y/n]
    Accept? [y/n]
```

### 5. Apply Changes

For each accepted change: update the field in the instance file.
For each rejected change: add the field to the `overrides` list.
Update `template_version` to the current plugin version in every synced instance.
Write updated instance files.

### 6. Handle New/Removed Templates

If the plugin has new templates not yet instantiated:
```
New templates available:
  - {template-name} (serves: {stages})

Add any? [+name / enter to skip]
```

If a template was removed but an instance references it:
```
Warning: template "{name}" no longer exists in plugin.
  Instance .agent/roles/{name}.md is now a custom role (no future sync).
```

### 7. Report

```
Sync complete:
  - {name}.md: {n} accepted, {n} rejected
  ...

All roles now at template_version: {version}
```

## Steps: --add Mode

### 1. Parse Role Name

Extract role name from `$ARGUMENTS`.

### 2. Find Template

Check if `${CLAUDE_PLUGIN_ROOT}/roles/templates/{role-name}.md` exists.

If not: check if the name contains a hyphen (e.g., `coder-frontend`). Extract the base name before the last hyphen. If that template exists, treat as a named variant:
```
Template "{role-name}" not found. Did you mean to create a variant of "{base}"?
Base template [{base} / other]:
```

If still not found: list available templates and STOP.

### 3. Show Template Summary

```
Reading template: {name}
  Model:    {model}
  Stages:   {stages}
  Skills:   {skills}
  Inherits: {parent or none}

Customize before adding? [enter to skip / yes]
```

### 4. Optional Customization

If yes, show the same per-role override flow as default mode step 6.

### 5. Instantiate

Read template, resolve inheritance, apply overrides, add instance metadata, write to `.agent/roles/{role-name}.md`.

### 6. Update Config

Add to `active_roles` in `.agent/config.md`.

Check if any of the role's `pipeline_stages` are currently assigned in `stage_assignments`:
- If a stage is unassigned, assign this role.
- If a stage is already assigned, ask: `Reassign {stage} to {role-name}? [y/n]`

### 7. Report

```
Adding {role-name} to .agent/roles/...

  Created: .agent/roles/{role-name}.md

Updating .agent/config.md:
  active_roles: added {role-name}
  stage_assignments: {any changes}

Role added. {count} roles active.
```

## Steps: --remove Mode

### 1. Parse Role Name

Extract role name from `$ARGUMENTS`.

### 2. Find Instance

Check if `.agent/roles/{role-name}.md` exists. If not, list active roles and STOP.

### 3. Check Stage Assignments

Check if the role is assigned to any stage in `stage_assignments` from `.agent/config.md`.

If yes, warn:
```
Warning: {role-name} is assigned to stage "{stage}".

Removing will leave the {stage} stage unassigned.
Options:
  1. Reassign {stage} to {alternative-role} (available, serves {stage})
  2. Remove anyway (stage will have no assigned role)

Choice [1/2]:
```

List other active roles that serve the same stage as alternatives.

### 4. Archive

Create `.agent/roles/.archive/` if it does not exist.
Move `.agent/roles/{role-name}.md` to `.agent/roles/.archive/{role-name}.md`.

### 5. Update Config

Remove from `active_roles` in `.agent/config.md`.
Remove from or reassign in `stage_assignments` per user choice.

### 6. Report

```
Removing {role-name}...

  Moving: .agent/roles/{role-name}.md -> .agent/roles/.archive/{role-name}.md

Updating .agent/config.md:
  active_roles: removed {role-name}
  stage_assignments: {changes or "no changes needed"}

Role removed. {count} roles active.
```
