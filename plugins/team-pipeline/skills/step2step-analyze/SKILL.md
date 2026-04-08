---
name: step2step-analyze
description: Run step analysis on pending steps in a step2step instance
argument-hint: [S2S-ID] [step-NNN]
---

# Step2Step Analyze

Run step analysis on pending steps in a step2step pipeline instance.

## Steps

### 1. Resolve Instance

Parse `$ARGUMENTS` for an S2S-ID (format `S2S-NNN`) and an optional step ID (format `step-NNN`).

If an S2S-ID is provided, verify `.agent/step2step/{S2S-ID}/manifest.md` exists. If not found, tell user: "Instance {S2S-ID} not found. Use `/step2step status` to list available instances."

If no S2S-ID is provided, scan `.agent/step2step/S2S-*/manifest.md` files. Find the most recent instance (by `updated` timestamp) with stage `steps_generated` or `step_analysis`. If none found, tell user: "No active instances found at steps_generated or step_analysis stage. Use `/step2step start` to create one."

### 2. Validate Stage

Read the manifest. The instance `stage` must be `steps_generated` or `step_analysis`.

- If `stage: theme_defined`: tell user "Step generation is not yet complete for {S2S-ID}. Wait for the step-generator to finish, then retry."
- If stage is past `step_analysis` (i.e., `cascade_check`, `proof_review`, or `completed`): tell user "Analysis is already complete for {S2S-ID}. The instance is at stage `{stage}`. No further analysis needed unless you run `/step2step prove` and it fails."

### 3. Set Stage

If the manifest `stage` is `steps_generated`, update it to `step_analysis` and set `updated` to the current timestamp.

Append to `.agent/step2step/{S2S-ID}/log.md`:
```
| {ISO timestamp} | stage updated | lead | steps_generated -> step_analysis |
```

### 4. Identify Target Steps

Read all files in `.agent/step2step/{S2S-ID}/steps/`.

If a specific step ID was provided in `$ARGUMENTS` (e.g., `step-003`):
- Verify the file exists at `.agent/step2step/{S2S-ID}/steps/step-003.md`
- Verify frontmatter `status: pending` (or `status: modified` for re-analysis)
- If not found or wrong status, tell user which steps are available and their statuses

If no specific step was provided, collect all step files with `status: pending`.

If no pending steps are found, proceed to step 7 (all-analyzed check).

### 5. Single-Step Mode

If one specific step was provided, spawn the `step-analyzer` agent (model: sonnet, maxTurns: 20) with this prompt:

"Analyze the step at `.agent/step2step/{S2S-ID}/steps/{step-NNN}.md`. Read the step, its predecessors, and any referenced code. Write a structured Analysis section with strengths, weaknesses, alternatives, and a recommendation. Set status to `analyzed`."

Append to log:
```
| {ISO timestamp} | step-analyzer spawned | lead | Analyzing {step-NNN} |
```

Tell user: "Step analyzer spawned for {step-NNN} in {S2S-ID}. Use `/step2step status {S2S-ID}` to check when complete."

### 6. Batch Mode

If no specific step was provided, iterate through all pending steps in order. For each step:

Spawn the `step-analyzer` agent (model: sonnet, maxTurns: 20) with this prompt:

"Analyze the step at `.agent/step2step/{S2S-ID}/steps/{step-NNN}.md`. Read the step, its predecessors, and any referenced code. Write a structured Analysis section with strengths, weaknesses, alternatives, and a recommendation. Set status to `analyzed`."

Append to log after spawning all:
```
| {ISO timestamp} | batch analysis started | lead | {N} step-analyzer agents spawned |
```

Tell user: "{N} step analyzer agents spawned for {S2S-ID} — one per pending step. Analyzers run sequentially to preserve predecessor context. Use `/step2step status {S2S-ID}` to track progress."

Note: spawn step-analyzers sequentially (one at a time) rather than concurrently, so each analyzer can read predecessor analyses that were just completed.

### 7. Check All-Analyzed

If invoked when all steps already have `status: analyzed` (no pending steps found in step 4), read all step files and produce a summary:

```
## {S2S-ID} Analysis Summary

**Steps analyzed:** {N}
**Recommendations:**
- Keep: {N} steps
- Modify: {N} steps
- Replace: {N} steps

All steps have been analyzed. Review the recommendations for each step, then either:
- Accept or override each recommendation in the step files (set a `decision` field)
- Run `/step2step cascade {S2S-ID}` to trace impacts of any modified/replaced steps
- Run `/step2step prove {S2S-ID}` directly if no steps were modified or replaced
```

### 8. Error Handling

If a step-analyzer fails for a specific step:

1. Read the step file to determine its current status.
2. If status is still `pending`, report: "Analyzer failed for {step-NNN} in {S2S-ID} — step is still pending."
3. Suggest: "Retry with `/step2step analyze {S2S-ID} {step-NNN}`."
4. Continue with remaining steps in batch mode — do not abort the entire batch for one failure.
