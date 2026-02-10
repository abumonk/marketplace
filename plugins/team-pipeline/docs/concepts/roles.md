# Roles

> Templated agent definitions that bundle skills, knowledge, tools, and behavior for specific project functions.

## Problem

The pipeline has four hard-coded agents (`planner`, `implementer`, `reviewer`, `researcher`) defined as static markdown files in `agents/`. Every project gets the same agents regardless of context. Adding a new function (designer, qa-tester, devops) requires manually creating agent files with the correct tool permissions, model selection, system prompt, and knowledge references. There is no reuse, no composition, and no way to share role definitions across projects.

## Concept

A **role** is a template. An **agent** is an instance of a role.

Role templates are stored at the plugin level in `roles/templates/`. Each template is a markdown file with YAML frontmatter -- the same format as current `agents/*.md` files, extended with additional fields for skills, knowledge references, and inheritance.

When a project runs `init-roles`, selected templates are instantiated into `.agent/roles/` as project-level agents. The instance can override any template field (e.g., swap the model, add project-specific knowledge, restrict tools).

### Template Format

```yaml
---
name: coder
description: Implements features and fixes based on designs and task specifications.
inherits: []
model: sonnet
maxTurns: 50
memory: project
tools: [Read, Glob, Grep, Write, Edit, Bash]
disallowedTools: []
skills:
  - testing
  - linting
knowledge:
  - patterns
  - decisions
  - conventions
pipeline_stages: [implementing, fixing]
---

# System prompt body follows...
```

### Template Storage

```
roles/
  templates/
    planner.md          # built-in (current agents become templates)
    implementer.md
    reviewer.md
    researcher.md
    coder.md            # new
    code-reviewer.md
    designer.md
    ux-designer.md
    qa-tester.md
    devops.md
```

### Instance Storage (per project)

```
.agent/
  roles/
    coder.md            # instantiated from template, may have overrides
    reviewer.md
    ...
```

## Relationship to Current System

The four existing agents (`agents/*.md`) become the first four role templates. The `agents/` directory continues to exist for backward compatibility but `roles/templates/` becomes the canonical source. The `/task advance` command resolves which agent to spawn by looking at `.agent/roles/` first, falling back to `agents/`.

The pipeline stages (`planning`, `implementing`, `reviewing`, `fixing`, `researching`) remain unchanged. Roles declare which stages they participate in via `pipeline_stages`. Multiple roles can serve the same stage -- the controller (see `controller.md`) decides which to use.

## Key Abstractions

**Role Template** -- A plugin-level file defining a complete agent profile: model, tools, skills, knowledge, system prompt, and pipeline stage bindings. Immutable defaults.

**Role Instance** -- A project-level file created from a template. Inherits all template fields but can override any of them. Lives in `.agent/roles/`.

**Role Registry** -- An index (generated or static) of all available templates. Used by `init-roles` to present options. Could later support community templates.

**Inheritance** -- A role can declare `inherits: [base-role]` to pull in another role's configuration as defaults, then override specific fields. Single inheritance only to keep it simple.

**Skills Binding** -- The `skills` field lists skill names the role needs. During instantiation, `init-roles` verifies these skills are available and warns if any are missing. See `init-skills.md` for skill installation.

**Knowledge Binding** -- The `knowledge` field references knowledge base sections (`.agent/knowledge/*.md`) the role should read before acting. Injected into the agent's prompt context.

## Interaction Patterns

- **init-roles** reads templates from `roles/templates/`, presents them to the user, and writes instances to `.agent/roles/`.
- **controller** reads `.agent/roles/` to know which agents are available and which stages they serve.
- **init-skills** ensures the skills referenced by roles are installed.
- **learn** can suggest roles based on patterns observed in external projects.
- **messenger** is role-agnostic -- it operates at the pipeline event level, not the agent level.

## Open Questions

1. **Composition vs inheritance** -- Should roles support multiple inheritance or mixins? Starting with single inheritance keeps complexity low.
2. **Role versioning** -- When a template updates, how do existing instances get notified? Diff-based update suggestions during `init-roles --update`?
3. **Custom roles** -- Can users create roles from scratch without a template? Yes -- any valid agent markdown file in `.agent/roles/` should work.
4. **Community sharing** -- What format for distributing role templates? Git repos? Plugin marketplace? Deferred to later.
5. **Stage conflicts** -- If two roles serve `implementing`, who gets priority? Likely a config setting in `.agent/config.md`.
6. **Dynamic role selection** -- Should the controller pick roles based on task tags (e.g., `tags: [frontend]` routes to `designer` instead of `coder`)?

## Future Possibilities

- **Role marketplace** -- Community-contributed templates installable via a registry.
- **Composite roles** -- Roles that combine capabilities of multiple templates for small teams.
- **Role metrics** -- Track which roles produce the best outcomes (pass rates, iteration counts) and suggest replacements.
- **Conditional tools** -- Roles that gain/lose tool access based on pipeline stage (e.g., implementer gets Bash during implementing but not during fixing).
- **Role conversations** -- Roles that can request input from other roles mid-task (e.g., coder asks code-reviewer for a quick check before marking ready).
