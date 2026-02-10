---
status: approved
date: 2026-02-10
replaces: team-update
depends_on: [task-init, init-roles]
---

# Reinit Design

Schema-driven skill that replaces `team-update` and absorbs `task-init`. Single entry point for both first-time initialization and upgrades of the `.agent/` directory.

## Architecture

Three components:

1. **`schema/agent-schema.md`** -- Markdown file with YAML frontmatter defining the expected `.agent/` structure. Single source of truth for directories, files, frontmatter fields, defaults, and body templates. Version-stamped to match `plugin.json` version.

2. **`skills/reinit/SKILL.md`** -- The reinit skill. Two modes:
   - **Create mode**: No `.agent/` exists. Creates everything from schema, runs interactive setup (git mode, build/test commands, branch detection).
   - **Upgrade mode**: `.agent/` exists. Compares against schema, presents dry-run diff, applies approved changes. Never touches user data.

3. **`skills/task-init/SKILL.md`** -- Thin wrapper. Calls reinit in create mode. Preserves the `/task-init` command for discoverability. Body becomes: "Run reinit in create mode."

`team-update` is deprecated. Its SKILL.md redirects to reinit.

## Schema Format

The schema lives at `schema/agent-schema.md` with this structure:

```markdown
---
pipeline_version: "0.1.0"

directories:
  - tasks
  - tasks/archive
  - logs
  - reports
  - designs
  - knowledge
  - roles
  - questions

files:
  config.md:
    type: frontmatter
    required_fields:
      build_command: { default: "npm run build" }
      test_command: { default: "npm test" }
      max_iterations: { default: 3 }
      git:
        mode: { default: "current-branch" }
        branch_template: { default: "task/{id}-{slug}" }
        base_branch: { default: "main" }
        auto_detect_repos: { default: true }
        commit_style: { default: "conventional" }
        commit_template: { default: "{type}({id}): {message}" }
        pr_template: { default: "default" }
    interactive:
      - field: git.mode
        question: "Git mode for this project?"
        options:
          current-branch: "Commits on the current branch. No branch creation, no PRs."
          branch-per-task: "Creates a new branch per task. Push + PR on completion."
      - field: build_command
        question: "Build command for this project?"
        type: text
      - field: test_command
        question: "Test command for this project?"
        type: text
    body_template: |
      # Project Pipeline Configuration
      Edit the frontmatter above to match your project's build and test commands.

  lead-state.md:
    type: frontmatter
    required_fields:
      last_analysis: { default: null }
      pending_proposals: { default: 0 }
      decisions_awaiting: { default: [] }
      pattern_notes: { default: [] }
      session_context:
        tasks_completed_today: { default: 0 }
        avg_stage_duration_mins: { default: 0 }
      mode: { default: "semi-auto" }
      max_parallel: { default: 3 }
      active_agents: { default: [] }
      queue: { default: [] }
      last_event: { default: null }
      paused: { default: false }
    body_template: |
      # Lead State
      This file is managed by the lead agent. Do not edit manually unless performing recovery.

  messenger.md:
    type: frontmatter
    required_fields:
      enabled: { default: false }
      channels:
        discord:
          enabled: { default: false }
          webhook_url_env: { default: "DISCORD_WEBHOOK_URL" }
          events: { default: [high, normal] }
        telegram:
          enabled: { default: false }
          bot_token_env: { default: "TELEGRAM_BOT_TOKEN" }
          chat_id_env: { default: "TELEGRAM_CHAT_ID" }
          events: { default: [all] }
        slack:
          enabled: { default: false }
          webhook_url_env: { default: "SLACK_WEBHOOK_URL" }
          events: { default: [high] }
        terminal:
          enabled: { default: true }
          events: { default: [all] }
    body_template: |
      # Messenger Configuration
      This file controls pipeline notification delivery.

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

  knowledge/patterns.md:
    type: template
    template: |
      # Patterns
      Recurring patterns discovered across tasks.

  knowledge/issues.md:
    type: template
    template: |
      # Common Issues
      Issues encountered and their solutions.

  knowledge/decisions.md:
    type: template
    template: |
      # Architecture Decisions
      Decisions made during task implementation.

  questions/pending.md:
    type: frontmatter
    required_fields:
      last_updated: { default: null }
      count: { default: 0 }
      next_id: { default: 1 }
    body_template: |
      # Pending Questions
      Questions from agents awaiting user answers. Managed by messenger role.

  questions/ready.md:
    type: frontmatter
    required_fields:
      last_updated: { default: null }
      count: { default: 0 }
    body_template: |
      # Ready Questions
      Answered questions awaiting agent pickup.

  questions/archive.md:
    type: frontmatter
    required_fields:
      last_updated: { default: null }
      count: { default: 0 }
    body_template: |
      # Archived Questions
      Processed questions. Append-only history.

  metrics.md:
    type: frontmatter
    required_fields:
      last_updated: { default: null }
      totals:
        tokens_in: { default: 0 }
        tokens_out: { default: 0 }
        agents_spawned: { default: 0 }
        tasks_completed: { default: 0 }
        avg_turns_per_agent: { default: 0 }
    body_template: |
      # Agent Metrics
      Performance log maintained by the lead agent. Append-only.

      ## Agent Log

      | timestamp | task | role | model | stage | turns | tokens_in | tokens_out | duration_min | result |
      |-----------|------|------|-------|-------|-------|-----------|------------|-------------|--------|
---

# Schema Reference

This schema defines the expected `.agent/` directory structure for the team-pipeline plugin.

## File Types

### `frontmatter`
Files with YAML frontmatter and markdown body. During upgrade, missing frontmatter keys are deep-merged with defaults. Existing values are never overwritten. Body is only written on creation.

### `template`
Simple markdown files. Created with template content if missing. Existing content is never modified.

## Interactive Fields

Fields marked `interactive` trigger user prompts during **create mode only**. During upgrade mode, missing fields get their defaults silently (user already has a working pipeline).

## Version Tracking

`pipeline_version` in config.md frontmatter tracks which plugin version the `.agent/` was last reinit'd with. Enables future targeted migrations for breaking changes.
```

## Reinit Flow

### Create Mode (no `.agent/` exists)

```
1. Read schema from plugin
2. Create all directories
3. For each file in schema:
   a. frontmatter type: build frontmatter from defaults, write with body_template
   b. template type: write template content
4. Run interactive setup:
   a. Detect branch conventions (git branch -a --list)
   b. Ask git mode question
   c. Ask build/test command questions
   d. Update config.md with user answers
5. Set pipeline_version in config.md
6. Tell user: "Pipeline initialized. Run /init-roles to configure roles."
```

### Upgrade Mode (`.agent/` exists)

```
1. Read config.md -> pipeline_version (if exists)
2. Read schema for current plugin version
3. Compare:
   a. Missing directories -> flag [create]
   b. Missing files -> flag [create] with template/defaults
   c. Existing frontmatter files -> deep-merge check:
      - Walk schema required_fields recursively
      - For each key: if missing in file, flag [merge] with default
      - Existing values: flag [ok]
   d. Version mismatch -> flag [version] update
4. Present dry-run report:
   [create]  .agent/questions/           (new directory)
   [create]  .agent/questions/pending.md (new file)
   [merge]   .agent/config.md           (adding: git.mode, git.branch_template, ...)
   [ok]      .agent/tasks/              (unchanged)
   [ok]      .agent/knowledge/          (unchanged)
   [version] config.md pipeline_version 0.0.9 -> 0.1.0

   Apply changes? [all / pick / skip]
5. On approval: execute changes
6. Update config.md pipeline_version
7. Suggest: "Run /init-roles --sync to update role instances"
```

### Deep Merge Algorithm

For frontmatter files, the merge is recursive and additive:

```
function deepMerge(existing, schema):
  for each key in schema.required_fields:
    if key not in existing:
      existing[key] = schema.required_fields[key].default
    else if key is object and schema key is object:
      deepMerge(existing[key], schema[key])
    // else: existing value preserved, do nothing
```

### User Data Protection

Never modified during upgrade:
- `.agent/tasks/` and `tasks/archive/` -- all task files
- `.agent/knowledge/` -- content of existing files
- `.agent/designs/` -- design documents
- `.agent/reports/` -- review reports
- `.agent/logs/` -- agent logs
- `.agent/config.md` -- existing frontmatter values (only new keys added)
- `.agent/roles/` -- user-customized role instances
- `.agent/messenger.md` -- existing channel settings
- `.agent/lead-state.md` -- current pipeline state values
- `.agent/metrics.md` -- accumulated metrics data

## Relationship to Existing Skills

| Skill | After reinit |
|-------|-------------|
| `task-init` | Thin wrapper calling reinit in create mode |
| `team-update` | Deprecated, redirects to reinit |
| `init-roles --sync` | Reinit suggests running after completion |
| `init-skills` | Reinit suggests running after completion |

## Implementation Scope

1. Create `schema/agent-schema.md` with full schema
2. Create `skills/reinit/SKILL.md` with both modes
3. Refactor `skills/task-init/SKILL.md` to delegate to reinit
4. Deprecate `skills/team-update/SKILL.md` with redirect
5. Add `pipeline_version` to existing config.md handling
