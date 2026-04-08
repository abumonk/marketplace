---
name: step2step-status
description: Display step2step pipeline status for all instances or a specific instance
argument-hint: [S2S-ID]
---

# Step2Step Status

Display the status of all step2step pipeline instances, or detailed status for a specific instance.

## Steps

### 1. Check Environment

Check that `.agent/step2step/` exists and contains at least one `S2S-*` directory.

If the directory does not exist or is empty, tell user: "No step2step instances found. Use `/step2step start <theme>` to create one."

### 2. List or Detail

Parse `$ARGUMENTS` for an S2S-ID (format `S2S-NNN`).

If an S2S-ID is provided, go to **step 4** (detail view).

Otherwise, proceed to **step 3** (list view).

### 3. List View

Scan `.agent/step2step/S2S-*/manifest.md` files. For each, read the frontmatter: `id`, `theme`, `stage`, `step_count`, `cascade_count`, `proof_status`, `updated`.

Display a table:

```
## Step2Step Instances

| ID | Theme | Stage | Steps | Cascades | Proof | Updated |
|----|-------|-------|-------|----------|-------|---------|
| S2S-001 | Refactor authentication layer | step_analysis | 8 | 0 | null | 2026-04-07 |
| S2S-002 | Add caching to data pipeline | theme_defined | 0 | 0 | null | 2026-04-07 |
```

Truncate the `Theme` column to 50 characters if longer (add `...`).

After the table, show the next action for the most recently updated active instance:

- `theme_defined` → "Step generation in progress or awaiting start. Use `/step2step start` to continue."
- `steps_generated` → "Steps ready. Run `/step2step analyze {S2S-ID}` to begin analysis."
- `step_analysis` → "Analysis in progress. Run `/step2step analyze {S2S-ID}` to continue or check step statuses."
- `cascade_check` → "Cascade check complete. Run `/step2step prove {S2S-ID}` to run proof review."
- `proof_review` → "Proof review complete. Use `/step2step status {S2S-ID}` to see the result."
- `completed` → "Instance completed."

### 4. Detail View

Read `.agent/step2step/{S2S-ID}/manifest.md`. If the file does not exist, go to **step 5** (error handling).

Display the instance details:

```
## {S2S-ID}: {theme (first 80 chars)}

**Stage:** {stage}
**Created:** {created}
**Updated:** {updated}
**Step count:** {step_count}
**Cascade count:** {cascade_count}
**Proof status:** {proof_status or "not started"}
```

**Step Summary Table** (if steps directory has files):

Read all step files in `.agent/step2step/{S2S-ID}/steps/`. Display:

```
### Steps

| Step | Title | Status | Recommendation | Decision |
|------|-------|--------|----------------|----------|
| step-001 | {title} | analyzed | modify | keep |
| step-002 | {title} | pending | - | - |
```

For `recommendation` and `decision`, show `-` if the field is absent.

**Cascade Summary** (if cascades directory has files):

Read all cascade records in `.agent/step2step/{S2S-ID}/cascades/`. Display:

```
### Cascades

| Cascade | Source Step | Affected Steps | Severity | Status |
|---------|-------------|----------------|----------|--------|
| cascade-001 | step-003 | step-005, step-006 | high | pending |
```

**Proof Status** (if `proof/proof-review.md` exists):

Read the frontmatter from `proof/proof-review.md`. Display:

```
### Proof Review

**Status:** {passed / failed}
**Reviewed:** {reviewed timestamp}
**Steps reviewed:** {steps_reviewed}
**Issues found:** {issues_found}
```

If `status: passed`, also show:
```
**Adventure concept available** — run `/step2step prove {S2S-ID}` to create the adventure.
```

**Recent Log** (last 10 entries from `log.md`):

```
### Recent Activity (last 10 entries)

| Timestamp | Event | Actor | Detail |
|-----------|-------|-------|--------|
| 2026-04-07T15:00:00Z | step-analyzer spawned | lead | Analyzing step-001 |
...
```

### 5. Error Handling

If an S2S-ID was provided but the manifest is not found:

List all available instances (scan `.agent/step2step/S2S-*/manifest.md`) and display:

```
Instance {S2S-ID} not found.

**Available instances:**
| ID | Theme | Stage |
|----|-------|-------|
| S2S-001 | ... | ... |
```

Tell user: "Use one of the IDs above with `/step2step status {S2S-ID}`."
