# Messenger Design

**Date:** 2026-02-10
**Status:** DRAFT
**Depends on:** `docs/concepts/messenger.md`, `docs/designs/controller-design.md`

---

## Overview

The messenger is system-level communication infrastructure -- not an agent -- that transforms pipeline events into channel-specific messages and delivers them to external services (Discord, Telegram, Slack) and the terminal. It is outbound-only in v1: it receives structured events emitted by the controller's state transitions, formats them using per-channel templates, and sends them via webhook HTTP requests executed as `curl` commands in hook scripts. The messenger is stateless, role-agnostic, and never makes pipeline decisions; it only observes and notifies.

---

## Decisions

| Question | Decision | Rationale |
|----------|----------|-----------|
| Secrets management | Environment variables only. A `.env` file (gitignored) for convenience. Document required vars per channel. | Secrets must never appear in committed files. Environment variables are session-scoped and universally supported. The `.env` file provides local convenience without risk if gitignored. |
| Inbound messages | Deferred to v2. Outbound-only for v1. | Inbound requires either a running server (MCP) or polling infrastructure. Both add complexity disproportionate to v1 scope. Outbound webhooks cover the primary use case: knowing what happened while away from the terminal. |
| Deduplication | Controller emits events; messenger subscribes. Separate hooks, no overlap. | The controller hook handles state transitions (read files, apply rules, spawn agents). The messenger hook handles notification (format message, send to channels). Same trigger, different concerns. No shared state, no risk of double-processing. |
| Rate limiting | Max 1 message per event. Optional batch mode configurable per channel. | Each pipeline event produces at most one message per channel. Batch mode (configurable) collects events over a window and sends a single summary. This prevents flooding during rapid pipeline activity. |
| Multi-user | Out of scope for v1. Single user per project. | Multi-user adds attribution, permissions, and channel-per-user routing. None of this is needed for the single-operator use case that v1 targets. |
| Agent-to-agent messaging | Out of scope. Agents communicate via task files. | Agents are isolated by design. They read and write task files, not messages. The controller orchestrates transitions. Adding a message bus between agents would undermine this architecture. |
| Configuration file format | YAML frontmatter in `.agent/messenger.md` | Consistent with all other `.agent/` files (config.md, controller-state.md, task files). Human-readable, editable in any text editor. |
| Hook model | `type: prompt` with haiku | The messenger hook reads config, formats a message, and runs a curl command. This is simple procedural work. Haiku is sufficient and cost-effective. |

---

## Event Schema

All events follow a common envelope structure. The controller emits these events as part of its state transition logic. The messenger hook reconstructs the event by reading the task file and controller state after the transition.

### Envelope

```yaml
type: <event_type>
timestamp: <ISO 8601>
task_id: <TASK-NNN>
data: <event-specific fields>
```

### Event Types

#### task.created

Emitted when a new task file is written by the `task-create` skill.

```yaml
type: task.created
timestamp: 2026-02-10T14:00:00Z
task_id: TASK-004
data:
  title: "Add rate limiting to API"
  assignee: planner
  tags: [backend, performance]
```

#### task.advanced

Emitted when the controller advances a task to a new pipeline stage.

```yaml
type: task.advanced
timestamp: 2026-02-10T14:30:00Z
task_id: TASK-004
data:
  from_stage: planning
  to_stage: implementing
  assignee: coder
  mode: semi-auto
```

#### task.completed

Emitted when a task reaches the `completed` stage and is archived.

```yaml
type: task.completed
timestamp: 2026-02-10T16:00:00Z
task_id: TASK-004
data:
  title: "Add rate limiting to API"
  iterations: 1
  duration_minutes: 120
  stages_passed: [planning, implementing, reviewing, completed]
```

#### task.blocked

Emitted when a task hits `max_iterations` and cannot advance further.

```yaml
type: task.blocked
timestamp: 2026-02-10T15:45:00Z
task_id: TASK-004
data:
  title: "Add rate limiting to API"
  stage: reviewing
  iterations: 3
  max_iterations: 3
  last_review_summary: "Test coverage below threshold, missing edge case handling"
```

#### task.failed

Emitted when a review sets `status: failed` (but iterations are still below max).

```yaml
type: task.failed
timestamp: 2026-02-10T15:30:00Z
task_id: TASK-004
data:
  title: "Add rate limiting to API"
  stage: reviewing
  iteration: 2
  issues_count: 3
  issues_summary: "Missing input validation, test coverage at 65%, unused import"
```

#### task.cancelled

Emitted when a task is explicitly cancelled by the user.

```yaml
type: task.cancelled
timestamp: 2026-02-10T15:00:00Z
task_id: TASK-004
data:
  title: "Add rate limiting to API"
  previous_stage: implementing
  reason: "Requirements changed, no longer needed"
```

#### agent.started

Emitted when the controller spawns an agent for a task.

```yaml
type: agent.started
timestamp: 2026-02-10T14:31:00Z
task_id: TASK-004
data:
  role: coder
  model: sonnet
  stage: implementing
  max_turns: 50
```

#### agent.completed

Emitted when an agent finishes work (SubagentStop fires with a valid status update).

```yaml
type: agent.completed
timestamp: 2026-02-10T15:15:00Z
task_id: TASK-004
data:
  role: coder
  stage: implementing
  result_status: ready
  turns_used: 34
```

#### agent.error

Emitted when the controller detects an agent crash (status unchanged after SubagentStop).

```yaml
type: agent.error
timestamp: 2026-02-10T15:20:00Z
task_id: TASK-004
data:
  role: coder
  stage: implementing
  error: "Agent crashed (status unchanged after completion)"
```

---

## Channel Adapters

Each channel adapter is responsible for: reading its configuration from `.agent/messenger.md`, formatting the event into channel-native markup, executing the transport (curl), and handling errors.

### Discord

**Configuration fields** (in `.agent/messenger.md`):

```yaml
discord:
  enabled: true
  webhook_url_env: DISCORD_WEBHOOK_URL
  events: [task.completed, task.blocked, task.failed, agent.error]
  format: embed
```

**Required environment variables:**

| Variable | Description | Example |
|----------|-------------|---------|
| `DISCORD_WEBHOOK_URL` | Discord channel webhook URL | `https://discord.com/api/webhooks/1234567890/abcdefg` |

**Message format example** (embed with color coding):

```json
{
  "embeds": [{
    "title": "TASK-004 Advanced to reviewing",
    "description": "**Add rate limiting to API**\nMoved from `implementing` to `reviewing`\nAssigned to: code-reviewer",
    "color": 3447003,
    "timestamp": "2026-02-10T14:30:00Z",
    "footer": { "text": "team-pipeline" }
  }]
}
```

Color codes: `3066993` (green) = completed/passed, `15158332` (red) = failed/error/blocked, `16776960` (yellow) = advanced/started, `3447003` (blue) = created/info.

**Transport mechanism:**

```bash
curl -s -o /dev/null -w "%{http_code}" \
  -H "Content-Type: application/json" \
  -d '{"embeds":[{"title":"TASK-004 Advanced to reviewing","description":"**Add rate limiting to API**\nMoved from `implementing` to `reviewing`\nAssigned to: code-reviewer","color":3447003,"timestamp":"2026-02-10T14:30:00Z","footer":{"text":"team-pipeline"}}]}' \
  "$DISCORD_WEBHOOK_URL"
```

**Error handling:** If the HTTP response is not `2xx`, retry once after 2 seconds. If the retry fails, log the failure to terminal and continue. Never block the pipeline.

### Telegram

**Configuration fields** (in `.agent/messenger.md`):

```yaml
telegram:
  enabled: true
  bot_token_env: TELEGRAM_BOT_TOKEN
  chat_id_env: TELEGRAM_CHAT_ID
  events: [all]
  format: html
```

**Required environment variables:**

| Variable | Description | Example |
|----------|-------------|---------|
| `TELEGRAM_BOT_TOKEN` | Telegram Bot API token | `7123456789:AAF...` |
| `TELEGRAM_CHAT_ID` | Target chat/group ID | `-1001234567890` |

**Message format example** (HTML):

```html
<b>TASK-004 Advanced to reviewing</b>

<b>Add rate limiting to API</b>
Stage: <code>implementing</code> -> <code>reviewing</code>
Assigned to: code-reviewer
Mode: semi-auto

<i>team-pipeline | 2026-02-10 14:30</i>
```

**Transport mechanism:**

```bash
curl -s -o /dev/null -w "%{http_code}" \
  -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  -d chat_id="${TELEGRAM_CHAT_ID}" \
  -d parse_mode="HTML" \
  -d text="<b>TASK-004 Advanced to reviewing</b>%0A%0A<b>Add rate limiting to API</b>%0AStage: <code>implementing</code> -> <code>reviewing</code>%0AAssigned to: code-reviewer%0AMode: semi-auto%0A%0A<i>team-pipeline | 2026-02-10 14:30</i>"
```

**Error handling:** Same as Discord. Retry once after 2 seconds, then log and continue.

### Slack

**Configuration fields** (in `.agent/messenger.md`):

```yaml
slack:
  enabled: true
  webhook_url_env: SLACK_WEBHOOK_URL
  events: [task.completed, task.blocked, task.failed]
  format: blocks
```

**Required environment variables:**

| Variable | Description | Example |
|----------|-------------|---------|
| `SLACK_WEBHOOK_URL` | Slack incoming webhook URL | `https://hooks.slack.com/services/T00/B00/xxxx` |

**Message format example** (Block Kit):

```json
{
  "blocks": [
    {
      "type": "header",
      "text": { "type": "plain_text", "text": "TASK-004 Advanced to reviewing" }
    },
    {
      "type": "section",
      "fields": [
        { "type": "mrkdwn", "text": "*Task:*\nAdd rate limiting to API" },
        { "type": "mrkdwn", "text": "*Stage:*\n`implementing` -> `reviewing`" },
        { "type": "mrkdwn", "text": "*Assignee:*\ncode-reviewer" },
        { "type": "mrkdwn", "text": "*Mode:*\nsemi-auto" }
      ]
    },
    {
      "type": "context",
      "elements": [
        { "type": "mrkdwn", "text": "team-pipeline | 2026-02-10 14:30" }
      ]
    }
  ]
}
```

**Transport mechanism:**

```bash
curl -s -o /dev/null -w "%{http_code}" \
  -H "Content-Type: application/json" \
  -d '{"blocks":[{"type":"header","text":{"type":"plain_text","text":"TASK-004 Advanced to reviewing"}},{"type":"section","fields":[{"type":"mrkdwn","text":"*Task:*\nAdd rate limiting to API"},{"type":"mrkdwn","text":"*Stage:*\n`implementing` -> `reviewing`"},{"type":"mrkdwn","text":"*Assignee:*\ncode-reviewer"},{"type":"mrkdwn","text":"*Mode:*\nsemi-auto"}]},{"type":"context","elements":[{"type":"mrkdwn","text":"team-pipeline | 2026-02-10 14:30"}]}]}' \
  "$SLACK_WEBHOOK_URL"
```

**Error handling:** Same as Discord and Telegram.

### Terminal

**Configuration fields** (in `.agent/messenger.md`):

```yaml
terminal:
  enabled: true
  events: [all]
```

**Required environment variables:** None.

**Message format example** (plain text):

```
[pipeline] TASK-004 advanced: implementing -> reviewing (assigned: code-reviewer)
           Add rate limiting to API
```

**Transport mechanism:** Direct output to the Claude Code chat via the hook's prompt response. No HTTP calls.

**Error handling:** Terminal output cannot fail. This is the always-on fallback channel.

---

## Hook Integration

The messenger hooks coexist with the controller hooks in the same `hooks/hooks.json` file. Both subscribe to the same Claude Code hook events but serve different purposes: the controller handles state transitions and orchestration, the messenger handles notification delivery.

### Hook Ordering

Claude Code executes hooks in array order within each event. The controller hook entry comes first, the messenger hook entry comes second. This guarantees that:

1. The controller has finished its state transition (updated task file, controller state) before the messenger reads the result.
2. The messenger always reads the post-transition state, not the pre-transition state.

### Avoiding Double-Processing

There is no risk of double-processing because the concerns are disjoint:

- **Controller hook**: Reads task status, applies transition rules, updates task file, spawns agents. Does NOT send external notifications.
- **Messenger hook**: Reads the updated task file and controller state, formats messages, sends to channels. Does NOT modify any pipeline state.

The messenger hook determines which event just occurred by reading the task file's current state and the `last_event` field from `controller-state.md`. It does not independently interpret agent output or apply transition logic.

### hooks.json Entry

The messenger adds a second entry to each relevant hook event array. The complete `hooks.json` with both controller and messenger hooks:

```json
{
  "description": "Team pipeline controller and messenger hooks",
  "hooks": {
    "SubagentStop": [
      {
        "hooks": [
          {
            "type": "prompt",
            "prompt": "<controller SubagentStop prompt -- see controller-design.md>",
            "model": "sonnet"
          }
        ]
      },
      {
        "hooks": [
          {
            "type": "prompt",
            "prompt": "You are the pipeline messenger. You send notifications about pipeline events to external channels. Follow these steps EXACTLY.\n\n1. READ MESSENGER CONFIG\n   - Read `.agent/messenger.md` frontmatter.\n   - If `enabled` is false, STOP.\n   - If the file does not exist, STOP.\n\n2. DETERMINE EVENT\n   - Read `.agent/controller-state.md` -> `last_event` field.\n   - If `last_event` is null or unchanged from previous check, STOP.\n   - Read the task file referenced in `last_event.task`.\n   - Map `last_event.type` to a messenger event type:\n     - `agent_complete` + task `stage: completed` -> `task.completed`\n     - `agent_complete` + task advanced to new stage -> `task.advanced`\n     - `agent_crash` -> `agent.error`\n     - `task_blocked` -> `task.blocked`\n   - If the task `status` is `failed`, emit `task.failed`.\n   - Construct the event payload from the task file fields.\n\n3. FOR EACH ENABLED CHANNEL\n   - Check if the channel's `events` list includes this event type (or `all`).\n   - Check if `notification_rules` allow this event (on_complete, on_block, on_fail).\n   - Check `quiet_hours`: if enabled and current time is within quiet range, skip external channels (terminal still sends).\n   - If the event is filtered out, skip this channel.\n\n4. FORMAT MESSAGE\n   - Read `message_templates` from messenger config if present. Otherwise use defaults.\n   - Apply the template for this event type with variable substitution.\n   - Format for the channel: Discord (embed JSON), Telegram (HTML), Slack (Block Kit JSON), Terminal (plain text).\n\n5. SEND MESSAGE\n   - Terminal: output the formatted message directly.\n   - Discord: read env var named in `webhook_url_env`. Run curl POST to Discord webhook with embed JSON. Capture HTTP status code.\n   - Telegram: read env vars named in `bot_token_env` and `chat_id_env`. Run curl POST to Telegram Bot API sendMessage. Capture HTTP status code.\n   - Slack: read env var named in `webhook_url_env`. Run curl POST to Slack webhook with blocks JSON. Capture HTTP status code.\n\n6. HANDLE ERRORS\n   - If HTTP status is not 2xx: wait 2 seconds, retry once.\n   - If retry also fails: log 'Messenger: failed to send to {channel} (HTTP {status})' to terminal. Continue to next channel.\n   - If the environment variable for a channel is not set: log 'Messenger: {channel} skipped (missing {env_var})' to terminal. Continue.\n   - Never block the pipeline. Never set task status. Never modify any files.",
            "model": "haiku"
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "prompt",
            "prompt": "<controller SessionStart prompt -- see controller-design.md>",
            "model": "haiku"
          }
        ]
      },
      {
        "hooks": [
          {
            "type": "prompt",
            "prompt": "You are the pipeline messenger performing startup validation. Follow these steps EXACTLY.\n\n1. Check if `.agent/messenger.md` exists. If not, STOP.\n2. Read `.agent/messenger.md` frontmatter.\n3. If `enabled` is false, STOP.\n4. For each enabled channel, check if its required environment variable is set:\n   - Discord: check if the env var named in `webhook_url_env` is set.\n   - Telegram: check if the env vars named in `bot_token_env` and `chat_id_env` are set.\n   - Slack: check if the env var named in `webhook_url_env` is set.\n5. Report status:\n   - For each channel: '{channel}: ready' or '{channel}: MISSING {env_var} -- notifications will be skipped'\n6. Report: 'Messenger: {n} channels active.'",
            "model": "haiku"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "prompt",
            "prompt": "<controller Stop prompt -- see controller-design.md>",
            "model": "haiku"
          }
        ]
      }
    ]
  }
}
```

### Hook Summary

| Hook Event | Order | Component | Model | Purpose |
|------------|-------|-----------|-------|---------|
| `SubagentStop` | 1 | Controller | sonnet | State transitions, agent spawning, queue management |
| `SubagentStop` | 2 | Messenger | haiku | Read post-transition state, format and send notifications |
| `SessionStart` | 1 | Controller | haiku | Detect stale tasks, offer recovery |
| `SessionStart` | 2 | Messenger | haiku | Validate channel configs, warn on missing secrets |
| `Stop` | 1 | Controller | haiku | Display pipeline summary |
| `Stop` | -- | Messenger | -- | No messenger hook on Stop (controller summary is sufficient) |

---

## Message Templates

Each event type has a default template. Templates use `{variable}` placeholder syntax. The user can override templates in the `message_templates` section of `.agent/messenger.md`.

### Default Templates

#### task.created

```
{task_id} created: {title}
Assigned to: {assignee} | Tags: {tags}
```

#### task.advanced

```
{task_id} advanced: {from_stage} -> {to_stage}
{title}
Assigned to: {assignee}
```

#### task.completed

```
{task_id} completed: {title}
Duration: {duration_minutes} min | Iterations: {iterations}
Stages: {stages_passed}
```

#### task.blocked

```
{task_id} BLOCKED: {title}
Stage: {stage} | Iterations: {iterations}/{max_iterations}
Last review: {last_review_summary}
```

#### task.failed

```
{task_id} review failed: {title}
Iteration: {iteration} | Issues: {issues_count}
{issues_summary}
```

#### task.cancelled

```
{task_id} cancelled: {title}
Was at: {previous_stage}
Reason: {reason}
```

#### agent.started

```
{task_id} agent started: {role} ({model})
Stage: {stage} | Max turns: {max_turns}
```

#### agent.completed

```
{task_id} agent finished: {role}
Stage: {stage} | Result: {result_status} | Turns: {turns_used}
```

#### agent.error

```
{task_id} AGENT ERROR: {role}
Stage: {stage}
{error}
```

### Channel-Specific Formatting

Templates produce a channel-neutral text. Each channel adapter wraps that text in its native format.

**Discord (Markdown embed):**

```json
{
  "embeds": [{
    "title": "TASK-004 BLOCKED: Add rate limiting to API",
    "description": "**Stage:** `reviewing` | **Iterations:** 3/3\n**Last review:** Test coverage below threshold, missing edge case handling",
    "color": 15158332,
    "timestamp": "2026-02-10T15:45:00Z",
    "footer": { "text": "team-pipeline" }
  }]
}
```

**Telegram (HTML):**

```html
<b>TASK-004 BLOCKED: Add rate limiting to API</b>

<b>Stage:</b> <code>reviewing</code> | <b>Iterations:</b> 3/3
<b>Last review:</b> Test coverage below threshold, missing edge case handling

<i>team-pipeline | 2026-02-10 15:45</i>
```

### Template Customization

Users can override any template in `.agent/messenger.md`:

```yaml
message_templates:
  task.completed: "{task_id} done! {title} ({duration_minutes}m, {iterations} iterations)"
  task.blocked: "URGENT: {task_id} stuck at {stage} after {iterations} tries - {last_review_summary}"
```

Only overridden templates need to be specified. All others use defaults.

---

## Configuration Schema

**File:** `.agent/messenger.md`

```yaml
---
enabled: true
channels:
  discord:
    enabled: true
    webhook_url_env: DISCORD_WEBHOOK_URL
    events: [task.completed, task.blocked, task.failed, agent.error]
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
    events: [task.completed, task.blocked, task.failed]
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

This file controls pipeline notification delivery. Edit channel settings and notification rules as needed.

## Setup

1. Enable desired channels above.
2. Set environment variables for each channel (see field reference below).
3. Optionally create a `.env` file (gitignored) for convenience:
   ```
   DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
   TELEGRAM_BOT_TOKEN=7123456789:AAF...
   TELEGRAM_CHAT_ID=-1001234567890
   SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
   ```
4. Run a new session to validate: the messenger SessionStart hook will report channel status.
```

### Field Reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `true` | Global messenger on/off switch. When false, no hooks execute. |
| `channels` | object | -- | Container for all channel configurations. |
| `channels.discord` | object | -- | Discord channel adapter configuration. |
| `channels.discord.enabled` | boolean | `false` | Enable Discord notifications. |
| `channels.discord.webhook_url_env` | string | `DISCORD_WEBHOOK_URL` | Name of the environment variable holding the Discord webhook URL. |
| `channels.discord.events` | list[string] | `[all]` | Event types to send. Use `all` for everything, or list specific types. |
| `channels.discord.format` | string | `embed` | Message format. Only `embed` is supported in v1. |
| `channels.telegram` | object | -- | Telegram channel adapter configuration. |
| `channels.telegram.enabled` | boolean | `false` | Enable Telegram notifications. |
| `channels.telegram.bot_token_env` | string | `TELEGRAM_BOT_TOKEN` | Name of the environment variable holding the Telegram bot token. |
| `channels.telegram.chat_id_env` | string | `TELEGRAM_CHAT_ID` | Name of the environment variable holding the Telegram chat ID. |
| `channels.telegram.events` | list[string] | `[all]` | Event types to send. |
| `channels.telegram.format` | string | `html` | Message format. Only `html` is supported in v1. |
| `channels.slack` | object | -- | Slack channel adapter configuration. |
| `channels.slack.enabled` | boolean | `false` | Enable Slack notifications. |
| `channels.slack.webhook_url_env` | string | `SLACK_WEBHOOK_URL` | Name of the environment variable holding the Slack incoming webhook URL. |
| `channels.slack.events` | list[string] | `[all]` | Event types to send. |
| `channels.slack.format` | string | `blocks` | Message format. Only `blocks` (Block Kit) is supported in v1. |
| `channels.terminal` | object | -- | Terminal output configuration. |
| `channels.terminal.enabled` | boolean | `true` | Enable terminal notifications. Always-on fallback. |
| `channels.terminal.events` | list[string] | `[all]` | Event types to display in terminal. |
| `notification_rules` | object | -- | Global rules applied after channel event filtering. |
| `notification_rules.on_complete` | boolean | `true` | Send notification when a task completes. |
| `notification_rules.on_block` | boolean | `true` | Send notification when a task is blocked. |
| `notification_rules.on_fail` | boolean | `true` | Send notification when a review fails. |
| `notification_rules.quiet_hours` | object | -- | Suppress external channel notifications during specified hours. |
| `notification_rules.quiet_hours.enabled` | boolean | `false` | Enable quiet hours. |
| `notification_rules.quiet_hours.start` | string (HH:MM) | `"22:00"` | Start of quiet period (local time). |
| `notification_rules.quiet_hours.end` | string (HH:MM) | `"08:00"` | End of quiet period (local time). |
| `message_templates` | map[string, string] | `{}` | Per-event-type template overrides. Keys are event type names, values are template strings with `{variable}` placeholders. |

### Valid Event Type Names for `events` Lists

| Event Type | Triggered By |
|------------|-------------|
| `task.created` | `task-create` skill writes a new task file |
| `task.advanced` | Controller advances a task to a new stage |
| `task.completed` | Controller archives a completed task |
| `task.blocked` | Controller sets BLOCKED after max iterations |
| `task.failed` | Reviewer sets `status: failed` |
| `task.cancelled` | User runs `/task cancel` |
| `agent.started` | Controller spawns a subagent |
| `agent.completed` | Controller detects successful agent completion |
| `agent.error` | Controller detects agent crash |
| `all` | Matches every event type |

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Webhook returns non-2xx HTTP status | Retry once after 2 seconds. If retry also fails, log `Messenger: failed to send to {channel} (HTTP {status})` to terminal. Continue to next channel. |
| Channel misconfigured (invalid config fields) | Skip the channel. Log `Messenger: {channel} has invalid configuration, skipping` to terminal. Continue to next channel. |
| All external channels fail | Terminal fallback always works (direct chat output, no HTTP). The user sees the notification in the Claude Code session regardless of external channel failures. |
| Required environment variable missing | Skip the channel. On `SessionStart`, warn: `Messenger: {channel} skipped (missing {env_var})`. On `SubagentStop`, silently skip (warning was already given at session start). |
| `.agent/messenger.md` does not exist | All messenger hooks exit immediately. No notifications, no errors. The pipeline operates as if the messenger is not installed. |
| `enabled: false` in messenger config | All messenger hooks exit immediately. Same as non-existent config. |
| `last_event` in controller state is null | Messenger cannot determine what happened. Skip notification, log to terminal: `Messenger: no event to process`. |
| curl command not available | Bash execution fails. The hook's prompt model reports the error in terminal. External channels are non-functional but the pipeline is unaffected. |

### Error Handling Principles

1. **Never block the pipeline.** The messenger never sets task status, modifies task files, or interferes with controller state. A total messenger failure has zero impact on pipeline operation.
2. **Fail open.** If any part of the notification chain fails, skip it and continue. The terminal fallback ensures the user is always informed within the active session.
3. **Warn early.** The `SessionStart` hook validates all channel configurations and secrets upfront so the user knows about problems before any pipeline events occur.

---

## Scope Boundaries

### In Scope (v1)

- Outbound notifications to Discord, Telegram, Slack, and terminal
- Webhook-based transport (curl POST)
- Structured event schema (9 event types)
- Per-channel event filtering
- Configurable message templates with variable substitution
- Channel-specific formatting (Discord embeds, Telegram HTML, Slack Block Kit, terminal plain text)
- Quiet hours for external channels
- Error handling with single retry
- SessionStart channel validation
- `.agent/messenger.md` configuration file
- Secrets via environment variables

### Deferred (v2+)

- Inbound messages (receiving replies from channels)
- Bidirectional Discord/Telegram/Slack bots
- Daily digest / scheduled summary
- Escalation rules (blocked > N hours triggers different notification)
- Rich media attachments (code diffs, screenshots, test reports)
- Presence awareness (skip external notifications when user is active in terminal)
- Batch mode implementation (config field reserved, delivery logic deferred)
- Audit log (`.agent/logs/messenger.log`)
- Multi-user attribution and per-user channel routing
- Agent-to-agent messaging
