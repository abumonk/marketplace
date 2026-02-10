---
name: task-init
description: Initialize the .agent/ directory structure in the current project for the team-pipeline task processing system
disable-model-invocation: true
---

# Initialize Task Pipeline

Create the `.agent/` directory structure in the current project.

This is a convenience wrapper around the `reinit` skill. It runs reinit in **create mode** (first-time initialization).

## Steps

1. Check if `.agent/` already exists. If it does, tell the user: "Pipeline already initialized. Run `/reinit` to upgrade to the current plugin version." STOP.

2. Run the `reinit` skill. It will:
   - Read the schema from `${CLAUDE_PLUGIN_ROOT}/schema/agent-schema.md`
   - Create all directories and files from the schema
   - Run interactive setup (git mode, build/test commands, branch detection)
   - Set the pipeline version

The reinit skill handles all file creation and interactive prompts. Do not duplicate its logic here.
