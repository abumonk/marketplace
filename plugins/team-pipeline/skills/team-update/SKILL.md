---
name: team-update
description: Update a project's .agent/ directory to the current team-pipeline plugin version. Migrates controller-state to lead-state, updates messenger format, and adds the lead role.
disable-model-invocation: true
---

# Team Update

Safely migrate a project's `.agent/` directory from older team-pipeline versions to the current version.

## Steps

### 1. Check Prerequisites

Check that `.agent/` exists. If not, tell the user: "No pipeline found. Run `/task-init` first." STOP.

### 2. Detect Migration Needs

Run all checks and collect results into a migration plan:

**Check A: controller-state.md**
- Check if `.agent/controller-state.md` exists.
- If yes: flag as `needs_migration` with label "controller-state -> lead-state".
- If no: check if `.agent/lead-state.md` exists. If neither exists, flag as `needs_creation` with label "lead-state missing".

**Check B: messenger.md format**
- Read `.agent/messenger.md`. If it does not exist, skip this check.
- Read frontmatter. Check for ANY of these fields or nested fields:
  - Any channel has a `format` field
  - Top-level `notification_rules` exists
  - Top-level `message_templates` exists
  - Any channel `events` list contains event-type values (e.g., `task.completed`, `task.blocked`) instead of severity values (`high`, `normal`, `low`, `info`, `all`)
- If any found: flag as `needs_migration` with label "messenger format update".

**Check C: lead role**
- Check if `.agent/roles/` exists and contains `.md` files.
- If yes: check if `.agent/roles/lead.md` exists.
  - If no lead.md: read `.agent/config.md` frontmatter for `active_roles`.
    - If `active_roles` has more than 3 entries (team/full preset): flag as `needs_addition` with label "add lead role".
    - If `active_roles` has 3 or fewer entries (solo preset): skip (solo doesn't need lead).
  - If lead.md exists: skip.
- If `.agent/roles/` does not exist or is empty: skip (roles not initialized yet).

**Check D: questions directory**
- Check if `.agent/questions/` exists.
- If no: flag as `needs_creation` with label "questions directory missing".

**Check E: metrics.md**
- Check if `.agent/metrics.md` exists.
- If no: flag as `needs_creation` with label "metrics.md missing".

**Check F: git config in config.md**
- Read `.agent/config.md` frontmatter.
- Check if a `git:` block exists in the frontmatter.
- If no `git:` block: flag as `needs_addition` with label "git config missing".

### 3. Present Migration Plan

If no migrations needed:
```
Pipeline is up to date. No migrations needed.
```
STOP.

If migrations found, present:
```
Pipeline update check:

  {for each flagged item:}
  [!] {label}
      -> {description of what will happen}

  {for each skipped item:}
  [ok] {component} - no changes needed

Apply updates? [all / pick / skip]
```

- `all`: apply all migrations in order
- `pick`: let user select which migrations to apply (show numbered list)
- `skip`: abort, change nothing

Wait for user response.

### 4. Execute Migrations

Apply selected migrations in this order:

#### Migration A: controller-state.md -> lead-state.md

1. Read `.agent/controller-state.md` frontmatter.
2. Extract preserved fields: `mode`, `max_parallel`, `active_agents`, `queue`, `last_event`, `paused`.
   - If any field is missing, use defaults: `mode: semi-auto`, `max_parallel: 3`, `active_agents: []`, `queue: []`, `last_event: null`, `paused: false`.
3. Build new lead-state frontmatter by combining preserved fields with new fields:
   ```yaml
   last_analysis: null
   pending_proposals: 0
   decisions_awaiting: []
   pattern_notes: []
   session_context:
     tasks_completed_today: 0
     avg_stage_duration_mins: 0
   mode: {preserved}
   max_parallel: {preserved}
   active_agents: {preserved}
   queue: {preserved}
   last_event: {preserved}
   paused: {preserved}
   ```
4. Show the user what will be preserved and what is new:
   ```
   Migrating controller-state.md -> lead-state.md:
     Preserving: mode={value}, max_parallel={value}, active_agents={count} items, queue={count} items, paused={value}
     Adding: last_analysis, pending_proposals, decisions_awaiting, pattern_notes, session_context
   ```
5. Write `.agent/lead-state.md` with the new frontmatter and body:
   ```markdown
   # Lead State

   This file is managed by the lead agent. Do not edit manually unless performing recovery.
   ```
6. Create `.agent/.archive/` if it does not exist.
7. Move `.agent/controller-state.md` to `.agent/.archive/controller-state.md`.
8. Report: "Migrated controller-state -> lead-state. Original archived."

#### Migration A (variant): lead-state missing (no controller-state either)

1. Write `.agent/lead-state.md` with default content (same as task-init step 7).
2. Report: "Created lead-state.md with defaults."

#### Migration B: messenger.md format update

1. Read `.agent/messenger.md` frontmatter.
2. For each channel, extract and preserve:
   - `enabled` (boolean)
   - Credential env var names: `webhook_url_env`, `bot_token_env`, `chat_id_env` (whichever exist)
3. Map old event lists to severity-based:
   - If `events` contains `all` -> keep `[all]`
   - If `events` contains failure/error types (`task.blocked`, `task.failed`, `agent.error`) but NOT advancement types -> map to `[high]`
   - If `events` contains a mix of types -> map to `[high, normal]`
   - If `events` is missing or empty -> use channel defaults: discord `[high, normal]`, telegram `[all]`, slack `[high]`, terminal `[all]`
4. Preserve top-level `enabled` field.
5. Show the user what will change:
   ```
   Updating messenger.md:
     Preserving: enabled={value}
     {for each channel:}
       {channel}: enabled={value}, {env_vars}
         events: {old} -> {new}
     Removing: format, notification_rules, quiet_hours, message_templates
   ```
6. Write new `.agent/messenger.md` with severity-based format:
   ```markdown
   ---
   enabled: {preserved}
   channels:
     discord:
       enabled: {preserved}
       webhook_url_env: {preserved}
       events: {mapped}
     telegram:
       enabled: {preserved}
       bot_token_env: {preserved}
       chat_id_env: {preserved}
       events: {mapped}
     slack:
       enabled: {preserved}
       webhook_url_env: {preserved}
       events: {mapped}
     terminal:
       enabled: {preserved}
       events: {mapped}
   ---

   # Messenger Configuration

   This file controls pipeline notification delivery. The lead agent reads this
   to determine where and when to send notifications.

   ## Severity Levels
   - **high**: blocked, crashed, failed events
   - **normal**: task advanced, role assigned
   - **low**: task queued, dependency waiting
   - **info**: batch completions, session summaries

   ## Setup
   1. Set `enabled: true` at the top level.
   2. Enable desired channels.
   3. Set environment variables for each channel.
   4. The lead agent handles formatting and delivery.
   ```
7. Archive old version: copy previous content to `.agent/.archive/messenger-pre-lead.md`.
8. Report: "Updated messenger.md to severity-based format. Original archived."

#### Migration C: Add lead role

1. Read lead role template from `${CLAUDE_PLUGIN_ROOT}/roles/templates/lead.md`.
2. Add instance metadata:
   ```yaml
   source_template: lead
   template_version: 0.1.0
   overrides: []
   ```
3. Write to `.agent/roles/lead.md`.
4. Read `.agent/config.md` frontmatter.
5. Add `lead` to the beginning of `active_roles` list.
6. Report:
   ```
   Added lead role:
     Created: .agent/roles/lead.md
     Updated: config.md active_roles (added lead)
   ```

#### Migration D: Create questions directory

1. Create `.agent/questions/` directory.
2. Create `.agent/questions/pending.md` with this content:
   ```markdown
   ---
   last_updated: null
   count: 0
   next_id: 1
   ---

   # Pending Questions

   Questions from agents awaiting user answers. Managed by messenger role.
   ```
3. Create `.agent/questions/ready.md` with this content:
   ```markdown
   ---
   last_updated: null
   count: 0
   ---

   # Ready Questions

   Answered questions awaiting agent pickup. Agents read answers here and move to archive.
   ```
4. Create `.agent/questions/archive.md` with this content:
   ```markdown
   ---
   last_updated: null
   count: 0
   ---

   # Archived Questions

   Processed questions. Append-only history.
   ```
5. Report: "Created questions directory with pending, ready, and archive files."

#### Migration E: Create metrics.md

1. Create `.agent/metrics.md` with this content:
   ```markdown
   ---
   last_updated: null
   totals:
     tokens_in: 0
     tokens_out: 0
     agents_spawned: 0
     tasks_completed: 0
     avg_turns_per_agent: 0
   ---

   # Agent Metrics

   Performance log maintained by the lead agent. Append-only.

   ## Agent Log

   | timestamp | task | role | model | stage | turns | tokens_in | tokens_out | duration_min | result |
   |-----------|------|------|-------|-------|-------|-----------|------------|-------------|--------|
   ```
2. Report: "Created metrics.md with empty agent log."

#### Migration F: Add git config to config.md

1. Read `.agent/config.md` frontmatter.
2. Detect branch naming conventions in the project:
   - Run `git branch -a --list` in the project directory.
   - Look for common patterns: `feature/`, `fix/`, `task/`, `hotfix/`, `release/`.
   - If a dominant pattern is found (>50% of branches), use it for `branch_template` suggestion.
3. Add the `git:` block to the frontmatter with defaults:
   ```yaml
   git:
     mode: "current-branch"
     branch_template: "task/{id}-{slug}"
     base_branch: "main"
     auto_detect_repos: true
     commit_style: "conventional"
     commit_template: "{type}({id}): {message}"
     pr_template: "default"
   ```
4. If a branch pattern was detected, suggest it: "Detected branch pattern: `{pattern}/`. Use `{pattern}/{id}-{slug}` as template?"
   - If user accepts: update `branch_template` accordingly.
5. Ask the user: "Git mode for this project? current-branch (default) or branch-per-task?"
   - Update `git.mode` based on response.
6. Report: "Added git config to config.md (mode: {mode}, branch_template: {template})."

### 5. Completion Report

After all migrations:

```
Pipeline update complete:

  {for each applied migration:}
  [done] {label} {brief detail}

  {for each skipped migration:}
  [skip] {label} {reason}

{if any archives created:}
Archive:
  {list of archived files}

Run `/task lead` to verify the lead agent works with your updated pipeline.
```

If any migrations were skipped that could affect lead functionality, warn:
```
Note: Skipped migrations may cause issues with the lead agent.
Run `/team-update` again to apply remaining migrations.
```

## Rules

- NEVER overwrite files without showing the user what will change first
- ALWAYS archive originals before replacing (`.agent/.archive/`)
- NEVER modify task files -- this skill only updates infrastructure files
- NEVER modify role instances other than adding lead -- use `init-roles --sync` for that
- If `.agent/.archive/` already contains a file with the same name, append a timestamp suffix (e.g., `controller-state-2026-02-10.md`)
- Preserve ALL user-configured values (channel settings, mode, queue state)
- If a migration fails mid-way, report what succeeded and what failed -- do not roll back
