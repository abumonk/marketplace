---
name: task-init
description: Initialize the .agent/ directory structure in the current project for the team-pipeline task processing system
disable-model-invocation: true
---

# Initialize Task Pipeline

Create the `.agent/` directory structure in the current project.

## Steps

1. Check if `.agent/` already exists. If it does, tell the user and stop.

2. Create the following directory structure:
   ```
   .agent/
     tasks/
     tasks/archive/
     logs/
     reports/
     designs/
     knowledge/
     roles/
     questions/
   ```

3. Create `.agent/config.md` with this content:
   ```markdown
   ---
   build_command: npm run build
   test_command: npm test
   max_iterations: 3
   git:
     mode: "current-branch"
     branch_template: "task/{id}-{slug}"
     base_branch: "main"
     auto_detect_repos: true
     commit_style: "conventional"
     commit_template: "{type}({id}): {message}"
     pr_template: "default"
   ---

   # Project Pipeline Configuration

   Edit the frontmatter above to match your project's build and test commands. See the `git:` block for git integration settings.
   ```

4. Detect branch naming conventions in the project:
   - Run `git branch -a --list` in the project directory
   - Look for common patterns: `feature/`, `fix/`, `task/`, `hotfix/`, `release/`
   - If a dominant pattern is found (>50% of branches), suggest it as the `branch_template`
   - Example: if most branches start with `feature/`, suggest `branch_template: "feature/{id}-{slug}"`
   - Present the detected pattern to the user: "Detected branch pattern: `feature/`. Use `feature/{id}-{slug}` as template?"
   - If no pattern found or user declines, keep default `task/{id}-{slug}`

5. Ask the user: "Git mode for this project?"
   - **current-branch** (default): Commits on the current branch at stage transitions. No branch creation, no PRs.
   - **branch-per-task**: Creates a new branch per task at implementation start. Push + PR on completion.
   Update the `git.mode` field in `.agent/config.md` based on the user's choice.

6. Create `.agent/knowledge/patterns.md`:
   ```markdown
   # Patterns

   Recurring patterns discovered across tasks.
   ```

7. Create `.agent/knowledge/issues.md`:
   ```markdown
   # Common Issues

   Issues encountered and their solutions.
   ```

8. Create `.agent/knowledge/decisions.md`:
   ```markdown
   # Architecture Decisions

   Decisions made during task implementation.
   ```

9. Create `.agent/lead-state.md` with this content:
   ```markdown
   ---
   last_analysis: null
   pending_proposals: 0
   decisions_awaiting: []
   pattern_notes: []
   session_context:
     tasks_completed_today: 0
     avg_stage_duration_mins: 0
   mode: semi-auto
   max_parallel: 3
   active_agents: []
   queue: []
   last_event: null
   paused: false
   ---

   # Lead State

   This file is managed by the lead agent. Do not edit manually unless performing recovery.
   ```

10. Create `.agent/messenger.md` with this content:
   ```markdown
   ---
   enabled: false
   channels:
     discord:
       enabled: false
       webhook_url_env: DISCORD_WEBHOOK_URL
       events: [high, normal]
     telegram:
       enabled: false
       bot_token_env: TELEGRAM_BOT_TOKEN
       chat_id_env: TELEGRAM_CHAT_ID
       events: [all]
     slack:
       enabled: false
       webhook_url_env: SLACK_WEBHOOK_URL
       events: [high]
     terminal:
       enabled: true
       events: [all]
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

11. Create `.agent/questions/pending.md` with this content:
   ```markdown
   ---
   last_updated: null
   count: 0
   next_id: 1
   ---

   # Pending Questions

   Questions from agents awaiting user answers. Managed by messenger role.
   ```

12. Create `.agent/questions/ready.md` with this content:
    ```markdown
    ---
    last_updated: null
    count: 0
    ---

    # Ready Questions

    Answered questions awaiting agent pickup. Agents read answers here and move to archive.
    ```

13. Create `.agent/questions/archive.md` with this content:
    ```markdown
    ---
    last_updated: null
    count: 0
    ---

    # Archived Questions

    Processed questions. Append-only history.
    ```

14. Create `.agent/metrics.md` with this content:
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

15. Ask the user if they want to customize the build and test commands in config.md.

16. Tell the user: "Pipeline initialized. Run `/init-roles` to configure project-specific roles, or use `/task` to create your first task. The lead agent will manage pipeline orchestration."
