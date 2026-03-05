# Path-Scoped Rules

> File-targeted instructions that inject additional context when agents work on matching paths.

## Problem

The pipeline's knowledge base (`.agent/knowledge/`) provides global context to all agents for all tasks. But some instructions are only relevant when working on specific files or directories. Examples:

- API route handlers must follow a specific error format
- Test files in a certain package require a particular mock setup
- Database migration files must use reversible operations only
- React components in a specific directory must use a particular state management pattern

Currently, these instructions live in shared knowledge files where they add noise for unrelated tasks, or they are repeated in design documents for every relevant task.

## Concept

**Path-scoped rules** are markdown files in `.agent/rules/` with optional `paths` frontmatter containing glob patterns. When a task's `files` list includes paths matching a rule's globs, the rule's content is injected into the agent's context alongside the standard role instructions.

### Rule File Format

```yaml
# .agent/rules/api-error-handling.md
---
paths:
  - "packages/web-api/src/routes/**/*.ts"
  - "packages/web-api/src/middleware/**/*.ts"
---

# API Error Handling

- All route handlers must catch errors and return JSON with `{ error: string, code: number }`
- Use the `ApiError` class from `packages/web-api/src/errors.ts` for typed errors
- Never expose stack traces in production responses
- Log errors to the request-scoped logger before returning
```

### Loading Rules

A rule matches a task when ANY path in the task's `files` list matches ANY glob in the rule's `paths` frontmatter. Rules without a `paths` field (or with empty `paths`) apply to ALL tasks (global rules).

Glob matching uses standard patterns:
- `*` matches any characters within a path segment
- `**` matches any number of path segments
- `?` matches a single character
- `{a,b}` matches either `a` or `b`

### Default Rules

No rules are created by default. The `rules` directory is created empty during init. Users add rules as needed.

## Relationship to Current System

- `.agent/knowledge/` -- Global context, always loaded, maintained by researcher. Captures patterns, issues, and decisions discovered across tasks.
- `.agent/rules/` -- Path-scoped context, loaded when files match, maintained by users/planner. Contains prescriptive instructions for specific areas of the codebase.
- `.agent/hooks.md` -- Event-driven behavior (PreToolUse, StageTransition, etc.). Hooks trigger on pipeline events. Rules trigger on file paths.

Rules complement both: knowledge provides descriptive context ("we observed X"), rules provide prescriptive instructions ("when touching X, always do Y"), and hooks provide enforcement ("block X if Y is not met").

## Key Abstractions

### Rule File
A markdown file in `.agent/rules/` with optional YAML frontmatter. The frontmatter `paths` field contains glob patterns. The markdown body contains the instructions to inject.

### Glob Matching
Standard glob patterns match against the task's `files` list. A rule activates if any task file matches any of the rule's glob patterns.

### Rule Injection
The lead agent reads all rules, filters by glob match, and appends the matching rule content to the agent's spawn prompt. The planner reads rules to inform design decisions and documents applicable rules in the design.

## Interaction Patterns

### Planner
When designing a task, the planner:
1. Identifies target files
2. Reads all `.agent/rules/*.md` files
3. Filters rules whose `paths` match any target file
4. Includes matching rule summaries in the design document under a `## Applicable Rules` section
5. Notes any rule constraints that affect the implementation approach

### Lead Agent
When spawning an agent for a task, the lead:
1. Reads the task's `files` field
2. Reads all `.agent/rules/*.md` files
3. Filters rules whose `paths` match any task file
4. Appends a `# Path-Scoped Rules` section to the agent's spawn prompt containing the full text of each matching rule
5. If no rules match, the section is omitted

### Researcher
After task completion, the researcher may propose new rules based on recurring patterns discovered during the task. Rules are proposed (not auto-created) since they are prescriptive.

## Open Questions

- Should rules support a `priority` field for ordering when multiple rules match?
- Should rules support an `exclude` glob to opt out specific paths within a broader match?
- Should there be a max number of rules injected per task to prevent context bloat?

## Future Possibilities

- Rule templates for common patterns (API routes, test files, migrations)
- Rule inheritance (base rules that other rules extend)
- Rule validation (lint rules files for valid glob syntax)
- MCP tool for querying which rules apply to a given file path
