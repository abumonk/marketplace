# Concept: Pipeline Reinit

**Status**: Implemented
**Date**: 2026-02-10
**Type**: Skill (replaces team-update)

## Problem

`team-update` is a hardcoded list of specific migrations (A through F). Every time a new feature is added to the plugin (git config, questions, metrics, etc.), someone must manually add a new Check + Migration to `team-update`. This doesn't scale and will always lag behind `task-init`.

`task-init` refuses to run if `.agent/` exists ("already initialized, stop"). So there's no way to bring an existing project up to date with the current plugin version without either:
1. Manually editing `.agent/` files
2. Hoping `team-update` has the right migration

## Solution

A **schema-driven reinit** skill that replaces `team-update`. It:
1. Reads the current `.agent/` state (all files, configs, tasks, knowledge, roles)
2. Compares against a **schema** defining the expected `.agent/` structure for the current plugin version
3. Creates/updates missing infrastructure **without touching user data**
4. Always dry-runs first — shows what it would do, waits for approval

### What is "user data" (never modify):
- `.agent/tasks/` and `tasks/archive/` — all task files
- `.agent/knowledge/` — patterns, issues, decisions (content, not file existence)
- `.agent/designs/` — design documents
- `.agent/reports/` — review reports
- `.agent/logs/` — agent logs
- `.agent/config.md` — user-configured values (build_command, test_command, etc.)
- `.agent/roles/` — user-customized role instances (overrides)
- `.agent/messenger.md` — user-configured channel settings
- `.agent/lead-state.md` — current pipeline state
- `.agent/metrics.md` — accumulated metrics data (rows)
- `.agent/questions/` — active questions (content)

### What can be created/updated (infrastructure):
- Missing directories (new dirs added to schema)
- Missing infrastructure files (created with defaults from schema)
- Missing config fields (deep-merged into existing frontmatter, never overwrite existing values)
- Missing knowledge base files (create with empty template, don't touch existing content)
- Missing question store files (create with defaults)

## Decisions

1. **Replaces `team-update`** — `team-update` skill becomes deprecated. Reinit is the single upgrade path. The `/team-update` command redirects to reinit.
2. **Schema-driven** — A schema file defines the expected `.agent/` structure: directories, files, frontmatter fields with defaults, file templates. Reinit compares reality against schema and fills gaps.
3. **Deep merge for config** — When `config.md` gets new frontmatter fields (like `git:`), reinit deep-merges new defaults into existing frontmatter. Existing user values are never overwritten. New keys are added with defaults.
4. **Delegates role sync** — Reinit does NOT update `.agent/roles/` instances. After reinit completes, it suggests: "Run `/init-roles --sync` to update role instances with latest templates." Role template changes are a separate concern.
5. **Version tracking** — `.agent/` gets a `version` field in `config.md` frontmatter tracking which plugin version it was last reinit'd with. Format: plugin semver from `plugin.json`. Enables future targeted migration paths for breaking changes.
6. **Always dry-run** — Reinit always shows the full plan first. User approves before any changes. Consistent with proposal-only philosophy.

## Schema Design

The schema is a structured definition (YAML or markdown) that lives in the plugin. It declares:

```yaml
version: "0.1.0"  # plugin version this schema matches

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
        discord: { enabled: false, webhook_url_env: "DISCORD_WEBHOOK_URL", events: [high, normal] }
        telegram: { enabled: false, bot_token_env: "TELEGRAM_BOT_TOKEN", chat_id_env: "TELEGRAM_CHAT_ID", events: [all] }
        slack: { enabled: false, webhook_url_env: "SLACK_WEBHOOK_URL", events: [high] }
        terminal: { enabled: true, events: [all] }
    body_template: |
      # Messenger Configuration
      ...

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

  questions/ready.md:
    type: frontmatter
    required_fields:
      last_updated: { default: null }
      count: { default: 0 }

  questions/archive.md:
    type: frontmatter
    required_fields:
      last_updated: { default: null }
      count: { default: 0 }

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
```

## Reinit Flow

```
1. Read .agent/config.md -> version field (if exists)
2. Read plugin schema for current version
3. Compare:
   a. Missing directories -> flag for creation
   b. Missing files -> flag for creation with template
   c. Existing frontmatter files -> deep-merge check: find missing keys, note additions
   d. Version mismatch -> note upgrade path
4. Present dry-run report:
   [create] .agent/questions/           (new directory)
   [create] .agent/questions/pending.md (new file)
   [merge]  .agent/config.md           (adding: git.mode, git.branch_template, ...)
   [ok]     .agent/tasks/              (unchanged)
   [ok]     .agent/knowledge/          (unchanged)

   Apply changes? [all / pick / skip]
5. On approval: execute changes
6. Update config.md version field
7. Suggest: "Run /init-roles --sync to update role instances"
```

## Relationship to Existing Skills

- **task-init**: Handles first-time creation only. Reinit handles all subsequent updates. Both derive from the same schema.
- **team-update**: Deprecated. Reinit replaces it. Migration path: `team-update` redirects to reinit.
- **init-roles --sync**: Reinit suggests running this after completion. Does not duplicate role sync logic.
- **init-skills**: Reinit suggests running this after completion. Does not duplicate skill discovery.

## Implementation Notes

- The schema could live as `schema/agent-schema.yaml` in the plugin root, or as a structured section in the reinit skill itself
- `task-init` should be refactored to read from the same schema (single source of truth)
- Breaking changes (field renames, file moves) still need explicit migration logic — the schema handles additive changes only. For breaking changes, a `migrations/` directory with versioned migration scripts could be added later.
