---
name: step2step-start
description: Create a new step2step pipeline instance and generate steps from a theme
argument-hint: <theme description>
---

# Step2Step Start

Create a new step2step pipeline instance from the user's theme prompt.

## Steps

### 1. Validate Environment

Check that `.agent/step2step/` exists. If not, create it.

Check that `.agent/tasks/` exists. If not, tell the user: "Run `/task-init` first to initialize the pipeline."

### 2. Generate Instance ID

Scan `.agent/step2step/` for directories matching `S2S-*`. Find the highest number and increment by 1. If none exist, start at `S2S-001`.

### 3. Create Instance Directory

Create the full directory tree:
```
.agent/step2step/{S2S-ID}/
.agent/step2step/{S2S-ID}/steps/
.agent/step2step/{S2S-ID}/cascades/
.agent/step2step/{S2S-ID}/proof/
```

### 4. Create Manifest

Write `.agent/step2step/{S2S-ID}/manifest.md`:

```markdown
---
id: {S2S-ID}
theme: {theme from $ARGUMENTS}
stage: theme_defined
created: {ISO timestamp}
updated: {ISO timestamp}
step_count: 0
cascade_count: 0
adventure_id: {adventure_id from current adventure context, or null if not in an adventure}
proof_status: null
---

## Theme

{theme text from $ARGUMENTS}

## Steps

<!-- Populated by step-generator agent -->

## Rework Required

<!-- Populated by proof-reviewer agent on failed review -->
```

### 5. Initialize Log

Write `.agent/step2step/{S2S-ID}/log.md`:

```markdown
# {S2S-ID} Log

| Timestamp | Event | Actor | Detail |
|-----------|-------|-------|--------|
| {ISO timestamp} | created | lead | Theme: {first 80 chars of theme} |
```

### 6. Checkpoint: Theme Approval

Present the theme to the user:

```
## Step2Step Instance: {S2S-ID}

**Theme:**
{theme text}

Does this theme look correct? I'll spawn the step generator to decompose it into ordered decision steps.
```

Wait for user approval. If the user edits the theme, update `manifest.md` with the revised theme and re-present.

### 7. Spawn Step Generator

On approval, update manifest `updated` timestamp.

Spawn the `step-generator` agent (model: opus, maxTurns: 30) with this prompt:

"Generate ordered step files for the step2step instance at `.agent/step2step/{S2S-ID}/manifest.md`. Read the manifest theme, explore the codebase for context, decompose into steps from macro to specific, write step files to `.agent/step2step/{S2S-ID}/steps/`, and update the manifest stage to `steps_generated`."

Append to log:
```
| {ISO timestamp} | step-generator spawned | lead | Theme approved, step generation started |
```

Tell the user: "Step generator spawned for {S2S-ID}. It will decompose your theme into ordered decision steps. Use `/step2step status {S2S-ID}` to track progress."

### 8. Failure Recovery

If the step-generator agent fails (crash, timeout, or error):

1. Read the manifest to check `stage`.
2. **If stage is still `theme_defined`** (generator never started or crashed immediately):
   - Append to log: `| {ISO timestamp} | step-generator failed | lead | No steps written, stage remains theme_defined |`
   - Tell user: "Step generator failed for {S2S-ID} — no steps were written. Retry with `/step2step start {S2S-ID}` or provide a different theme."
3. **If stage is `steps_generated`** (generator completed despite error signal):
   - Append to log: `| {ISO timestamp} | step-generator partial | lead | Stage shows steps_generated — review steps before proceeding |`
   - Tell user: "Step generator reported an error but the manifest shows `steps_generated`. Check `.agent/step2step/{S2S-ID}/steps/` and use `/step2step status {S2S-ID}` to assess."
4. **Never retry automatically** — always present recovery options and wait for user decision.
