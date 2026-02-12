# Working Folders

> Named, scoped directory boundaries that constrain agent file operations to declared project areas.

## Problem

Pipeline agents currently operate with full filesystem access. In larger codebases -- especially monorepos with multiple packages -- agents waste tokens scanning irrelevant directories, risk modifying files outside their scope, and produce noisy diffs that span unrelated areas. There is no way to tell agents "this task only touches the API package" or "stay out of the billing module."

## Concept

**Working folders** declares which directories agents can operate in. The user specifies folders during `/task-init`, organized as named package groups with named folder entries. Agents are hard-bounded to these paths -- any file operation outside the declared folders is blocked and logged. The `.agent/` directory is implicitly allowed for all agents since they need it for pipeline state.

### Core Decisions

- Declared at init time, stored in `.agent/config.md`
- Organized as named package groups containing named folder entries
- Hard boundary enforcement -- blocked operations logged to task log
- `.agent/` implicitly accessible (pipeline infrastructure, not project code)
- Root config files require explicit inclusion
- Empty `working_folders` means unrestricted access (backward compatible)

## Configuration Format

Working folders are stored in `.agent/config.md` under a `working_folders` key. Each entry is a named package group containing named folder entries -- the name describes the folder's purpose, the value is the path.

```yaml
---
working_folders:
  app:
    source: src/
    tests: tests/
    assets: public/
  shared:
    source: packages/shared/src/
    tests: packages/shared/tests/
  config:
    ci: .github/
    build-scripts: scripts/
    bundler: webpack.config.js
---
```

For simple single-package projects:

```yaml
---
working_folders:
  my-app:
    source: src/
    tests: tests/
    docs: docs/
    config: config/
---
```

### Rules

- Names are lowercase, hyphenated identifiers (e.g., `source`, `tests`, `build-scripts`)
- Values are paths relative to project root; trailing slash for directories, no slash for files
- A path includes all its subdirectories recursively
- Empty `working_folders` means unrestricted access (backward compatible)
- `.agent/` is always accessible regardless of configuration

### Why Named Folders

Named folders serve two purposes:

- **Human readability** -- `source: src/` is clearer than a bare `src/` in a list
- **Agent context** -- agents know the *purpose* of each path, not just its location. An implementer knows `source` is where code lives and `tests` is where tests go, even if the actual paths are unconventional (e.g., `source: lib/core/modules/`)

## Init-Time Detection

During `/task-init`, the working folders setup runs after git and build command configuration.

### Flow

1. **Scan project root** -- List top-level directories and files. Detect common patterns:
   - `src/`, `lib/`, `app/` -> propose as `source`
   - `tests/`, `test/`, `__tests__/`, `spec/` -> propose as `tests`
   - `docs/`, `doc/` -> propose as `docs`
   - `scripts/`, `bin/` -> propose as `scripts`
   - `config/`, `.config/` -> propose as `config`
   - `public/`, `static/`, `assets/` -> propose as `assets`

2. **Detect monorepo structure** -- If `packages/`, `apps/`, or `workspaces` key in `package.json` exists, switch to multi-package mode. Each sub-package becomes a group. Scan each sub-package for the same folder patterns.

3. **Present proposed configuration** -- Show the user the detected structure with named folders and ask for confirmation. The user can add, remove, rename, or regroup entries.

4. **Write to config** -- Save to `.agent/config.md` under the `working_folders` key.

### Example Interactions

Single-package project:

```
Detected project structure:

  my-app:
    source: src/
    tests: tests/
    docs: docs/
    entry: index.ts

Add, remove, or rename folders? (or confirm)
```

Monorepo:

```
Detected packages:

  api:
    source: packages/api/src/
    tests: packages/api/tests/
  web:
    source: packages/web/src/
    tests: packages/web/tests/
    assets: packages/web/public/
  shared:
    source: packages/shared/src/

Add, remove, or rename folders? (or confirm)
```

## Enforcement Mechanism

When an agent spawns, the lead agent resolves the task's effective working folders and injects them into the agent's context.

### PreToolUse Hook

Intercepts file operations before execution:

1. Extract the target path from the tool parameters
2. Resolve it to an absolute path
3. Check if the path falls within any declared working folder or `.agent/`
4. If inside: allow
5. If outside: block the operation, write a warning to the task log:
   ```
   - [2026-02-11 14:30] BOUNDARY: implementer blocked from reading
     "packages/billing/src/invoice.ts" -- not in working folders for task TASK-003.
     Allowed folders: api (source, tests), shared (source)
   ```

### Checked Operations

| Tool | Parameter Checked |
|------|------------------|
| `Read` | file_path |
| `Write` | file_path |
| `Edit` | file_path |
| `Glob` | path (search root) |
| `Grep` | path (search root) |

### Bash Gap

`Bash` is not checked -- parsing arbitrary shell commands for file paths is unreliable. The reviewer agent mitigates this by running `git diff` during review and flagging any modified files outside the task's working folders as a review failure.

## Task-Level Scoping

When a task is created, the planner agent assigns it to one or more package groups from the project's working folders. This narrows the agent's boundary from "all declared folders" to "only the packages this task touches."

### Task Frontmatter

Tasks gain a `packages` field:

```yaml
---
id: TASK-003
title: Add rate limiting to API
stage: planning
status: in_progress
packages: [api, shared]
files: [packages/api/src/middleware/rate-limit.ts]
---
```

### Resolution Rules

- `packages: [api, shared]` -- agent can access all named folders within the `api` and `shared` groups
- `packages: []` or field omitted -- agent can access all declared working folders (full project scope)
- The planner sets `packages` based on its analysis of which areas the task touches
- The user can override by editing the task file

### Stage Behavior

| Stage | Scope | Rationale |
|-------|-------|-----------|
| planning | Full project | Planner needs to analyze all areas to determine which packages the task touches |
| implementing | Task packages only | Implementer stays within assigned boundaries |
| reviewing | Task packages only | Reviewer validates within scope, plus `git diff` boundary check |
| fixing | Task packages only | Same scope as implementer |
| researching | Full project | Researcher needs cross-package access for pattern extraction |

## Schema Integration

### config.md Addition

```yaml
working_folders:
  type: object
  default: {}
  description: >
    Named package groups containing named folder paths.
    Empty object means unrestricted access (backward compatible).
  interactive:
    - field: working_folders
      question: "Configure working folders for this project?"
      type: confirm
      trigger: auto-detect
```

### Task File Addition

```yaml
packages:
  type: array
  default: []
  description: >
    Package groups from working_folders this task operates within.
    Empty array means full project scope.
```

### Hook Addition

```json
{
  "event": "PreToolUse",
  "hooks": [{
    "type": "prompt",
    "description": "Enforce working folder boundaries for file operations",
    "prompt": "Check if the tool's target path falls within the task's allowed working folders or .agent/. If outside, block and log."
  }]
}
```

## Relationship to Current System

Working folders is a new constraint layer. It does not change existing pipeline mechanics -- stages, agents, git operations, and knowledge extraction all work as before. The only difference is that file operations are scoped.

## Interaction Patterns

- **task-init** -- Runs auto-detection and interactive setup during first-time initialization.
- **reinit** -- Adds `working_folders` to config if missing during schema upgrade. Does not overwrite existing values.
- **planner** -- Reads working folders from config, sets `packages` on the task, operates with full project scope.
- **implementer / fixer** -- Receives resolved folder list from task packages. Blocked outside boundaries.
- **reviewer** -- Operates within task scope. Runs `git diff` boundary check as safety net.
- **researcher** -- Full project scope for cross-package pattern extraction.
- **roles** -- Role instances can declare preferred packages (future: `default_packages` field in role frontmatter).
- **learn** -- External project analysis is unaffected (operates on a separate path).

## Summary

| Component | Change |
|-----------|--------|
| `.agent/config.md` | New `working_folders` key with named package groups |
| Task frontmatter | New `packages` field for per-task scoping |
| `/task-init` | Auto-detect folders, interactive confirmation |
| `PreToolUse` hook | Boundary enforcement for Read/Write/Edit/Glob/Grep |
| Reviewer agent | `git diff` boundary check as safety net for Bash |
| Researcher agent | Exempt from per-task scoping (full project access) |
| Backward compat | Empty `working_folders` = unrestricted (existing projects unaffected) |
