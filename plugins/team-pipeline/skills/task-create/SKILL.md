---
name: task-create
description: Create a new task in the pipeline. Generates a task file and spawns the planner agent.
---

# Create Task

## Steps

1. Check that `.agent/tasks/` exists. If not, tell the user to run `/task-init` first.

2. Scan `.agent/tasks/` for existing task files matching pattern `TASK-*.md`. Find the highest number and increment by 1. If no tasks exist, start at `TASK-001`.

3. Ask the user for:
   - **Title**: Short task title
   - **Description**: What needs to be done
   - **Acceptance Criteria**: List of checkable criteria
   - **Tags**: Optional comma-separated tags

4. Create the task file at `.agent/tasks/{TASK-ID}.md`:

   ```markdown
   ---
   id: {TASK-ID}
   title: {title}
   stage: planning
   status: in_progress
   created: {ISO timestamp}
   updated: {ISO timestamp}
   iterations: 0
   assignee: planner
   files: []
   repos: []
   depends_on: []
   tags: [{tags}]
   ---

   ## Description
   {description}

   ## Acceptance Criteria
   {criteria as checklist}

   ## Design
   <!-- Filled by planner agent -->

   ## Log
   - [{timestamp}] created: Task created
   ```

5. Spawn the `planner` agent in the background with this prompt:
   "Plan task at `.agent/tasks/{TASK-ID}.md`. Read the task, explore the codebase, write a design document, and update the task file. Set status to ready when complete."

6. Tell the user: "{TASK-ID} created and planner agent spawned. Use `/task-status` to track progress."
