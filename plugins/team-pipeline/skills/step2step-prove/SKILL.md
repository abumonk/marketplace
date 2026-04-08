---
name: step2step-prove
description: Run proof review to validate the step2step chain for coherence and completeness
argument-hint: [S2S-ID]
---

# Step2Step Prove

Run proof review to validate the step2step chain for logical coherence and completeness, producing a pass/fail verdict.

## Steps

### 1. Resolve Instance

Parse `$ARGUMENTS` for an S2S-ID (format `S2S-NNN`).

If an S2S-ID is provided, verify `.agent/step2step/{S2S-ID}/manifest.md` exists. If not found, tell user: "Instance {S2S-ID} not found. Use `/step2step status` to list available instances."

If no S2S-ID is provided, scan `.agent/step2step/S2S-*/manifest.md` files. Find the most recent instance (by `updated` timestamp) with stage `cascade_check`. If none found, tell user: "No active instances found at cascade_check stage. Run `/step2step cascade` first (or it may auto-skip if no cascades are needed)."

### 2. Validate Stage

Read the manifest. The instance `stage` must be `cascade_check`.

- If `stage: step_analysis`: tell user "Cascade analysis has not run yet for {S2S-ID}. Run `/step2step cascade {S2S-ID}` first. (It may auto-skip if no steps were modified.)"
- If `stage: steps_generated`: tell user "Analysis has not yet run for {S2S-ID}. Run `/step2step analyze {S2S-ID}` first."
- If `stage: proof_review`: tell user "Proof review has already been completed for {S2S-ID}. Use `/step2step status {S2S-ID}` to see the result."
- If `stage: completed`: tell user "This instance is already completed."

### 3. Check Prerequisites

Before spawning the proof reviewer, check that all prerequisites are met:

1. Read all step files in `.agent/step2step/{S2S-ID}/steps/`. Check that every step has `status: decided` or `status: cascaded`. Collect any steps that are still `pending`, `analyzed`, `modified`, `replaced`, or `cascade_pending`.

2. Read all cascade records in `.agent/step2step/{S2S-ID}/cascades/`. Check that every cascade record has `status: resolved`. Collect any cascades that are still `pending` or `open`.

If unresolved items exist, present them and stop:

```
## {S2S-ID} Prerequisites Not Met

The following items must be resolved before running proof review:

**Steps not yet decided:**
- {step-NNN}: status is {status} — make a decision (keep/modify/replace) before proving

**Unresolved cascade records:**
- {cascade-NNN}: triggered by {source_step} — apply the proposed fix and mark resolved

Resolve these items and retry `/step2step prove {S2S-ID}`.
```

### 4. Spawn Proof Reviewer

All prerequisites are met. Spawn the `proof-reviewer` agent (model: opus, maxTurns: 30) with this prompt:

"Run proof review on the step2step instance at `.agent/step2step/{S2S-ID}`. Read all step files and cascade records. Validate each step for soundness, user decision consistency, and cascade resolution. Validate the full chain for logical flow, completeness, consistency, and implementability. Write `proof/proof-review.md` with a pass/fail verdict. If PASSED, include an adventure concept. Update the manifest stage accordingly."

Append to `.agent/step2step/{S2S-ID}/log.md`:
```
| {ISO timestamp} | proof-reviewer spawned | lead | All prerequisites met, proof review started |
```

Tell user: "Proof reviewer spawned for {S2S-ID}. It will validate the full step chain for coherence and completeness. Use `/step2step status {S2S-ID}` to track progress."

### 5. Handle PASSED

When proof-reviewer completes and `proof/proof-review.md` shows `status: passed`:

Read the `## Adventure Concept` section from `proof/proof-review.md`.

Append to log:
```
| {ISO timestamp} | proof passed | lead | Stage -> proof_review, adventure concept available |
```

Present to user:

```
## {S2S-ID} Proof: PASSED

The step chain is valid and coherent.

**Adventure Concept:**
{Title and description from proof-review.md}

**Scope:**
{Scope bullets from proof-review.md}

**Estimated task count:** {N} tasks

Create an adventure from this concept?
```

Wait for user response. If user approves, proceed to step 7 (Adventure Creation).

### 6. Handle FAILED

When proof-reviewer completes and `proof/proof-review.md` shows `status: failed`:

Read the `## Verdict` section and the rework list from the proof review document.

Append to log:
```
| {ISO timestamp} | proof failed | lead | {N} issues found, stage -> step_analysis |
```

Present to user:

```
## {S2S-ID} Proof: FAILED

The step chain has issues that must be resolved before an adventure can be created.

**Steps requiring rework:**
{List from proof-review.md Verdict section}

**Next steps:**
For each step needing rework:
- Run `/step2step analyze {S2S-ID} {step-NNN}` to re-analyze that step
- Review the updated analysis and make a new decision
- Then run `/step2step cascade {S2S-ID}` and `/step2step prove {S2S-ID}` again
```

### 7. Adventure Creation

If user approves adventure creation after a PASSED proof:

Use the adventure concept title and description from `proof/proof-review.md` to invoke `/start-adventure` with the concept text as the argument.

Append to log:
```
| {ISO timestamp} | adventure creation initiated | lead | Concept from proof-review.md passed to start-adventure |
```

### 8. Error Handling

If proof-reviewer fails:

1. Read `.agent/step2step/{S2S-ID}/proof/proof-review.md` if it exists to check partial output.
2. **If no proof-review.md was written** (complete failure):
   - Append to log: `| {ISO timestamp} | proof-reviewer failed | lead | No proof-review.md written |`
   - Tell user: "Proof reviewer failed for {S2S-ID} — no proof review was written. Retry with `/step2step prove {S2S-ID}`."
3. **If partial proof-review.md was written** (timeout or partial failure):
   - Append to log: `| {ISO timestamp} | proof-reviewer partial | lead | Partial proof-review.md exists |`
   - Present what exists and tell user: "Proof reviewer partially completed. The partial review is at `.agent/step2step/{S2S-ID}/proof/proof-review.md`. Review it manually or retry."
4. **Never retry automatically** — always present recovery options and wait for user decision.
