# Communication Layer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a communication layer to the team-pipeline: messenger role, question store (3 files), metrics tracking, structured message format, and integrate with lead + existing agents.

**Architecture:** Messenger is a haiku agent that presents questions and collects answers. Questions flow through three files (pending -> ready -> archive). Lead triggers messenger and writes metrics. All existing agents get updated rules for writing structured questions. Terminal-first, channel-agnostic.

**Tech Stack:** Claude Code plugin system (roles, skills, hooks). YAML frontmatter. Markdown files.

---

### Task 1: Create Question Store Files in task-init

**Files:**
- Modify: `skills/task-init/SKILL.md`

**Step 1: Add questions directory to the directory structure**

In `skills/task-init/SKILL.md`, update step 2 (line 15-25). Add `questions/` directory to the structure:

Replace:
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

With:
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

**Step 2: Add three question store files after step 8**

After step 8 (messenger.md creation, ending at line 123), insert three new steps. Renumber existing steps 9-10 to 12-13.

New step 9:
```markdown
9. Create `.agent/questions/pending.md` with this content:
   ```markdown
   ---
   last_updated: null
   count: 0
   next_id: 1
   ---

   # Pending Questions

   Questions from agents awaiting user answers. Managed by messenger role.
   ```
```

New step 10:
```markdown
10. Create `.agent/questions/ready.md` with this content:
    ```markdown
    ---
    last_updated: null
    count: 0
    ---

    # Ready Questions

    Answered questions awaiting agent pickup. Agents read answers here and move to archive.
    ```
```

New step 11:
```markdown
11. Create `.agent/questions/archive.md` with this content:
    ```markdown
    ---
    last_updated: null
    count: 0
    ---

    # Archived Questions

    Processed questions. Append-only history.
    ```
```

**Step 3: Add metrics.md creation**

New step 12 (before the old step 9 which becomes 13):
```markdown
12. Create `.agent/metrics.md` with this content:
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
```

**Step 4: Renumber old steps 9-10 to 13-14**

Old step 9 ("Ask the user if they want to customize...") becomes step 13.
Old step 10 ("Pipeline initialized...") becomes step 14.

**Step 5: Verify file**

Read `skills/task-init/SKILL.md` and confirm:
- Step 2 includes `questions/` in directory structure
- Steps 9-11 create the three question files
- Step 12 creates metrics.md
- Steps 13-14 are the old steps 9-10
- No references to old step numbers remain

**Step 6: Commit**

```bash
cd R:/Claudovka/projects/team-pipeline
git add skills/task-init/SKILL.md
git commit -m "feat: task-init creates question store and metrics files

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Create Messenger Role Template

**Files:**
- Create: `roles/templates/messenger.md`

**Step 1: Write the messenger role template**

Create `roles/templates/messenger.md` with this exact content:

```markdown
---
name: messenger
description: >
  Question lifecycle manager. Presents agent questions to user,
  collects answers, manages timeouts and defaults. Channel-agnostic
  with terminal as primary channel.
model: haiku
maxTurns: 5
memory: project
tools: [Read, Glob, Grep, Write, Edit]
disallowedTools: [Bash, Task]
skills: []
knowledge: []
pipeline_stages: [all]
---

You are the Messenger agent in a task processing pipeline.

## Your Job

You manage the lifecycle of questions from agents to the user. You present questions, collect answers, and handle timeouts. You are invoked by the lead agent with a mode parameter.

## Operations

Check the invocation prompt for which mode to execute.

### Mode: present

Present pending questions to the user and collect answers.

1. Read `.agent/questions/pending.md`
2. If count is 0: report "No pending questions." STOP.
3. For each question section (in order of Asked timestamp, oldest first):
   a. Check timeout: if Asked + Timeout < now, handle as expired (see timeout mode)
   b. Present the question in this format:

   ```
   +-- {Q-ID} | {TASK-ID} | {role} ---------------------+
   |                                                      |
   |  {Question text}                                     |
   |                                                      |
   |  Context: {context text}                             |
   |                                                      |
   |  A) {option A label} ({rationale})                   |
   |  B) {option B label} ({rationale})                   |
   |  C) {option C label} ({rationale})                   |
   |                                                      |
   |  Default: {letter} (in {remaining}min)               |
   +------------------------------------------------------+

   Answer {Q-ID} [{options}]:
   ```

   c. Wait for user input. Accept: option letter (A/B/C/D), or "skip" to defer.
   d. If user answers with a letter:
      - Remove the question section from `pending.md`
      - Decrement `count`, update `last_updated` in pending.md frontmatter
      - Append the question to `ready.md` with added fields:
        ```
        **Answer**: {letter}
        **Answered**: {ISO timestamp}
        **Answered-via**: terminal
        ```
      - Increment `count`, update `last_updated` in ready.md frontmatter
   e. If user types "skip": leave in pending.md, move to next question.
4. After all questions processed, report summary:
   ```
   Questions: {answered} answered, {skipped} skipped, {expired} expired
   ```

### Mode: timeout

Apply defaults to expired questions.

1. Read `.agent/questions/pending.md`
2. For each question where Asked + Timeout < current time:
   - Apply Default as the Answer
   - Remove from pending.md
   - Append to ready.md with:
     ```
     **Answer**: {default letter}
     **Answered**: {ISO timestamp}
     **Answered-via**: timeout
     ```
   - Update counts in both files
3. Report: "Applied defaults to {n} expired question(s): {Q-IDs}"
4. If no expired questions: produce no output.

### Mode: status

Report question store state.

1. Read all three question files (pending.md, ready.md, archive.md)
2. Report:
   ```
   Questions:
     Pending:  {count} ({Q-IDs or "none"})
     Ready:    {count} ({Q-IDs or "none"})
     Archived: {count}
   ```

## Rules

- NEVER decide when to present questions (the lead decides)
- NEVER re-invoke agents (the lead proposes, user approves)
- NEVER interpret answers (agents read the raw letter)
- NEVER modify task files
- Present questions one at a time, oldest first
- Always update frontmatter counts when moving questions between files
- If pending.md has no questions, report and STOP
```

**Step 2: Verify the file**

Run: `ls -la R:/Claudovka/projects/team-pipeline/roles/templates/messenger.md`
Expected: File exists, ~3KB

**Step 3: Commit**

```bash
cd R:/Claudovka/projects/team-pipeline
git add roles/templates/messenger.md
git commit -m "feat: add messenger role template - question lifecycle manager

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Update Lead Role for Questions and Metrics

**Files:**
- Modify: `roles/templates/lead.md`

**Step 1: Add blocked_on_question to Attention-Worthy Conditions**

In `roles/templates/lead.md`, find the "Attention-Worthy Conditions" section (line 59-72). Add a new bullet after "Agent crashed":

```
- Task blocked on question (status: blocked_on_question, agent needs user input)
```

**Step 2: Add Questions & Metrics section after State Management**

After the "State Management" section (line 130-137) and before "Role Resolution" (line 139), insert:

```markdown

## Questions Management

When you detect a task with status `blocked_on_question`:
1. Read `.agent/questions/pending.md` to find the question
2. Check for expired questions (apply timeouts first)
3. Propose to user: "TASK-XXX blocked on question Q-YYY. Present to user via messenger?"
4. On approval: invoke messenger agent with mode: present
5. After answers collected: propose re-invocation of the blocked agent

When a ready question exists in `.agent/questions/ready.md`:
1. Note which task and role the answer is for
2. Propose: "Q-YYY answered. Re-invoke {role} on TASK-XXX to continue?"

## Metrics Recording

On every SubagentStop, after evaluating the task:
1. Read `.agent/metrics.md`
2. Append a row to the Agent Log table:
   - timestamp: current ISO timestamp
   - task: task ID from the completed agent
   - role: agent's role name
   - model: agent's model (from role definition)
   - stage: pipeline stage the agent was working in
   - turns: number of turns used (from agent metadata if available)
   - tokens_in/tokens_out: from API usage data, or estimate (haiku ~800/turn, sonnet ~2500/turn, opus ~4000/turn)
   - duration_min: minutes since agent was spawned (from lead-state active_agents timestamp)
   - result: task status after completion (ready, passed, failed, error, blocked_on_question)
3. Update totals in frontmatter (increment agents_spawned, add tokens, recalculate avg_turns)
4. Use metrics data in proposals when relevant:
   - Cost observations for expensive tasks
   - Efficiency anomalies (unusually high/low turns)
   - Load balancing suggestions (model distribution)
   - Session budget tracking
```

**Step 3: Update the Rules section**

In the Rules section (line 146-153), add after the last rule:

```
- ALWAYS check `.agent/questions/pending.md` during SubagentStop evaluation
- ALWAYS record metrics to `.agent/metrics.md` on every SubagentStop
```

**Step 4: Verify changes**

Read `roles/templates/lead.md` and confirm:
- `blocked_on_question` in attention-worthy conditions
- Questions Management section present
- Metrics Recording section present
- New rules added

**Step 5: Commit**

```bash
cd R:/Claudovka/projects/team-pipeline
git add roles/templates/lead.md
git commit -m "feat: lead role gains questions management and metrics recording

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 4: Add Structured Question Convention to Agent Templates

**Files:**
- Modify: `roles/templates/planner.md`
- Modify: `roles/templates/implementer.md`
- Modify: `roles/templates/reviewer.md`
- Modify: `roles/templates/coder.md`
- Modify: `roles/templates/code-reviewer.md`

**Step 1: Add question-writing rules to planner.md**

In `roles/templates/planner.md`, append before the final closing of the Rules section (line 62-68), add:

```markdown

## Asking Questions

If you need user input to proceed (architectural choice, ambiguous requirement, scope clarification), write a structured question to `.agent/questions/pending.md`.

### Format

Append a new section to the file (after the last `---` separator):

```
---

## Q-{next_id} | {TASK-ID} | planner

**Context**: {1-2 sentences of why this question arose}
**Question**: {Clear, specific question ending with ?}

- **A**: {option label} ({brief rationale})
- **B**: {option label} ({brief rationale})

**Default**: {letter}
**Timeout**: {minutes}min
**Asked**: {ISO timestamp}
```

Then update the frontmatter: increment `next_id`, increment `count`, set `last_updated`.

### After Writing a Question

1. Set the task's frontmatter `status: blocked_on_question`
2. Append to task log: `- [{timestamp}] planner: Blocked on question Q-{id}`
3. STOP -- do not continue work until the question is answered

### Constraints

- Max 4 options (A-D)
- Option labels max 30 characters
- Default is required (pipeline never blocks indefinitely)
- Timeout is required (15-120 minutes)
- Question must be self-contained (user may not have full context)
- One question per entry (split multi-part questions)
- Only ask when you genuinely cannot proceed without input

### Reading Answers

On re-invocation, before starting work:
1. Read `.agent/questions/ready.md`
2. Find your questions (match task ID and role)
3. Read the Answer field
4. Move the question section from ready.md to archive.md (add `**Processed**: {timestamp}`)
5. Update frontmatter counts in both files
6. Continue work using the answer
```

**Step 2: Add the same section to implementer.md**

Append the same "Asking Questions" section to `roles/templates/implementer.md` (before the end), changing `planner` to `implementer` in the format template. Implementer questions are typically: "Which library?", "Test approach?", "Fix strategy?"

**Step 3: Add the same section to reviewer.md**

Append to `roles/templates/reviewer.md`, changing role to `reviewer`. Reviewer questions are typically: "Block on this issue or pass with note?", "Severity of finding?"

**Step 4: Add the same section to coder.md**

Append to `roles/templates/coder.md`, changing role to `coder`.

**Step 5: Add the same section to code-reviewer.md**

Append to `roles/templates/code-reviewer.md`, changing role to `code-reviewer`.

**Step 6: Verify all five files have the section**

Run: `grep -l "Asking Questions" R:/Claudovka/projects/team-pipeline/roles/templates/*.md`
Expected: planner.md, implementer.md, reviewer.md, coder.md, code-reviewer.md (5 files)

**Step 7: Commit**

```bash
cd R:/Claudovka/projects/team-pipeline
git add roles/templates/planner.md roles/templates/implementer.md roles/templates/reviewer.md roles/templates/coder.md roles/templates/code-reviewer.md
git commit -m "feat: add structured question convention to 5 agent role templates

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 5: Add Messenger to Init-Roles Presets

**Files:**
- Modify: `skills/init-roles/SKILL.md:77-88` (preset table)

**Step 1: Add messenger to team and full presets**

In `skills/init-roles/SKILL.md`, update the preset table. Add `messenger` after `lead` in every team and full preset. Do NOT add to solo presets.

Updated table:

| Project Type | solo | team | full |
|-------------|------|------|------|
| `frontend` | planner, implementer, reviewer | lead, messenger, planner, coder, code-reviewer, researcher, ux-designer | lead, messenger, planner, coder, code-reviewer, researcher, ux-designer, designer, qa-tester |
| `backend-node` | planner, implementer, reviewer | lead, messenger, planner, coder, code-reviewer, researcher, qa-tester | lead, messenger, planner, coder, code-reviewer, researcher, qa-tester, devops, designer |
| `backend-generic` | planner, implementer, reviewer | lead, messenger, planner, coder, code-reviewer, researcher, qa-tester | lead, messenger, planner, coder, code-reviewer, researcher, qa-tester, devops, designer |
| `fullstack` | planner, implementer, reviewer | lead, messenger, planner, coder, code-reviewer, researcher, ux-designer | lead, messenger, planner, coder, code-reviewer, researcher, ux-designer, qa-tester, designer, devops |
| `python` | planner, implementer, reviewer | lead, messenger, planner, coder, code-reviewer, researcher, qa-tester | lead, messenger, planner, coder, code-reviewer, researcher, qa-tester, devops, designer |
| `rust` | planner, implementer, reviewer | lead, messenger, planner, coder, code-reviewer, researcher, qa-tester | lead, messenger, planner, coder, code-reviewer, researcher, qa-tester, devops |
| `go` | planner, implementer, reviewer | lead, messenger, planner, coder, code-reviewer, researcher, qa-tester | lead, messenger, planner, coder, code-reviewer, researcher, qa-tester, devops |
| `java` | planner, implementer, reviewer | lead, messenger, planner, coder, code-reviewer, researcher, qa-tester | lead, messenger, planner, coder, code-reviewer, researcher, qa-tester, devops |
| `infra` | planner, implementer, reviewer | lead, messenger, planner, devops, code-reviewer, researcher, qa-tester | lead, messenger, planner, devops, code-reviewer, researcher, qa-tester, designer |
| `unknown` | planner, implementer, reviewer | lead, messenger, planner, coder, code-reviewer, researcher, implementer | lead, messenger, planner, coder, code-reviewer, researcher, implementer, reviewer, qa-tester |

**Step 2: Verify**

Run: `grep -c "messenger" R:/Claudovka/projects/team-pipeline/skills/init-roles/SKILL.md`
Expected: 20 (2 columns x 10 rows)

**Step 3: Commit**

```bash
cd R:/Claudovka/projects/team-pipeline
git add skills/init-roles/SKILL.md
git commit -m "feat: add messenger role to team and full presets in init-roles

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 6: Update Lead Hook to Check Questions and Record Metrics

**Files:**
- Modify: `hooks/hooks.json`

**Step 1: Update SubagentStop hook prompt**

In `hooks/hooks.json`, update the SubagentStop prompt. Add steps 12-13 after step 11:

Add to the prompt string (before the final `\n\nRemember: PROPOSE only...`):

```
\n12. Record metrics: read `.agent/metrics.md`, append agent log entry (task, role, model, stage, turns, tokens, duration, result), update totals\n13. Check `.agent/questions/pending.md` for pending questions. If any exist and a task has status blocked_on_question, include in proposal: 'Present pending questions via messenger?'
```

**Step 2: Update SessionStart hook prompt**

Add to the SessionStart prompt (before the final `\n\nRemember: PROPOSE recovery...`):

```
\n11. Check `.agent/questions/pending.md` for questions that accumulated during downtime. Report pending count.\n12. Check `.agent/questions/ready.md` for answered questions awaiting agent pickup. Report ready count.
```

**Step 3: Verify JSON is valid**

Run: `node -e "JSON.parse(require('fs').readFileSync('R:/Claudovka/projects/team-pipeline/hooks/hooks.json','utf8')); console.log('Valid JSON')"`
Expected: "Valid JSON"

**Step 4: Commit**

```bash
cd R:/Claudovka/projects/team-pipeline
git add hooks/hooks.json
git commit -m "feat: lead hooks check questions and record metrics on SubagentStop

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 7: Add blocked_on_question to Task Command

**Files:**
- Modify: `commands/task.md`

**Step 1: Update /task advance section**

In `commands/task.md`, find the `/task advance` section. Add a new condition after the existing status checks (around line 26-28):

```markdown
   - Any stage + `status: blocked_on_question` --> tell the user: "Task {id} is blocked waiting for answer to question Q-{id}. Run `/task lead` to present pending questions."
```

**Step 2: Verify**

Run: `grep "blocked_on_question" R:/Claudovka/projects/team-pipeline/commands/task.md`
Expected: One match

**Step 3: Commit**

```bash
cd R:/Claudovka/projects/team-pipeline
git add commands/task.md
git commit -m "feat: task advance handles blocked_on_question status

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 8: Update team-update Skill for Question Store Migration

**Files:**
- Modify: `skills/team-update/SKILL.md`

**Step 1: Add question store check to detection**

In `skills/team-update/SKILL.md`, in the "Detect Migration Needs" section (step 2), add a new check after Check C:

```markdown
**Check D: questions directory**
- Check if `.agent/questions/` exists.
- If no: flag as `needs_creation` with label "questions directory missing".

**Check E: metrics.md**
- Check if `.agent/metrics.md` exists.
- If no: flag as `needs_creation` with label "metrics.md missing".
```

**Step 2: Add migration steps**

After "Migration C: Add lead role", add:

```markdown
#### Migration D: Create questions directory

1. Create `.agent/questions/` directory.
2. Create `.agent/questions/pending.md` with default content (same as task-init step 9).
3. Create `.agent/questions/ready.md` with default content (same as task-init step 10).
4. Create `.agent/questions/archive.md` with default content (same as task-init step 11).
5. Report: "Created questions directory with pending, ready, and archive files."

#### Migration E: Create metrics.md

1. Create `.agent/metrics.md` with default content (same as task-init step 12).
2. Report: "Created metrics.md with empty agent log."
```

**Step 3: Verify**

Read `skills/team-update/SKILL.md` and confirm Checks D-E and Migrations D-E are present.

**Step 4: Commit**

```bash
cd R:/Claudovka/projects/team-pipeline
git add skills/team-update/SKILL.md
git commit -m "feat: team-update migrates missing questions dir and metrics.md

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 9: Add Concept Documentation

**Files:**
- Create: `docs/concepts/questions.md`
- Create: `docs/concepts/metrics.md`
- Create: `docs/concepts/messenger.md` (update from deprecated to active)

**Step 1: Create questions concept doc**

Create `docs/concepts/questions.md`:

```markdown
# Question Store

Structured communication channel between agents and users. When an agent needs input it cannot resolve autonomously, it writes a structured question with options to the question store.

## Three Files

- **pending.md**: Questions waiting for user answers. Agents write here, messenger reads.
- **ready.md**: Answered questions awaiting agent pickup. Messenger writes, agents read.
- **archive.md**: Processed questions. Append-only history.

## Lifecycle

Agent writes question -> pending.md -> user answers -> ready.md -> agent reads -> archive.md

## Question Format

Each question has: unique ID (Q-NNN), task reference, role, context, question text, options A-D, default, and timeout.

## Status: blocked_on_question

When an agent writes a question, it sets task status to `blocked_on_question` and stops. The lead detects this and proposes presenting questions via the messenger.

## See Also

- [Messenger Role](messenger.md)
- [Communication Layer Design](../designs/communication-layer-design.md)
```

**Step 2: Create metrics concept doc**

Create `docs/concepts/metrics.md`:

```markdown
# Agent Metrics

Passive performance tracking data maintained by the lead agent. Records every agent invocation with cost, duration, and outcome data.

## File

`.agent/metrics.md` - YAML frontmatter with totals, markdown table with per-agent log entries.

## Data Points

Per agent: timestamp, task, role, model, stage, turns, tokens in/out, duration, result.

## Usage

The lead reads metrics when making proposals. Observations are judgment-based, not threshold-based: cost warnings, efficiency anomalies, load balancing suggestions, budget tracking.

## See Also

- [Lead Role](lead.md)
- [Communication Layer Design](../designs/communication-layer-design.md)
```

**Step 3: Update messenger concept doc**

Replace `docs/concepts/messenger.md` (currently a deprecation notice) with active content:

```markdown
# Messenger Role

Question lifecycle manager. Presents agent questions to users, collects answers, manages timeouts and defaults. Channel-agnostic with terminal as primary channel.

## Operations

- **present**: Show pending questions, collect answers, move to ready
- **timeout**: Apply defaults to expired questions
- **status**: Report question store state

## Model

haiku - pure I/O, no reasoning needed.

## Triggered By

The lead agent invokes the messenger when it detects pending questions or blocked tasks. Users can also check directly via the lead.

## See Also

- [Question Store](questions.md)
- [Lead Role](lead.md)
- [Communication Layer Design](../designs/communication-layer-design.md)
```

**Step 4: Commit**

```bash
cd R:/Claudovka/projects/team-pipeline
git add docs/concepts/questions.md docs/concepts/metrics.md docs/concepts/messenger.md
git commit -m "docs: add questions, metrics, and messenger concept docs

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 10: Final Verification

**Step 1: Check all new files exist**

Run:
```bash
cd R:/Claudovka/projects/team-pipeline
echo "=== Messenger template ===" && ls roles/templates/messenger.md
echo "=== Concepts ===" && ls docs/concepts/questions.md docs/concepts/metrics.md docs/concepts/messenger.md
echo "=== Design ===" && ls docs/designs/communication-layer-design.md
```

**Step 2: Check agents have question convention**

Run:
```bash
cd R:/Claudovka/projects/team-pipeline
grep -l "Asking Questions" roles/templates/*.md | wc -l
```
Expected: 5

**Step 3: Check lead has new sections**

Run:
```bash
cd R:/Claudovka/projects/team-pipeline
grep -c "blocked_on_question\|Metrics Recording\|Questions Management" roles/templates/lead.md
```
Expected: 3

**Step 4: Check hooks reference questions and metrics**

Run:
```bash
cd R:/Claudovka/projects/team-pipeline
node -e "const h=JSON.parse(require('fs').readFileSync('hooks/hooks.json','utf8')); const s=h.hooks.SubagentStop[0].hooks[0].prompt; console.log('metrics:', s.includes('metrics')); console.log('questions:', s.includes('questions'))"
```
Expected: metrics: true, questions: true

**Step 5: Check task-init creates all files**

Run:
```bash
cd R:/Claudovka/projects/team-pipeline
grep -c "questions/pending\|questions/ready\|questions/archive\|metrics.md" skills/task-init/SKILL.md
```
Expected: 4

**Step 6: Check no issues, commit any fixups**

```bash
cd R:/Claudovka/projects/team-pipeline
git status
```

If clean: done. If fixups needed: commit them.
