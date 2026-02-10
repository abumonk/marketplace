---
description: Analyze an external project to extract adoptable patterns and generate a structured report
disable-model-invocation: true
argument-hint: <project_path> [--report | --quick]
---

# Learn From Project

Handle the user's learn request based on arguments: $ARGUMENTS

## Actions

### `/learn <project_path>` or `/learn <project_path> --report` or `/learn <project_path> --quick`
Invoke the `team-pipeline:learn` skill with the provided arguments.

### `/learn` with no arguments
Tell the user: "Usage: /learn <project_path> [--report | --quick]"
