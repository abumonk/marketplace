---
pipeline_version: "0.13.0"

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
  - agent-memory
  - agent-memory/lead
  - agent-memory/planner
  - agent-memory/coder
  - agent-memory/code-reviewer
  - agent-memory/reviewer
  - agent-memory/researcher
  - rules
  - step2step

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
      active_agents:
        type: array
        default: []
        items:
          task_id: string     # e.g. "TASK-001" or "ADV015-T001"
          role: string        # agent role name
          model: string       # model used (sonnet, opus, haiku)
          started_at: string  # ISO 8601 timestamp
      queue:
        type: array
        default: []
        items:
          task_id: string     # task to be processed
          stage: string       # target pipeline stage
          priority: number    # optional, for ordering (lower = higher priority)
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

  hooks.md:
    type: frontmatter
    required_fields:
      version: { default: "1.0" }
      hooks:
        default:
          - id: enforce-working-folders
            event: PreToolUse
            matcher:
              tools: [Write, Edit, Read, Glob, Grep]
            action: block
            mode: enforce
            description: "Block file operations outside declared working folders"
            enabled: true
          - id: log-bash-usage
            event: PreToolUse
            matcher:
              tools: [Bash]
            action: log
            mode: advisory
            description: "Log Bash usage for post-hoc review"
            enabled: true
          - id: record-agent-completion
            event: SubagentStop
            matcher:
              roles: ["*"]
            action: log
            mode: always
            description: "Record agent completion metrics"
            enabled: true
          - id: adventure-completion-check
            event: TaskCompleted
            matcher:
              tags: [adventure]
            action: notify
            mode: advisory
            description: "Check if adventure is complete when an adventure task finishes"
            enabled: true
          - id: adventure-review-trigger
            event: TaskCompleted
            matcher:
              tags: [adventure]
            action: notify
            mode: advisory
            description: "When all adventure tasks are completed, suggest running /adventure-review {ADV-ID}"
            enabled: true
          - id: roadmap-task-completed
            event: TaskCompleted
            matcher:
              roles: ["*"]
            action: log
            mode: always
            description: "Update roadmap on task completion"
            enabled: true
          - id: roadmap-session-update
            event: SubagentStop
            matcher:
              roles: ["lead"]
            action: log
            mode: advisory
            description: "Remind lead to update roadmap session notes on significant events"
            enabled: true
    body_template: |
      # Hook Configuration

      This file defines lifecycle hooks for the pipeline. The lead agent evaluates
      these rules during orchestration events.

      ## How Hooks Work

      1. An event occurs (agent completes, stage transition proposed, tool use detected)
      2. The lead agent reads this file and finds matching hooks
      3. For each matching hook, the lead applies the specified action

      ## Modes

      - **enforce**: Violations block the action.
      - **advisory**: Generates a recommendation.
      - **always**: Always fires (logging, metrics).

      ## Events

      | Event | When | Evaluation |
      |-------|------|------------|
      | PreToolUse | Before tool use | Injected as agent instructions |
      | PostToolUse | After tool use | Injected as agent instructions |
      | SubagentStop | Agent completes | Real-time by lead |
      | StageTransition | Stage advancement | Real-time by lead |
      | TaskCompleted | Task finalized | Real-time by lead |
      | InstructionsLoaded | Agent prompt assembly | Real-time by lead |

  roadmap.md:
    type: frontmatter
    required_fields:
      version: { default: 1 }
      last_updated: { default: null }
      last_session_read: { default: null }
      projects:
        type: array
        default: []
        items:
          id: string              # e.g. "team-pipeline"
          path: string            # e.g. "projects/team-pipeline"
          status: string          # active | paused | archived
          current_adventure: string  # adventure ID or null
          completed_adventures: number
          open_tasks: number
          health: string          # green | yellow | red (derived)
      ecosystem_stats:
        total_adventures: { default: 0 }
        completed_adventures: { default: 0 }
        total_tasks: { default: 0 }
        completed_tasks: { default: 0 }
        total_tcs: { default: 0 }
        passed_tcs: { default: 0 }
    body_template: |
      # Project Roadmap

      ## Ecosystem Overview

      ## Projects

      ## Strategic Goals

      ## Dependency Map

      ## Session Notes

  agent-memory/lead/MEMORY.md:
    type: template
    template: |
      # Lead Agent Memory

      ## Key Learnings

      ## Topic Files

      ## Notes

  agent-memory/planner/MEMORY.md:
    type: template
    template: |
      # Planner Agent Memory

      ## Key Learnings

      ## Topic Files

      ## Notes

  agent-memory/coder/MEMORY.md:
    type: template
    template: |
      # Coder Agent Memory

      ## Key Learnings

      ## Topic Files

      ## Notes

  agent-memory/code-reviewer/MEMORY.md:
    type: template
    template: |
      # Code-Reviewer Agent Memory

      ## Key Learnings

      ## Topic Files

      ## Notes

  agent-memory/reviewer/MEMORY.md:
    type: template
    template: |
      # Reviewer Agent Memory

      ## Key Learnings

      ## Topic Files

      ## Notes

  agent-memory/researcher/MEMORY.md:
    type: template
    template: |
      # Researcher Agent Memory

      ## Key Learnings

      ## Topic Files

      ## Notes
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
