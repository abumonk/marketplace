---
name: step2step-cascade
description: Run cascade impact analysis on modified steps in a step2step instance
argument-hint: [S2S-ID]
---

# Step2Step Cascade

Run cascade impact analysis on modified or replaced steps in a step2step pipeline instance.

## Steps

### 1. Resolve Instance

Parse `$ARGUMENTS` for an S2S-ID (format `S2S-NNN`).

If an S2S-ID is provided, verify `.agent/step2step/{S2S-ID}/manifest.md` exists. If not found, tell user: "Instance {S2S-ID} not found. Use `/step2step status` to list available instances."

If no S2S-ID is provided, scan `.agent/step2step/S2S-*/manifest.md` files. Find the most recent instance (by `updated` timestamp) with stage `step_analysis` or `cascade_check`. If none found, tell user: "No active instances found at step_analysis or cascade_check stage."

### 2. Validate Stage

Read the manifest. The instance `stage` must be `step_analysis` or `cascade_check`.

- If `stage: steps_generated`: tell user "Analysis has not yet run for {S2S-ID}. Run `/step2step analyze {S2S-ID}` first."
- If `stage: theme_defined`: tell user "Steps have not been generated yet for {S2S-ID}. Run `/step2step start` first."
- If `stage: proof_review` or `stage: completed`: tell user "Cascade analysis is already complete for {S2S-ID} (stage: `{stage}`). No further cascade analysis needed."

### 3. Check for Modified Steps

Read all step files in `.agent/step2step/{S2S-ID}/steps/`. Collect steps with `status: modified` or `status: replaced`. These are the trigger steps.

### 4. No-Cascade Shortcut

If zero trigger steps are found (all steps have status `analyzed`, `decided`, or `cascaded` with no `modified` or `replaced`):

Update manifest `stage` to `cascade_check` and `updated` to current timestamp.

Append to `.agent/step2step/{S2S-ID}/log.md`:
```
| {ISO timestamp} | cascade skipped | lead | No modified/replaced steps — stage cascade_check |
```

Tell user: "No cascading changes detected for {S2S-ID} — all steps are consistent with their analyses. Stage advanced to `cascade_check`. Ready for proof review. Run `/step2step prove {S2S-ID}`."

Stop here (do not proceed to step 5).

### 5. Set Stage

If trigger steps were found, update manifest `stage` to `cascade_check` and `updated` to current timestamp.

Append to `.agent/step2step/{S2S-ID}/log.md`:
```
| {ISO timestamp} | cascade started | lead | {N} trigger steps: {step-NNN, ...} |
```

### 6. Spawn Cascade Tracker

Spawn the `cascade-tracker` agent (model: opus, maxTurns: 30) with this prompt:

"Run cascade impact analysis on the step2step instance at `.agent/step2step/{S2S-ID}`. Read all step files, build the dependency graph, trace downstream impacts from modified/replaced steps, write cascade records to `.agent/step2step/{S2S-ID}/cascades/`, and update affected step statuses to `cascade_pending`."

Append to log:
```
| {ISO timestamp} | cascade-tracker spawned | lead | {N} trigger steps to trace |
```

Tell user: "Cascade tracker spawned for {S2S-ID}. {N} modified steps will be traced for downstream impact. Use `/step2step status {S2S-ID}` to track progress."

### 7. Post-Cascade Summary

When cascade-tracker completes, read all cascade records in `.agent/step2step/{S2S-ID}/cascades/` and present a summary:

```
## {S2S-ID} Cascade Summary

**Cascades written:** {N}
**Steps affected:** {N}
**Severity breakdown:**
- High: {N} (require re-analysis or substantial rework)
- Medium: {N} (require targeted modifications)
- Low: {N} (minor consistency updates)

{If any high-severity cascades:}
**High-severity cascades require attention before proof review:**
- cascade-{NNN}: {source_step} -> {affected steps summary}
```

Tell user: "Review each cascade record in `.agent/step2step/{S2S-ID}/cascades/`. For each affected step, apply the proposed fixes and mark the cascade record `status: resolved`. Then run `/step2step prove {S2S-ID}`."

### 8. Error Handling

If cascade-tracker fails:

1. Read `.agent/step2step/{S2S-ID}/cascades/` to check how many cascade records were written.
2. **If no cascade records written** (complete failure):
   - Append to log: `| {ISO timestamp} | cascade-tracker failed | lead | No cascades written |`
   - Tell user: "Cascade tracker failed for {S2S-ID} — no cascade records were written. Retry with `/step2step cascade {S2S-ID}`."
3. **If partial cascades written** (timeout or partial failure):
   - Append to log: `| {ISO timestamp} | cascade-tracker partial | lead | {N} of expected cascades written |`
   - Tell user: "Cascade tracker partially completed for {S2S-ID}. {N} cascade records were written. Check which trigger steps were not yet traced and retry if needed."
4. **Never retry automatically** — always present recovery options and wait for user decision.
