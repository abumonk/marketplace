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

7. Create `.agent/controller-state.md` with this content:
   ```markdown
   ---
   mode: semi-auto
   max_parallel: 3
   active_agents: []
   queue: []
   last_event: null
   paused: false
   ---

   # Controller State

   This file is managed by the pipeline controller. Do not edit manually unless performing recovery.
   ```

8. Create `.agent/messenger.md` with this content:
   ```markdown
   ---
   enabled: false
   channels:
     discord:
       enabled: false
       webhook_url_env: DISCORD_WEBHOOK_URL
       events: [all]
       format: embed
     telegram:
       enabled: false
       bot_token_env: TELEGRAM_BOT_TOKEN
       chat_id_env: TELEGRAM_CHAT_ID
       events: [all]
       format: html
     slack:
       enabled: false
       webhook_url_env: SLACK_WEBHOOK_URL
       events: [all]
       format: blocks
     terminal:
       enabled: true
       events: [all]
   notification_rules:
     on_complete: true
     on_block: true
     on_fail: true
     quiet_hours:
       enabled: false
       start: "22:00"
       end: "08:00"
   message_templates: {}
   ---

   # Messenger Configuration

   This file controls pipeline notification delivery. Edit channel settings above to enable external notifications.

   ## Setup

   1. Set `enabled: true` at the top level.
   2. Enable desired channels.
   3. Set environment variables for each channel (see docs/designs/messenger-design.md).
   4. Start a new session to validate channel configuration.
   ```

9. Ask the user if they want to customize the build and test commands in config.md.

10. Tell the user: "Pipeline initialized. Run `/init-roles` to configure project-specific roles, or use `/task` to create your first task."
