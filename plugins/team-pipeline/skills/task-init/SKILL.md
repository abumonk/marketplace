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
   ```

3. Create `.agent/config.md` with this content:
   ```markdown
   ---
   build_command: npm run build
   test_command: npm test
   max_iterations: 3
   ---

   # Project Pipeline Configuration

   Edit the frontmatter above to match your project's build and test commands.
   ```

4. Create `.agent/knowledge/patterns.md`:
   ```markdown
   # Patterns

   Recurring patterns discovered across tasks.
   ```

5. Create `.agent/knowledge/issues.md`:
   ```markdown
   # Common Issues

   Issues encountered and their solutions.
   ```

6. Create `.agent/knowledge/decisions.md`:
   ```markdown
   # Architecture Decisions

   Decisions made during task implementation.
   ```

7. Create `.agent/lead-state.md` with this content:
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

8. Create `.agent/messenger.md` with this content:
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

9. Ask the user if they want to customize the build and test commands in config.md.

10. Tell the user: "Pipeline initialized. Run `/init-roles` to configure project-specific roles, or use `/task` to create your first task. The lead agent will manage pipeline orchestration."
