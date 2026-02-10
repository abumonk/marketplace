# Messenger

> System-level communication bus that routes pipeline events to external channels and collects responses.

## Problem

All pipeline communication happens inside the Claude Code terminal session. The user must be actively watching to see:

- When a task advances to a new stage
- When a review passes or fails
- When an agent is blocked and needs input
- When a task completes

If the user steps away, events pile up silently. There is no way to get notified on a phone, respond to an agent question from Discord, or get a daily summary of pipeline activity. Agents also cannot communicate with each other -- they work in isolation with no message passing.

## Concept

The messenger is **not an agent**. It is infrastructure -- a communication layer built from hooks, formatters, and transport adapters. It does not reason or make decisions. It transforms pipeline events into messages and delivers them through configured channels.

### Architecture

```
Pipeline Event --> Hook captures --> Formatter --> Transport --> Channel
                                                                (Discord, Telegram, Slack)

Channel Response --> Transport --> Parser --> Controller action
                                              (answer question, approve advance)
```

### Event Sources

Events are captured by hooks that fire on pipeline state changes:

| Event | Trigger | Data |
|-------|---------|------|
| `task.created` | Task file written | task id, title, assignee |
| `task.advanced` | Stage transition | task id, from_stage, to_stage, assignee |
| `task.completed` | Archived | task id, title, iterations, duration |
| `task.blocked` | Max iterations reached | task id, reason, last review |
| `task.failed` | Review failed | task id, issues summary |
| `agent.started` | Agent spawned | task id, role, model |
| `agent.completed` | Agent finished | task id, role, result |
| `agent.question` | Agent needs input | task id, role, question text |

### Message Formatting

Each channel has a formatter that converts events into channel-native format:

- **Discord**: Markdown with embeds, color-coded by event type (green=passed, red=failed, yellow=blocked)
- **Telegram**: HTML with inline buttons for quick actions (approve, reject, view details)
- **Slack**: Block Kit JSON with action buttons
- **Terminal**: Current behavior -- plain text in the Claude Code session (always active as fallback)

### Transport Layer

**Outbound**:
- Discord: Webhook POST (simple, no bot needed for outbound-only)
- Telegram: Bot API `sendMessage`
- Slack: Incoming webhook
- All via Bash `curl` commands in hook scripts

**Inbound** (receiving responses):
- MCP server that polls or listens for channel messages
- Alternatively: a simple polling script that checks a channel for replies and writes them to `.agent/inbox/`
- The controller reads the inbox and acts on messages

### Configuration

`.agent/messenger.md`:

```yaml
---
enabled: true
channels:
  discord:
    enabled: true
    webhook_url: ${DISCORD_WEBHOOK_URL}
    channel_name: project-updates
    events: [task.completed, task.blocked, task.failed, agent.question]
  telegram:
    enabled: false
    bot_token: ${TELEGRAM_BOT_TOKEN}
    chat_id: ${TELEGRAM_CHAT_ID}
    events: [all]
  terminal:
    enabled: true
    events: [all]
notify:
  on_complete: true
  on_block: true
  on_fail: true
  on_question: true
  daily_summary: false
  summary_time: "09:00"
quiet_hours:
  enabled: false
  start: "22:00"
  end: "08:00"
---
```

Secrets (`webhook_url`, `bot_token`) reference environment variables, never stored in plaintext.

## Relationship to Current System

The existing Stop hook that reminds about ready tasks is the simplest form of the messenger -- terminal-only, session-end-only. The messenger generalizes this to any event, any channel, any time.

The messenger does not replace any existing component. It adds a layer on top. All current terminal output continues to work. External channels are additive.

## Key Abstractions

**Event** -- A structured record of something that happened in the pipeline. Has a type, timestamp, task reference, and payload.

**Channel** -- A delivery target with its own formatter and transport. Channels are independent -- enabling Discord doesn't affect Telegram.

**Formatter** -- Converts an Event into a channel-specific message format. Stateless, pure transformation.

**Transport** -- Handles delivery mechanics (HTTP POST, API call). Handles retries and error logging.

**Inbox** -- `.agent/inbox/` directory where inbound messages land as individual files. The controller processes and deletes them.

**Message Template** -- Optional user-customizable templates for each event type. Defaults provided, overridable in config.

## Interaction Patterns

- **controller** emits events after every state transition. The messenger's hooks subscribe to the same triggers but focus on notification rather than orchestration.
- **roles** -- The messenger is role-agnostic. It operates on pipeline events, not agent internals.
- **init-roles** -- No direct interaction.
- **init-skills** -- Could recommend installing messenger channel adapters based on detected project communication tools.
- **learn** -- No direct interaction.

### Message Flow Example

```
1. Implementer finishes TASK-004, sets status: ready
2. SubagentStop hook fires
3. Controller advances TASK-004 to reviewing, spawns reviewer
4. Controller emits event: task.advanced(TASK-004, implementing -> reviewing)
5. Messenger hook captures event
6. Formatter: "TASK-004 *Add rate limiting* moved to **reviewing** (reviewer assigned)"
7. Transport: POST to Discord webhook
8. User sees notification on phone

--- Later ---

9. Reviewer fails TASK-004
10. Controller sets fixing, emits task.failed event
11. Messenger: "TASK-004 review failed: 2 issues found. [View report]"
12. User replies in Discord: "proceed with fixes"
13. Inbound transport writes to .agent/inbox/msg-001.md
14. Controller reads inbox, confirms, spawns implementer for fixing
```

## Open Questions

1. **Secrets management** -- Environment variables work but are session-scoped. Should there be a `.agent/.secrets` file (gitignored)? Or rely on system env?
2. **Inbound complexity** -- Receiving messages requires either a running server (MCP) or polling. Polling from where? A SessionStart hook that checks channels? This is the hardest part.
3. **Message deduplication** -- If the controller and messenger hooks fire on the same event, how to avoid duplicate processing? Separate concerns: controller acts, messenger notifies.
4. **Rate limiting** -- Chatty pipelines could flood channels. Batch notifications? Configurable throttle?
5. **Multi-user** -- If multiple users monitor the same project channel, how are responses attributed? Likely out of scope for v1.
6. **Agent-to-agent messaging** -- Should agents be able to send messages to each other through the messenger? Or is that a controller concern?

## Future Possibilities

- **Bidirectional Discord bot** -- Full bot (not just webhook) that accepts commands: `/status`, `/advance TASK-004`, `/block TASK-005`.
- **Daily digest** -- Scheduled summary of pipeline activity sent to configured channel.
- **Escalation rules** -- If a task is blocked for >N hours, escalate to a different channel or user.
- **Rich media** -- Attach code diffs, test reports, or design screenshots to messages.
- **Presence awareness** -- Track whether the user is active in terminal. If yes, skip external notifications. If not, send them.
- **Audit log** -- All messages (sent and received) logged to `.agent/logs/messenger.log` for debugging and compliance.
