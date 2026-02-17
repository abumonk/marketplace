---
name: reinit
description: Initialize or upgrade the .agent/ directory to the current plugin version. Creates from schema on first run, deep-merges missing fields on subsequent runs. Replaces team-update.
disable-model-invocation: true
---

# Reinit Pipeline

Initialize or upgrade the `.agent/` directory structure based on the plugin schema.

## Steps

### 1. Read Schema

Read `${CLAUDE_PLUGIN_ROOT}/schema/agent-schema.md`. Parse the YAML frontmatter to get:
- `pipeline_version` -- the current plugin version
- `directories` -- list of required directories
- `files` -- map of file paths to their type, required_fields, interactive prompts, and templates

### 2. Detect Mode

Check if `.agent/` exists in the current project directory.

- **If `.agent/` does NOT exist** -> **Create Mode** (go to Step 3)
- **If `.agent/` exists** -> **Upgrade Mode** (go to Step 10)

---

## Create Mode (Steps 3-9)

### 3. Create Directories

Create `.agent/` and then `.agent/{dir}/` for every entry in the schema's `directories` list. Do not hardcode directory names -- always read from the schema.

### 4. Create Files from Schema

For each file in the schema `files` map:

**If type is `frontmatter`:**
1. Build YAML frontmatter from `required_fields`, extracting the `default` value for each field recursively.
   - For nested objects (like `git:`, `channels:`), build the nested YAML structure.
   - For arrays, use the array value directly.
   - For `null`, write `null`.
2. Write the file with `---` delimited frontmatter and the `body_template` as the body.

**If type is `template`:**
1. Write the file with the `template` content as the body (no frontmatter).

### 5. Detect Branch Conventions

Run `git branch -a --list` in the project directory.
- Look for common patterns: `feature/`, `fix/`, `task/`, `hotfix/`, `release/`
- If a dominant pattern is found (>50% of branches), note it for the interactive step.

### 6. Run Interactive Setup

For each entry in the schema's `interactive` array (only for files that have one -- currently `config.md`):

**For fields with `options`** (like `git.mode`):
- Present the question to the user with the available options and their descriptions.
- Use the first option as the default.
- Update the field in the file's frontmatter with the user's choice.

**For fields with `type: text`** (like `build_command`, `test_command`):
- Ask the user the question.
- If user provides a value, update the field. Otherwise keep the default.

**Branch template suggestion:**
- If step 5 detected a dominant branch pattern, suggest it: "Detected branch pattern: `{pattern}/`. Use `{pattern}/{id}-{slug}` as template?"
- If user accepts, update `git.branch_template` in config.md.

### 7. Set Version

Write `pipeline_version: "{version}"` into `.agent/config.md` frontmatter (already set from schema defaults, but confirm it matches).

### 8. Archive Check

If `.agent/.archive/` does not exist, create it (used by future upgrades).

### 9. Completion

Tell the user:
```
Pipeline initialized (v{version}).

Next steps:
- Run /init-roles to configure project-specific roles
- Run /task to create your first task
- Run /start-adventure to start a feature adventure
```

STOP.

---

## Upgrade Mode (Steps 10-16)

### 10. Read Current State

1. Read `.agent/config.md` frontmatter. Extract `pipeline_version` (may be absent in old installs).
2. Note the current version (or "unknown" if absent).

### 11. Compare Against Schema

Build a change plan by comparing the current `.agent/` against the schema:

**Directories:**
For each directory in `schema.directories`:
- If `.agent/{dir}/` does not exist -> add to plan: `[create] .agent/{dir}/`
- If exists -> add to plan: `[ok] .agent/{dir}/`

**Files:**
For each file in `schema.files`:
- If `.agent/{file}` does not exist:
  - Add to plan: `[create] .agent/{file}` with note about content type
- If `.agent/{file}` exists AND type is `frontmatter`:
  - Read the file's current frontmatter
  - Deep-compare against `schema.files[file].required_fields`:
    - Walk the schema fields recursively
    - For each field path: if missing in current frontmatter, add to plan: `[merge] .agent/{file} (adding: {field}: {default})`
    - For each field path: if present in current frontmatter, add to plan: `[ok] {field}`
  - Collect all missing fields for this file
- If `.agent/{file}` exists AND type is `template`:
  - Add to plan: `[ok] .agent/{file}` (template files are never modified)

**Version:**
- If current `pipeline_version` != schema `pipeline_version`:
  - Add to plan: `[version] pipeline_version {current} -> {schema}`
- If equal: `[ok] pipeline_version`

### 12. Check if Changes Needed

If the plan contains ONLY `[ok]` entries:
```
Pipeline is up to date (v{version}). No changes needed.
```
STOP.

### 13. Present Dry-Run Report

Display the change plan:
```
Pipeline upgrade check (v{current} -> v{schema}):

  {for each item in plan, sorted: [create] first, then [merge], then [version], then [ok]:}
  [{action}] .agent/{path}    ({detail})

Summary:
  {N} directories to create
  {N} files to create
  {N} files to merge (new fields only)
  {N} unchanged

Apply changes? [all / pick / skip]
```

- **all**: apply all changes
- **pick**: show numbered list, let user select which changes to apply
- **skip**: abort, change nothing. STOP.

Wait for user response.

### 14. Execute Changes

Apply selected changes in this order:

**1. Create directories:**
- Create each flagged directory.

**2. Create files:**
For each missing file:
- `frontmatter` type: Build frontmatter from schema defaults, write with body_template.
- `template` type: Write with template content.

**3. Merge frontmatter:**
For each existing frontmatter file with missing fields:
- Read the current file content (preserve everything).
- Parse frontmatter.
- Deep-merge: add missing keys with their defaults. Never overwrite existing values.
- Write back the file with updated frontmatter and original body preserved.

**4. Update version:**
- Set `pipeline_version` in `.agent/config.md` frontmatter to schema version.

### 15. Migration from Legacy

During upgrade, also check for legacy artifacts:

**controller-state.md** (pre-lead-state):
- If `.agent/controller-state.md` exists AND `.agent/lead-state.md` does not exist:
  - Read controller-state frontmatter
  - Extract preserved fields: `mode`, `max_parallel`, `active_agents`, `queue`, `last_event`, `paused`
  - Build lead-state.md with preserved fields + new fields from schema
  - Create `.agent/.archive/` if needed
  - Move controller-state.md to `.agent/.archive/controller-state.md`
  - Report: "Migrated controller-state -> lead-state. Original archived."

**Old messenger format:**
- If `.agent/messenger.md` has `format`, `notification_rules`, or `message_templates` fields:
  - Preserve channel `enabled` states and credential env var names
  - Map old event lists to severity-based format
  - Archive old file to `.agent/.archive/messenger-pre-reinit.md`
  - Write new messenger.md from schema with preserved values
  - Report: "Updated messenger.md to current format. Original archived."

### 16. Completion Report

```
Pipeline upgraded (v{current} -> v{schema}):

  {for each applied change:}
  [done] {path}    ({detail})

  {for each skipped change:}
  [skip] {path}    ({reason})

{if any archives created:}
Archived:
  {list of archived files}

Next steps:
- Run /init-roles --sync to update role instances with latest templates
- Run /init-skills to discover new skills
```

STOP.

---

## Rules

- NEVER overwrite existing frontmatter values -- only add missing keys
- NEVER modify template-type files that already exist
- NEVER touch user data (tasks, knowledge content, designs, reports, logs, metrics rows)
- ALWAYS show the full change plan before making any modifications
- ALWAYS archive files before replacing them (`.agent/.archive/`)
- If `.agent/.archive/` already contains a file with the same name, append a timestamp suffix
- Interactive prompts run ONLY in create mode, never during upgrades
- The schema file is the single source of truth -- do not hardcode file contents in this skill
