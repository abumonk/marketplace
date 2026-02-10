# Lead Role Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the hook-based controller and messenger with a single LLM-powered lead agent that observes the pipeline, reasons about state, and proposes actions to the user.

**Architecture:** The lead is a sonnet agent (maxTurns: 10) triggered by three hooks (SubagentStop, SessionStart, Stop). On automatic triggers it performs lightweight evaluation and only surfaces proposals when attention-worthy. On-demand via `/task lead` it performs full analysis. State stored in `.agent/lead-state.md`. Messenger config simplified to severity-based filtering.

**Tech Stack:** Claude Code plugin system (agents, hooks, skills, commands). YAML frontmatter. Bash curl for external notifications.

---

### Task 1: Create Lead Role Template

**Files:**
- Create: `roles/templates/lead.md`

**Step 1: Write the lead role template**

Create `roles/templates/lead.md` with this exact content:

```markdown
---
name: lead
description: >
  Pipeline orchestrator and advisor. Observes all stages, proposes
  transitions, assigns roles, crafts contextual notifications.
  Full authority, zero autonomy - always proposes, never acts alone.
model: sonnet
maxTurns: 10
memory: project
tools: [Read, Glob, Grep, Write, Edit, Bash]
disallowedTools: [Task]
skills: []
knowledge: [pipeline-rules, roles, decisions]
pipeline_stages: [all]
---

You are the Lead agent in a task processing pipeline.

## Your Job

You are the pipeline's orchestrator and advisor. You observe all stages, analyze state transitions, and propose actions to the user. You have full authority over the pipeline but zero autonomy -- you always propose and wait for user approval before anything is executed.

## Trigger Context

You are invoked in one of three contexts (check the prompt for which):

### Automatic: SubagentStop
An agent just completed work on a task. You must:
1. Read `.agent/lead-state.md` for current pipeline state
2. Read the task file referenced in the trigger context
3. Check task status and determine what happened
4. Detect crashes (status still `in_progress` after agent completion)
5. Remove completed agent from `active_agents` in lead state
6. Evaluate: does this need user attention?
   - If routine completion with obvious next step and no complications: update lead state silently, STOP
   - If attention-worthy (see conditions below): surface a proposal

### Automatic: SessionStart
A new session started. You must:
1. Read `.agent/lead-state.md`
2. Check for stale `active_agents` (agents from previous session)
3. Check for accumulated `pending_proposals`
4. Summarize pipeline state and present pending decisions

### Automatic: Stop
Session is ending. You must:
1. Read `.agent/lead-state.md`
2. Brief pipeline status (active agents, queue, pending proposals)
3. Note any actionable items for next session

### On-Demand: /task lead
User requested full analysis. You must:
1. Read `.agent/lead-state.md`
2. Read ALL task files in `.agent/tasks/`
3. Read `.agent/config.md` for stage assignments and settings
4. Read `.agent/messenger.md` for channel config
5. Present comprehensive pipeline report with recommendations

## Attention-Worthy Conditions

Surface a proposal when ANY of these occur:
- Task ready to advance (agent set status: ready/passed/failed/done)
- Task blocked (max iterations reached, unresolved dependency)
- Agent crashed (status still in_progress after completion)
- Multiple tasks ready, prioritization needed
- Pipeline idle with queued tasks waiting
- Dependency resolved, blocked task now eligible
- All tasks in a stage completed

Do NOT surface for:
- Routine state updates with no decisions needed
- Events the user already knows about

## Proposal Format

Always use this structure when surfacing recommendations:

```
## Pipeline Update

**Event**: {what happened}
**Status**: {current state}

### Recommendation

1. **{Action}** -> {details}
   Reason: {why this is the right move}

2. **{Action}** -> {details}
   Reason: {why}

### Also noting
- {other relevant observations}
- {queue state, dependencies, patterns}

Awaiting your decision.
```

## Decision Reasoning

You apply judgment beyond simple transition rules:
- Review failed 3rd time? Propose reassignment, task split, or scope adjustment
- Two tasks ready, one slot? Propose based on priority and downstream impact
- Agent crashed? Analyze context, propose retry with adjustments or reassignment
- All implementing done? Propose batch advancement, note review bottleneck risk
- User absent, queue backing up? Summarize accumulated state

## Transition Guidelines

These are guidelines, not hard rules. Use judgment for edge cases.
- (planning, ready) -> implementing
- (implementing, ready) -> reviewing
- (reviewing, passed) -> completed
- (reviewing, failed) -> fixing (if iterations < max_iterations, else BLOCKED)
- (fixing, ready) -> reviewing
- (researching, done) -> finalize

## Messenger Duties

When proposing actions, also craft notification messages for enabled channels:
- Read `.agent/messenger.md` for channel config
- Compose contextual messages (not templates) with event details
- Include relevant context: what changed, what it unblocks, what needs attention
- Format per channel: Discord (embed JSON), Telegram (HTML), Slack (Block Kit), Terminal (plain text with [pipeline] prefix)
- Severity levels: high (blocked, crashed, failed), normal (advanced, assigned), low (queued), info (completed batch)
- Only send to channels whose `events` list includes the event severity

When sending notifications, use Bash with curl for external channels. Terminal messages are output directly.

## State Management

Read and write `.agent/lead-state.md` to track:
- Active agents and their tasks
- Queue of waiting tasks
- Pending proposals awaiting user decisions
- Pattern notes (observations about recurring issues)
- Session context (tasks completed, durations)

## Role Resolution

When proposing which role to assign:
1. Read `.agent/config.md` -> `stage_assignments`
2. Read the role file from `.agent/roles/{role}.md` (if exists) or `agents/{role}.md`
3. Include role name and model in the proposal

## Rules

- NEVER advance tasks, spawn agents, or send notifications without user approval
- NEVER modify task files (status, stage, assignee) -- only propose changes
- ALWAYS write updated state to `.agent/lead-state.md` after analysis
- ALWAYS show reasoning for non-obvious recommendations
- Keep proposals concise -- numbered actions with one-line reasons
- If nothing needs attention, update state silently and STOP with no output
```

**Step 2: Verify the file was created**

Run: `ls -la R:/Claudovka/projects/team-pipeline/roles/templates/lead.md`
Expected: File exists with reasonable size (~4KB)

**Step 3: Commit**

```bash
cd R:/Claudovka/projects/team-pipeline
git add roles/templates/lead.md
git commit -m "feat: add lead role template - LLM-powered pipeline orchestrator"
```

---

### Task 2: Create Lead State File Template

**Files:**
- Modify: `skills/task-init/SKILL.md:61-75` (replace controller-state with lead-state)

**Step 1: Update task-init skill to create lead-state.md instead of controller-state.md**

In `skills/task-init/SKILL.md`, replace step 7 (lines 61-75) which creates `.agent/controller-state.md` with:

```markdown
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
```

**Step 2: Update messenger.md template in task-init**

In `skills/task-init/SKILL.md`, replace step 8 (lines 77-122) which creates `.agent/messenger.md` with simplified severity-based config:

```markdown
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
```

**Step 3: Update the final message in task-init step 10**

Replace the text in step 10 to reference the lead:
```
"Pipeline initialized. Run `/init-roles` to configure project-specific roles, or use `/task` to create your first task. The lead agent will manage pipeline orchestration."
```

**Step 4: Verify changes**

Run: `grep -n "lead-state\|controller-state\|lead agent" R:/Claudovka/projects/team-pipeline/skills/task-init/SKILL.md`
Expected: References to lead-state, no references to controller-state

**Step 5: Commit**

```bash
cd R:/Claudovka/projects/team-pipeline
git add skills/task-init/SKILL.md
git commit -m "refactor: task-init creates lead-state.md instead of controller-state.md"
```

---

### Task 3: Replace Controller/Messenger Hooks with Lead Hooks

**Files:**
- Modify: `hooks/hooks.json` (replace all hooks)

**Step 1: Write the new hooks.json**

Replace the entire contents of `hooks/hooks.json`. The new file has three hook events, each with a single hook that spawns the lead agent with context injection.

```json
{
  "description": "Lead agent pipeline hooks - intelligent orchestration and notifications",
  "hooks": {
    "SubagentStop": [
      {
        "hooks": [
          {
            "type": "prompt",
            "prompt": "You are the lead agent responding to a SubagentStop event. An agent just finished working on a task.\n\nFollow the instructions in your role definition at roles/templates/lead.md under the 'Automatic: SubagentStop' section.\n\nKey steps:\n1. Read `.agent/lead-state.md` for current state\n2. Find the task path (`.agent/tasks/TASK-\\d+.md`) from the completed agent's prompt context\n3. Read the task file to check what happened\n4. Read `.agent/config.md` for stage assignments and max_iterations\n5. Detect crashes (status still in_progress = crash)\n6. Update lead state: remove from active_agents, update last_event\n7. Check dependencies for downstream tasks\n8. Evaluate attention-worthiness\n9. If attention-worthy: surface a proposal using the standard format\n10. If routine: update state silently, produce no output\n11. If proposing notifications: read `.agent/messenger.md` and include notification plan in proposal\n\nRemember: PROPOSE only. Never advance tasks or spawn agents without user approval.",
            "model": "sonnet"
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "prompt",
            "prompt": "You are the lead agent responding to a SessionStart event. A new session just started.\n\nFollow the instructions in your role definition at roles/templates/lead.md under the 'Automatic: SessionStart' section.\n\nKey steps:\n1. Check if `.agent/lead-state.md` exists. If not, STOP (no pipeline initialized).\n2. Read `.agent/lead-state.md`\n3. Check `active_agents` - these are stale from previous session (no agents survive restart)\n4. For each stale agent: read the task file, check its status, flag what happened\n5. Check `pending_proposals` and `decisions_awaiting` - present accumulated items\n6. Check `queue` for waiting tasks\n7. Clear `active_agents` (they're all stale)\n8. Write updated lead state\n9. Present summary:\n   - Stale tasks needing attention (with options: retry/skip/cancel)\n   - Pending proposals from last session\n   - Queue status\n   - Pipeline mode and readiness\n10. Also validate messenger channels: read `.agent/messenger.md`, check env vars for enabled channels, report readiness\n\nRemember: PROPOSE recovery actions. Never execute without user approval.",
            "model": "sonnet"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "prompt",
            "prompt": "You are the lead agent responding to a Stop event. The session is ending.\n\nFollow the instructions in your role definition at roles/templates/lead.md under the 'Automatic: Stop' section.\n\nKey steps:\n1. Check if `.agent/lead-state.md` exists. If not, check `.agent/tasks/` for any tasks needing attention. STOP if none.\n2. Read `.agent/lead-state.md`\n3. Display brief pipeline status:\n   - Active agents (count, tasks, roles)\n   - Queue (count, waiting tasks)\n   - Pending proposals (count)\n4. Read task files in `.agent/tasks/` for actionable statuses (ready, passed, failed, error, BLOCKED)\n5. If actionable tasks exist, list them with recommended next actions\n6. Keep it brief - this is a session-end summary, not a full analysis\n\nProduce concise output. No proposals needed - just status awareness for next session.",
            "model": "haiku"
          }
        ]
      }
    ]
  }
}
```

Note: SubagentStop and SessionStart use sonnet (the lead needs reasoning). Stop uses haiku (just a brief summary).

**Step 2: Verify the JSON is valid**

Run: `node -e "JSON.parse(require('fs').readFileSync('R:/Claudovka/projects/team-pipeline/hooks/hooks.json','utf8')); console.log('Valid JSON')"`
Expected: "Valid JSON"

**Step 3: Commit**

```bash
cd R:/Claudovka/projects/team-pipeline
git add hooks/hooks.json
git commit -m "refactor: replace controller/messenger hooks with lead agent hooks"
```

---

### Task 4: Update Task Command for Lead

**Files:**
- Modify: `commands/task.md:48-59` (replace controller section with lead)

**Step 1: Replace the `/task controller` section with `/task lead`**

In `commands/task.md`, replace lines 48-59 (the `/task controller` section) with:

```markdown
### `/task lead`

Invoke the lead agent for on-demand pipeline analysis.

1. The lead agent reads all pipeline state:
   - `.agent/lead-state.md` (orchestration state)
   - `.agent/tasks/*.md` (all active tasks)
   - `.agent/config.md` (stage assignments, settings)
   - `.agent/messenger.md` (notification channels)
2. Presents comprehensive pipeline report:
   - Current task status across all stages
   - Pending decisions awaiting user input
   - Recommendations with reasoning
   - Queue and dependency analysis
   - Notification channel status
3. Proposes next actions as a numbered list
4. Awaits user decision

The lead agent follows its role definition at `roles/templates/lead.md` under the "On-Demand: /task lead" section.
```

**Step 2: Update argument-hint in frontmatter**

In `commands/task.md` line 4, replace:
```
argument-hint: [create|status|advance|complete|cancel|migrate|controller] [task-id|status|mode|pause|resume]
```
with:
```
argument-hint: [create|status|advance|complete|cancel|migrate|lead] [task-id]
```

**Step 3: Verify changes**

Run: `grep -n "lead\|controller" R:/Claudovka/projects/team-pipeline/commands/task.md`
Expected: References to `lead`, no references to `controller`

**Step 4: Commit**

```bash
cd R:/Claudovka/projects/team-pipeline
git add commands/task.md
git commit -m "refactor: replace /task controller with /task lead command"
```

---

### Task 5: Update Init-Roles to Include Lead

**Files:**
- Modify: `skills/init-roles/SKILL.md:76-88` (add lead to presets)

**Step 1: Add lead to all preset configurations**

In `skills/init-roles/SKILL.md`, update the preset table (lines 76-88) to include `lead` in every team and full preset:

| Project Type | solo | team | full |
|-------------|------|------|------|
| `frontend` | planner, implementer, reviewer | lead, planner, coder, code-reviewer, researcher, ux-designer | lead, planner, coder, code-reviewer, researcher, ux-designer, designer, qa-tester |
| `backend-node` | planner, implementer, reviewer | lead, planner, coder, code-reviewer, researcher, qa-tester | lead, planner, coder, code-reviewer, researcher, qa-tester, devops, designer |
| `backend-generic` | planner, implementer, reviewer | lead, planner, coder, code-reviewer, researcher, qa-tester | lead, planner, coder, code-reviewer, researcher, qa-tester, devops, designer |
| `fullstack` | planner, implementer, reviewer | lead, planner, coder, code-reviewer, researcher, ux-designer | lead, planner, coder, code-reviewer, researcher, ux-designer, qa-tester, designer, devops |
| `python` | planner, implementer, reviewer | lead, planner, coder, code-reviewer, researcher, qa-tester | lead, planner, coder, code-reviewer, researcher, qa-tester, devops, designer |
| `rust` | planner, implementer, reviewer | lead, planner, coder, code-reviewer, researcher, qa-tester | lead, planner, coder, code-reviewer, researcher, qa-tester, devops |
| `go` | planner, implementer, reviewer | lead, planner, coder, code-reviewer, researcher, qa-tester | lead, planner, coder, code-reviewer, researcher, qa-tester, devops |
| `java` | planner, implementer, reviewer | lead, planner, coder, code-reviewer, researcher, qa-tester | lead, planner, coder, code-reviewer, researcher, qa-tester, devops |
| `infra` | planner, implementer, reviewer | lead, planner, devops, code-reviewer, researcher, qa-tester | lead, planner, devops, code-reviewer, researcher, qa-tester, designer |
| `unknown` | planner, implementer, reviewer | lead, planner, coder, code-reviewer, researcher, implementer | lead, planner, coder, code-reviewer, researcher, implementer, reviewer, qa-tester |

Note: `lead` is NOT in `solo` presets (solo developers don't need orchestration). It IS first in every `team` and `full` preset.

**Step 2: Verify the lead appears in presets**

Run: `grep -c "lead" R:/Claudovka/projects/team-pipeline/skills/init-roles/SKILL.md`
Expected: 20 (2 columns x 10 rows)

**Step 3: Commit**

```bash
cd R:/Claudovka/projects/team-pipeline
git add skills/init-roles/SKILL.md
git commit -m "feat: add lead role to team and full presets in init-roles"
```

---

### Task 6: Update Documentation

**Files:**
- Modify: `docs/concepts/controller.md` (redirect to lead)
- Modify: `docs/concepts/messenger.md` (redirect to lead)
- Create: `docs/concepts/lead.md`

**Step 1: Create lead concept doc**

Create `docs/concepts/lead.md`:

```markdown
# Lead Role

The lead is an LLM-powered orchestration agent that replaces the deterministic controller hooks and stateless messenger hooks with a single intelligent agent.

## Core Principle

**Full authority, zero autonomy.** The lead can manage every aspect of the pipeline but never acts without user approval. It analyzes, recommends, and waits.

## Replaces

- **Controller**: Hook-based deterministic state machine for pipeline transitions
- **Messenger**: Hook-based stateless notification dispatcher

## Trigger Model

- **SubagentStop** (sonnet): Evaluates completed agent work, proposes next steps if attention-worthy
- **SessionStart** (sonnet): Recovers stale state, presents accumulated decisions
- **Stop** (haiku): Brief end-of-session pipeline summary
- **On-demand** (`/task lead`): Full pipeline analysis and recommendations

## Key Behaviors

- Silence by default: only surfaces proposals when something needs attention
- Contextual notifications: crafts messages based on actual context, not templates
- Pattern recognition: notices recurring issues (repeated failures, bottlenecks)
- Judgment-based decisions: proposes actions based on priority, impact, and dependencies

## State

Stored in `.agent/lead-state.md`. Combines orchestration state (active agents, queue) with analysis notes (patterns, proposals, session context).

## See Also

- [Lead Role Design](../designs/lead-role-design.md)
- [Roles System](roles.md)
```

**Step 2: Update controller.md to redirect**

Replace contents of `docs/concepts/controller.md` with:

```markdown
# Controller (Deprecated)

The controller has been replaced by the [Lead Role](lead.md).

The lead agent provides intelligent, LLM-powered orchestration instead of deterministic hook-based transitions. See the [lead design document](../designs/lead-role-design.md) for details.
```

**Step 3: Update messenger.md to redirect**

Replace contents of `docs/concepts/messenger.md` with:

```markdown
# Messenger (Deprecated)

The messenger has been replaced by the [Lead Role](lead.md).

The lead agent handles contextual notifications as part of its orchestration duties. See the [lead design document](../designs/lead-role-design.md) for details.
```

**Step 4: Commit**

```bash
cd R:/Claudovka/projects/team-pipeline
git add docs/concepts/lead.md docs/concepts/controller.md docs/concepts/messenger.md
git commit -m "docs: add lead concept, deprecate controller and messenger docs"
```

---

### Task 7: Final Verification

**Step 1: Check all files exist and are consistent**

Run:
```bash
cd R:/Claudovka/projects/team-pipeline
echo "=== Role template ===" && ls roles/templates/lead.md
echo "=== Hooks ===" && node -e "const h=JSON.parse(require('fs').readFileSync('hooks/hooks.json','utf8')); console.log(Object.keys(h.hooks).join(', ')); console.log('Hook count:', Object.values(h.hooks).flat().length)"
echo "=== Command ===" && grep "lead" commands/task.md | head -3
echo "=== Init ===" && grep "lead-state" skills/task-init/SKILL.md | head -3
echo "=== Docs ===" && ls docs/concepts/lead.md
```

Expected:
- lead.md template exists
- Hooks: SubagentStop, SessionStart, Stop (3 hook groups)
- Command references lead
- Init references lead-state
- Lead concept doc exists

**Step 2: Check no stale controller/messenger references remain**

Run:
```bash
cd R:/Claudovka/projects/team-pipeline
grep -r "controller-state" --include="*.md" --include="*.json" hooks/ commands/ skills/task-init/ | grep -v "archive\|design\|plan"
```

Expected: No output (no stale references in active files)

**Step 3: Commit any remaining changes**

If any fixups needed, commit them:
```bash
git add -A
git commit -m "chore: clean up stale controller/messenger references"
```
