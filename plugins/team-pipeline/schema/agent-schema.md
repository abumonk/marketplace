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
  - adventures

files:
  config.md:
    type: frontmatter
    required_fields:
      pipeline_version: { default: "0.1.0" }
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
      adventure:
        max_task_tokens: { default: 100000 }
        max_task_duration: { default: "30min" }
        token_cost_per_1k:
          opus: { default: 0.015 }
          sonnet: { default: 0.003 }
          haiku: { default: 0.001 }
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
      See the `git:` block for git integration settings.
      See the `adventure:` block for feature adventure thresholds and cost settings.

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

      Answered questions awaiting agent pickup. Agents read answers here and move to archive.

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

# Agent Schema

Single source of truth for the `.agent/` directory structure.

Read by the reinit skill to create or upgrade project pipelines.

## File Types

- **frontmatter**: YAML frontmatter + markdown body. Deep-mergeable during upgrades.
- **template**: Plain markdown. Created once, never modified.

## Interactive Fields

Fields in the `interactive` array trigger user prompts during first-time setup only.
During upgrades, missing fields receive their defaults silently.
