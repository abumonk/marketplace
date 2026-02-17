---
description: Main entry point for the task pipeline - create, advance, and manage tasks
argument-hint: [create|status|advance|complete|cancel|migrate|lead] [task-id]
---

# Task Pipeline Command

Handle the user's task pipeline request based on arguments: $ARGUMENTS

## Actions

### `/task create` or `/task` with no arguments
Invoke the `team-pipeline:task-create` skill.

### `/task status`
Invoke the `team-pipeline:task-status` skill.

If `.agent/adventures/` exists and contains adventures, also invoke `team-pipeline:adventure-status` to show adventure-level grouping.

### `/task advance TASK-XXX`
Advance the specified task to its next stage:

1. Read the task file at `.agent/tasks/{task-id}.md`
2. Check the current `stage` and `status`:
   - `planning` + `status: ready` --> set `stage: implementing`, `status: in_progress`, `assignee: implementer`.
     **Git operations**: Read `.agent/config.md` for `git:` config. If present:
     - Detect repos: for each path in the task's `files` field, run `git -C {dir} rev-parse --show-toplevel` to find repo roots. Group files by repo.
     - If `git.mode` is `branch-per-task`: for each repo, run `git -C {repo_root} checkout -b {branch_name}` where branch_name is built from `git.branch_template` replacing `{id}` with task ID and `{slug}` with slugified title (lowercase, hyphens for spaces, strip special chars). Append to Log: `- [{timestamp}] git: Created branch {branch} in {repo}` per repo.
     - If `git.mode` is `current-branch`: for each repo, record the current branch via `git -C {repo_root} branch --show-current`.
     - Update task `repos` field with detected mapping: `[{root, branch, base, files}]` per repo. Append to Log: `- [{timestamp}] git: Detected {n} repo(s)`.
     Spawn `implementer` agent with prompt: "Implement task at `.agent/tasks/{task-id}.md`. Read the task and design, implement changes, run build and tests, set status to ready when complete."

   - `implementing` + `status: ready` --> set `stage: reviewing`, `status: in_progress`, `assignee: reviewer`.
     **Git operations**: Read `.agent/config.md` for `git:` config. If present, for each repo in the task's `repos` field:
     - Detect changed files: `git -C {repo_root} diff --name-only` and `git -C {repo_root} diff --cached --name-only`
     - Stage task-related files: `git -C {repo_root} add {files}` (specific files only, never `git add .`)
     - Build commit message based on `git.commit_style`: conventional: `feat({task-id}): {task title}`, simple: `{task-id}: {task title}`, template: substitute `{type}=feat`, `{id}`, `{slug}`, `{message}` in `git.commit_template`
     - Commit: `git -C {repo_root} commit -m "{message}"`
     - Update task `repos[].files` with actual committed files. Append to Log: `- [{timestamp}] git: Committed {n} files in {repo}: {message}`
     Spawn `reviewer` agent with prompt: "Review task at `.agent/tasks/{task-id}.md`. Read the task, design, and implementation. Run build and tests. Output review report. Set status to passed or failed."

   - `reviewing` + `status: failed` --> increment `iterations`. If `iterations >= max_iterations` (from config.md), set stage to BLOCKED and notify user. Otherwise set `stage: fixing`, `status: in_progress`, `assignee: implementer`. Save the reviewer's report to `.agent/reports/{task-id}-review.md`. Spawn `implementer` agent with prompt: "Fix task at `.agent/tasks/{task-id}.md`. Read review report at `.agent/reports/{task-id}-review.md`. Address all issues. Set status to ready when complete."

   - `fixing` + `status: ready` --> set `stage: reviewing`, `status: in_progress`, `assignee: reviewer`.
     **Git operations**: Same as implementing->reviewing commit, but with fix-style messages: conventional: `fix({task-id}): address review round {iterations}`, simple: `{task-id}: fix review round {iterations}`, template: substitute `{type}=fix`. Append to Log: `- [{timestamp}] git: Committed {n} files in {repo}: {message}`
     Spawn `reviewer` agent.

   - `reviewing` + `status: passed` -->
     **Git operations**: Read `.agent/config.md` for `git:` config. If present, for each repo in the task's `repos` field:
     - Push: `git -C {repo_root} push -u origin {branch_name}`. Append to Log: `- [{timestamp}] git: Pushed {branch} to origin in {repo}`
     - If `git.mode` is `branch-per-task`:
       - Read PR template from `roles/templates/pr-template.md` (or custom path from `git.pr_template`)
       - Build PR body: substitute `{task-id}`, `{task-title}`, `{task-description}` from task file, `{acceptance-criteria}` from task file, `{review-summary-or-link-to-report}` from `.agent/reports/{task-id}-review.md` if exists, `{file-list-per-repo}` from repos[].files, `{cross-links-to-prs-in-other-repos-if-multi-repo}` with links to PRs created in other repos
       - Create PR: `gh pr create --base {git.base_branch} --title "{task-id}: {title}" --body "{body}"`. Append to Log: `- [{timestamp}] git: Created PR #{number} in {repo}`
     Set `stage: completed`, `status: done`, `assignee: --`. Move task file to `.agent/tasks/archive/`. Spawn `researcher` agent with prompt: "Research completed task at `.agent/tasks/archive/{task-id}.md`. Analyze all artifacts and update knowledge base."

   - Any stage + `status: blocked_on_question` --> tell the user: "Task {id} is blocked waiting for answer to question. Run `/task lead` to present pending questions."
3. Update `updated` timestamp in frontmatter.
4. Append to `## Log`: `- [{timestamp}] lead: Advanced to {new stage}`
5. If the status doesn't allow advancement, tell the user why.

### `/task complete TASK-XXX`
Force-complete a task (skip remaining stages):
1. Set `stage: completed`, `status: done`
2. Move to archive
3. Spawn researcher

### `/task cancel TASK-XXX`
Cancel a task:
1. Set `stage: cancelled`, `status: cancelled`
2. Move to archive
3. Do not spawn researcher

### `/task migrate`
Invoke the `team-pipeline:task-migrate` skill. Imports existing TODOs, issues, and work items from user-specified sources into the pipeline.

### `/task lead`

Invoke the lead agent for on-demand pipeline analysis.

1. The lead agent reads all pipeline state:
   - `.agent/lead-state.md` (orchestration state)
   - `.agent/tasks/*.md` (all active tasks)
   - `.agent/config.md` (stage assignments, settings)
   - `.agent/messenger.md` (notification channels)
2. Presents comprehensive pipeline report:
   - Current task status across all stages
   - Pending decisions awaiting user input
   - Recommendations with reasoning
   - Queue and dependency analysis
   - Notification channel status
3. Proposes next actions as a numbered list
4. Awaits user decision

The lead agent follows its role definition at `roles/templates/lead.md` under the "On-Demand: /task lead" section.

### `/task adventure start {prompt}`
Invoke the `team-pipeline:start-adventure` skill with the prompt as arguments.

### `/task adventure status`
Invoke the `team-pipeline:adventure-status` skill.
