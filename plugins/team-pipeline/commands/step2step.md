---
description: Manage step2step pipeline instances — create, analyze, cascade, prove, and inspect
argument-hint: [start|analyze|cascade|prove|status] [S2S-ID|theme]
---

# Step2Step Command

Handle the user's step2step request based on arguments: $ARGUMENTS

## Actions

### `/step2step start <theme>`
Invoke the `team-pipeline:step2step-start` skill with the theme as arguments.

Creates a new step2step instance, prompts the user to confirm the theme, then spawns the step-generator agent to decompose the theme into ordered decision steps.

### `/step2step analyze [S2S-ID]`
Invoke the `team-pipeline:step2step-analyze` skill with the S2S-ID (or none to analyze the most recent instance).

Runs step-by-step analysis on the instance. If no S2S-ID is provided, the skill resolves the most recent instance automatically.

### `/step2step cascade [S2S-ID]`
Invoke the `team-pipeline:step2step-cascade` skill with the S2S-ID (or none for the most recent instance).

Runs cascade impact analysis — detects which steps affect others and spawns the cascade-tracker agent if cascades are found.

### `/step2step prove [S2S-ID]`
Invoke the `team-pipeline:step2step-prove` skill with the S2S-ID (or none for the most recent instance).

Runs the proof review — verifies all steps are analyzed, spawns the proof-reviewer agent, and handles PASSED (adventure creation) or FAILED (rework) outcomes.

### `/step2step status [S2S-ID]`
Invoke the `team-pipeline:step2step-status` skill with the S2S-ID (or none to list all instances).

Shows instance status. With no S2S-ID, lists all step2step instances in `.agent/step2step/`. With an S2S-ID, shows full detail: steps, cascades, proof status, and recent log entries.

### `/step2step` with no arguments
Tell the user:

```
Usage: /step2step <subcommand> [S2S-ID]

Subcommands:
  start <theme>      Create a new step2step instance and generate steps
  analyze [S2S-ID]   Run step analysis on an instance
  cascade [S2S-ID]   Run cascade impact analysis
  prove [S2S-ID]     Run proof review (prerequisite: all steps analyzed)
  status [S2S-ID]    Show instance status (omit S2S-ID to list all)

Examples:
  /step2step start "How should we handle auth token refresh?"
  /step2step analyze S2S-001
  /step2step cascade S2S-001
  /step2step prove S2S-001
  /step2step status
  /step2step status S2S-001
```
