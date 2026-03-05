# Skills v2 — Enhanced Skill Format

## Problem

Skills currently use only `name`, `description`, `disable-model-invocation`, and `argument-hint` in frontmatter. There is no way to:
- Run a skill in an isolated subagent context (all skills run inline)
- Override the model for a specific skill invocation
- Restrict which tools a skill can use
- Compose multiple agents into a single skill workflow

This limits skills to single-agent, inline operations. Complex workflows like multi-perspective review (spawn 3 agents with different lenses) or bulk file operations (apply an operation to 50 files) cannot be expressed as skills.

## Concept

Extend SKILL.md frontmatter with four new optional fields:

```yaml
---
name: example-skill
description: Demonstrates enhanced skill format
context: fork          # "inline" (default) or "fork"
agent: reviewer        # Role name for forked context (only when context: fork)
model: sonnet          # Model override: opus, sonnet, haiku
allowed-tools:         # Tool allowlist (empty = all agent tools)
  - Read
  - Glob
  - Grep
disable-model-invocation: true
argument-hint: "<target>"
---
```

### Field Semantics

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `context` | `"inline" \| "fork"` | `"inline"` | `inline`: skill content injected into current conversation. `fork`: skill runs as a separate subagent via Task tool. |
| `agent` | string | current agent's role | Which role template to use when forking. The role's tools, knowledge, and system prompt are loaded. Only meaningful when `context: fork`. |
| `model` | `"opus" \| "sonnet" \| "haiku"` | role default | Override the model selection for this skill invocation. Works for both inline and forked contexts. |
| `allowed-tools` | string[] | all role tools | Restrict available tools to this allowlist. Applied as an intersection with the role's `tools` field. Empty array means no restriction. |

### Backward Compatibility

All new fields are optional with sensible defaults. Existing skills with only `name`, `description`, `disable-model-invocation`, and `argument-hint` continue to work unchanged — they default to `context: inline` with no tool restrictions.

## Relationship to Current System

- **Skill format** (`skills/*/SKILL.md`) — additive extension, not breaking
- **Roles system** (`roles/templates/`) — `agent` field references role names; the lead loads that role template for the forked subagent
- **Lead agent** — checks `context` field to decide inline vs fork execution; handles tool restriction intersection
- **init-skills** — scanning now reads and displays the new fields; composite skills appear in a new COMPOSITE category

## Key Abstractions

### Skill Context

Two execution modes:

- **inline**: Skill content is read and injected into the current conversation context. The executing agent follows the skill instructions directly. This is the existing behavior for all current skills.
- **fork**: Skill runs as a separate subagent via the Task tool. The lead spawns a new agent with the role template specified by `agent`, restricted to `allowed-tools`, using `model` if specified. The forked agent executes the skill body and returns results.

### Agent Binding

When `context: fork`, the `agent` field names a role template to use. The forked subagent gets:
- That role's system prompt
- That role's knowledge files
- The skill's `allowed-tools` list (intersected with the role's `tools` list)
- The skill's `model` override (if specified)

### Tool Restriction

`allowed-tools` narrows the tool set available to the executing agent. Applied as an intersection with the role's declared `tools` field. Useful for safety (read-only diagnostic skills) and focus (review skills that should not write code).

### Composite Skill

A skill whose body contains multi-step agent orchestration instructions. The skill body describes a workflow that may include spawning multiple subagents via Task tool, collecting results, and synthesizing output. Composite skills use:
- `context: fork` — to run in isolation
- `disable-model-invocation: true` — to require manual triggering
- Structured output between `---SKILL-NAME-START---` / `---SKILL-NAME-END---` markers

## Interaction Patterns

### init-skills reads new fields

During skill scanning (Step 4), init-skills now reads `context`, `agent`, `model`, and `allowed-tools` alongside `name`. Skills with `context: fork` are displayed in a COMPOSITE category in the recommendations output.

### Lead agent checks context before invoking a skill

When a skill is invoked:
1. Read the SKILL.md frontmatter
2. If `context: inline` (or omitted): inject skill content into current conversation (existing behavior)
3. If `context: fork`: spawn a subagent using the `agent` role template, with `allowed-tools` and `model` applied

## Open Questions

1. Should forked skills inherit the parent conversation's knowledge context, or start clean?
2. Should there be a `timeout` field for forked skill execution?
3. Should composite skills be allowed to chain other skills (skill-within-skill)?

## Future Possibilities

- Dynamic context injection (`!command` syntax) for live data preprocessing in skill content
- Skill dependency declarations (`requires: [other-skill]`)
- Skill result caching for expensive operations
- Skill versioning for breaking changes
