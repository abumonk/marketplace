# Roles System Design

**Date:** 2026-02-10
**Status:** DRAFT
**Depends on:** `docs/concepts/roles.md`, `docs/concepts/controller.md`, `docs/concepts/init-roles.md`, `docs/concepts/init-skills.md`

---

## Overview

The roles system introduces an abstraction layer between role templates (plugin-level, reusable) and role instances (project-level, customizable). Role templates live in `roles/templates/` within the plugin and define complete agent profiles: model, tools, skills, knowledge bindings, pipeline stage participation, and system prompts. When a project runs `init-roles`, selected templates are instantiated into `.agent/roles/` where they can override any template field. The system supports single inheritance, backward-compatible agent resolution, and deterministic stage assignment via `config.md`.

---

## Decisions

| Question | Decision | Rationale |
|----------|----------|-----------|
| Composition vs single inheritance | Single inheritance only | YAGNI. Multiple inheritance creates diamond problems and merge ambiguity. A role can inherit from one parent and override fields. If a role needs capabilities from two parents, create a new template that manually combines them. |
| Template update to instances | `init-roles --sync` shows diff, user applies | Templates evolve at plugin update time. Running `init-roles --sync` compares each instance against its source template, shows a field-by-field diff (skipping fields in `overrides`), and lets the user accept or reject each change. No automatic mutation. |
| Custom roles without templates | Yes, any valid `.md` in `.agent/roles/` works | A role instance does not require a `source_template` field. If absent, the role is treated as fully custom. It participates in the pipeline like any other role. No template diffing or sync applies. |
| Stage conflicts (two roles for same stage) | `config.md` declares `stage_assignments` map | When multiple roles declare the same `pipeline_stages` entry, the `stage_assignments` map in `.agent/config.md` is the single source of truth for which role serves which stage. The controller reads this map, never the role files directly, for stage routing. |
| Dynamic role selection by tags | Deferred to controller design | Tag-based routing (e.g., `tags: [frontend]` routes to `designer` instead of `coder`) is a controller concern. The roles system provides the data (`pipeline_stages`, role metadata) but the controller owns the routing logic. See `docs/concepts/controller.md`. |
| Mandatory roles | No mandatory roles | Any valid combination works. A minimal project could use only `coder` + `reviewer`. The pipeline stages that have no assigned role simply cannot be advanced to -- the controller skips them or errors. |
| Multiple instances of same template | Yes, via naming convention | A project can instantiate `coder` twice as `coder-frontend.md` and `coder-backend.md`. Each is a separate role instance with its own overrides. The `stage_assignments` map routes to the specific instance name. |
| Role file extension | `.md` (markdown with YAML frontmatter) | Consistent with existing agent format. Human-readable. Editable in any text editor. |

---

## Role Template Format

Role templates extend the current agent frontmatter with new fields. All existing fields are preserved for backward compatibility.

### Schema

```yaml
---
# === Identity (required) ===
name: coder                          # Unique template identifier
description: >
  Implements features and fixes based on designs
  and task specifications.

# === Inheritance (optional) ===
inherits: implementer                # Single parent template name, or omit

# === Model & Limits ===
model: sonnet                        # opus | sonnet | haiku
maxTurns: 50                         # Max agent turns before forced stop
memory: project                      # project | global | none

# === Tool Access ===
tools:                               # Allowed tools list
  - Read
  - Glob
  - Grep
  - Write
  - Edit
  - Bash
disallowedTools: []                  # Explicitly blocked tools

# === Skills & Knowledge (new) ===
skills:                              # Skill names this role needs
  - testing
  - linting
knowledge:                           # Knowledge base sections to inject
  - patterns
  - decisions
  - conventions

# === Pipeline Binding (new) ===
pipeline_stages:                     # Stages this role can serve
  - implementing
  - fixing
---

# System Prompt

Body of the markdown file is the system prompt, identical to current agent format.
```

### Field Reference

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | string | yes | -- | Unique identifier. Filename must match: `{name}.md` |
| `description` | string | yes | -- | One-line purpose statement. Used by controller for routing decisions. |
| `inherits` | string | no | `null` | Parent template name. Child inherits all parent fields, then overrides. |
| `model` | string | yes | -- | LLM model: `opus`, `sonnet`, or `haiku` |
| `maxTurns` | integer | yes | -- | Maximum agent turns |
| `memory` | string | no | `project` | Memory scope |
| `tools` | list[string] | yes | -- | Allowed tool names |
| `disallowedTools` | list[string] | no | `[]` | Explicitly blocked tools |
| `skills` | list[string] | no | `[]` | Required skill names. Verified by `init-roles` and `init-skills`. |
| `knowledge` | list[string] | no | `[]` | Knowledge section names from `.agent/knowledge/`. Injected into prompt context. |
| `pipeline_stages` | list[string] | no | `[]` | Pipeline stages this role can participate in. Valid values: `planning`, `implementing`, `reviewing`, `fixing`, `researching`. |

---

## Directory Structure

```
team-pipeline/                          # Plugin root
  .claude-plugin/
    plugin.json
  agents/                               # Legacy agent definitions (backward compat)
    planner.md
    implementer.md
    reviewer.md
    researcher.md
  roles/
    templates/                          # Role templates (canonical source)
      planner.md
      implementer.md
      reviewer.md
      researcher.md
      coder.md
      code-reviewer.md
      designer.md
      ux-designer.md
      qa-tester.md
      devops.md
  skills/
    task-create/SKILL.md
    task-status/SKILL.md
    task-init/SKILL.md
    task-migrate/SKILL.md
    init-roles/SKILL.md                 # New: role instantiation skill
  hooks/
    hooks.json
  commands/
    task.md
  docs/
    concepts/
    designs/
```

### Project-Level Structure

```
project/
  .agent/
    roles/                              # Role instances (project-specific)
      planner.md                        # Instantiated from template
      coder.md                          # Instantiated, may have overrides
      coder-frontend.md                 # Custom variant, no template
      reviewer.md
      researcher.md
      .archive/                         # Deactivated roles (from init-roles remove)
        ux-designer.md
    tasks/
    tasks/archive/
    logs/
    reports/
    designs/
    knowledge/
      patterns.md
      decisions.md
      issues.md
      conventions.md                    # Referenced by knowledge field
    config.md                           # Includes stage_assignments, active_roles
    controller-state.md                 # Controller runtime state
```

---

## Built-in Role Templates

### Summary Table

| Name | Model | maxTurns | Pipeline Stages | Skills | Knowledge |
|------|-------|----------|-----------------|--------|-----------|
| planner | opus | 30 | planning | -- | patterns, decisions |
| implementer | sonnet | 50 | implementing, fixing | testing | patterns, decisions |
| reviewer | opus | 25 | reviewing | -- | patterns, issues |
| researcher | haiku | 15 | researching | -- | patterns, issues, decisions |
| coder | sonnet | 50 | implementing, fixing | testing, linting | patterns, decisions, conventions |
| code-reviewer | opus | 25 | reviewing | linting | patterns, issues, conventions |
| designer | opus | 30 | planning | -- | patterns, decisions |
| ux-designer | sonnet | 25 | planning | -- | patterns, conventions |
| qa-tester | sonnet | 30 | reviewing | testing | patterns, issues |
| devops | sonnet | 40 | implementing, fixing | -- | patterns, decisions |

### Tool Access

| Name | tools | disallowedTools |
|------|-------|-----------------|
| planner | Read, Glob, Grep, Write, Edit, WebSearch, WebFetch | Bash |
| implementer | Read, Glob, Grep, Write, Edit, Bash | -- |
| reviewer | Read, Glob, Grep, Bash | Write, Edit |
| researcher | Read, Glob, Grep, Write, Edit | Bash |
| coder | Read, Glob, Grep, Write, Edit, Bash | -- |
| code-reviewer | Read, Glob, Grep, Bash | Write, Edit |
| designer | Read, Glob, Grep, Write, Edit, WebSearch, WebFetch | Bash |
| ux-designer | Read, Glob, Grep, Write, Edit, WebSearch, WebFetch | Bash |
| qa-tester | Read, Glob, Grep, Bash, Write | Edit |
| devops | Read, Glob, Grep, Write, Edit, Bash | -- |

### Inheritance

| Name | Inherits | Overrides from Parent |
|------|----------|-----------------------|
| planner | -- | -- |
| implementer | -- | -- |
| reviewer | -- | -- |
| researcher | -- | -- |
| coder | implementer | skills adds `linting`, knowledge adds `conventions` |
| code-reviewer | reviewer | skills adds `linting`, knowledge adds `conventions` |
| designer | planner | description, system prompt (architecture/API focus) |
| ux-designer | planner | model (`sonnet`), maxTurns (`25`), description, system prompt (UI/UX focus) |
| qa-tester | reviewer | tools adds `Write`, disallowedTools changes to `Edit` only, skills adds `testing`, system prompt (test-writing focus) |
| devops | implementer | maxTurns (`40`), description, system prompt (infra/CI focus) |

### Template Definitions

#### planner.md

```yaml
---
name: planner
description: >
  Creates task plans and design documents. Architecture decisions,
  file targeting, and scope definition before implementation begins.
model: opus
maxTurns: 30
memory: project
tools: [Read, Glob, Grep, Write, Edit, WebSearch, WebFetch]
disallowedTools: [Bash]
skills: []
knowledge: [patterns, decisions]
pipeline_stages: [planning]
---
```

Key responsibilities:
- Read codebase and knowledge base to understand context
- Produce design document in `.agent/designs/{task-id}-design.md`
- Identify target files, refine acceptance criteria, set `status: ready`

#### implementer.md

```yaml
---
name: implementer
description: >
  Implements code changes following the plan and design.
  Handles fix iterations after review feedback.
model: sonnet
maxTurns: 50
memory: project
tools: [Read, Glob, Grep, Write, Edit, Bash]
disallowedTools: []
skills: [testing]
knowledge: [patterns, decisions]
pipeline_stages: [implementing, fixing]
---
```

Key responsibilities:
- Implement changes per design document, restricted to listed target files
- Run build and test commands before marking ready
- Address review feedback point-by-point when in `fixing` stage

#### reviewer.md

```yaml
---
name: reviewer
description: >
  Reviews implementation against acceptance criteria. Runs tests,
  checks code quality, produces review report. Never writes code.
model: opus
maxTurns: 25
memory: project
tools: [Read, Glob, Grep, Bash]
disallowedTools: [Write, Edit]
skills: []
knowledge: [patterns, issues]
pipeline_stages: [reviewing]
---
```

Key responsibilities:
- Verify build passes, tests pass, all acceptance criteria met
- Produce structured review report with issues, severity, file/line references
- Set `status: passed` or `status: failed`

#### researcher.md

```yaml
---
name: researcher
description: >
  Analyzes completed tasks to extract patterns, lessons learned,
  and knowledge. Updates project knowledge base.
model: haiku
maxTurns: 15
memory: project
tools: [Read, Glob, Grep, Write, Edit]
disallowedTools: [Bash]
skills: []
knowledge: [patterns, issues, decisions]
pipeline_stages: [researching]
---
```

Key responsibilities:
- Analyze full task lifecycle artifacts (design, implementation, review)
- Update knowledge base files: patterns, issues, decisions
- Deduplicate entries; skip if nothing to learn

#### coder.md

```yaml
---
name: coder
description: >
  Implements features and fixes with emphasis on code quality,
  testing, and adherence to project conventions.
inherits: implementer
model: sonnet
maxTurns: 50
memory: project
tools: [Read, Glob, Grep, Write, Edit, Bash]
disallowedTools: []
skills: [testing, linting]
knowledge: [patterns, decisions, conventions]
pipeline_stages: [implementing, fixing]
---
```

Key responsibilities:
- All implementer responsibilities plus convention enforcement
- Run linting in addition to build/test before marking ready
- Follow project-specific coding conventions from knowledge base

#### code-reviewer.md

```yaml
---
name: code-reviewer
description: >
  Reviews code for quality, style, patterns, and convention
  adherence. More code-focused than the general reviewer.
inherits: reviewer
model: opus
maxTurns: 25
memory: project
tools: [Read, Glob, Grep, Bash]
disallowedTools: [Write, Edit]
skills: [linting]
knowledge: [patterns, issues, conventions]
pipeline_stages: [reviewing]
---
```

Key responsibilities:
- All reviewer responsibilities plus convention and style checking
- Run linting tools and report violations
- Check for anti-patterns documented in knowledge base

#### designer.md

```yaml
---
name: designer
description: >
  Creates system architecture designs, API contracts, and
  technical specifications. Focused on backend and system design.
inherits: planner
model: opus
maxTurns: 30
memory: project
tools: [Read, Glob, Grep, Write, Edit, WebSearch, WebFetch]
disallowedTools: [Bash]
skills: []
knowledge: [patterns, decisions]
pipeline_stages: [planning]
---
```

Key responsibilities:
- Design system architecture, API contracts, data models
- Research external APIs and integration patterns via web search
- Produce detailed technical specifications with interface definitions

#### ux-designer.md

```yaml
---
name: ux-designer
description: >
  Creates UI/UX designs, component specifications, and
  interaction patterns for frontend work.
inherits: planner
model: sonnet
maxTurns: 25
memory: project
tools: [Read, Glob, Grep, Write, Edit, WebSearch, WebFetch]
disallowedTools: [Bash]
skills: []
knowledge: [patterns, conventions]
pipeline_stages: [planning]
---
```

Key responsibilities:
- Design component structure, layouts, and interaction flows
- Reference existing UI patterns and conventions for consistency
- Produce component specifications with prop interfaces and state management

#### qa-tester.md

```yaml
---
name: qa-tester
description: >
  Reviews implementation by writing and running tests.
  Focuses on test coverage, edge cases, and regression prevention.
inherits: reviewer
model: sonnet
maxTurns: 30
memory: project
tools: [Read, Glob, Grep, Bash, Write]
disallowedTools: [Edit]
skills: [testing]
knowledge: [patterns, issues]
pipeline_stages: [reviewing]
---
```

Key responsibilities:
- Write new test cases for uncovered paths and edge cases
- Run full test suite and report coverage metrics
- Set `status: passed` only if coverage thresholds are met

#### devops.md

```yaml
---
name: devops
description: >
  Implements infrastructure changes, CI/CD pipelines, deployment
  configurations, and operational tooling.
inherits: implementer
model: sonnet
maxTurns: 40
memory: project
tools: [Read, Glob, Grep, Write, Edit, Bash]
disallowedTools: []
skills: []
knowledge: [patterns, decisions]
pipeline_stages: [implementing, fixing]
---
```

Key responsibilities:
- Implement Dockerfiles, CI/CD workflows, deployment scripts
- Configure infrastructure-as-code files
- Run validation commands (docker build, config linting) before marking ready

---

## Instance Override Mechanism

When `init-roles` instantiates a template into `.agent/roles/`, the user can override any frontmatter field. Overrides are tracked in an `overrides` list so `init-roles --sync` knows which fields the user intentionally changed (and should not be clobbered by template updates).

### Instance Format

```yaml
---
name: coder
description: >
  Implements features and fixes with emphasis on code quality,
  testing, and adherence to project conventions.
source_template: coder                # Template this was instantiated from
template_version: 0.1.0              # Plugin version at instantiation time
inherits: implementer
model: haiku                          # OVERRIDDEN: sonnet -> haiku
maxTurns: 50
memory: project
tools: [Read, Glob, Grep, Write, Edit, Bash]
disallowedTools: []
skills: [testing, linting]
knowledge: [patterns, decisions, conventions, api-guidelines]  # OVERRIDDEN: added api-guidelines
pipeline_stages: [implementing, fixing]
overrides:                            # Tracks which fields the user changed
  - model
  - knowledge
---

# System Prompt

(inherited from template, or overridden here)
```

### Override Rules

| Scenario | Behavior |
|----------|----------|
| Field in `overrides` list | Preserved during `--sync`. User intentionally changed it. |
| Field NOT in `overrides` list | Updated to match template during `--sync` (with diff confirmation). |
| New field added to template | Added to instance during `--sync`. |
| Field removed from template | Flagged in diff. User decides whether to keep or remove. |
| `source_template` absent | Treated as custom role. No sync applies. |
| System prompt body | Tracked as an override if the instance body differs from template body. Stored as `system_prompt` in `overrides` list. |

### Sync Diff Example

```
$ /init-roles --sync

Checking role instances against templates...

coder.md:
  model: haiku (local override, keeping)
  knowledge: [..., api-guidelines] (local override, keeping)
  maxTurns: 50 -> 60 (template updated)
    Accept? [y/n]
  skills: [testing, linting] -> [testing, linting, formatting] (template updated)
    Accept? [y/n]

reviewer.md:
  No changes.

designer.md:
  System prompt updated (12 lines changed).
    View diff? [y/n]
```

---

## Inheritance

### Mechanism

Single inheritance via the `inherits` field. A child template names one parent template. The child receives all parent fields as defaults, then its own fields override them.

### Resolution Order

```
1. Read parent template (if inherits is set)
2. Read child template
3. Merge: child fields override parent fields
4. For list fields (tools, skills, knowledge, pipeline_stages):
   child list REPLACES parent list entirely (no merge)
5. For system prompt (markdown body):
   child body REPLACES parent body entirely
```

### Why Replace, Not Merge for Lists

Merging lists creates hidden dependencies. If `implementer` has `tools: [Read, Write, Bash]` and `coder` inherits and adds `[Edit]`, the effective list depends on parent state. If the parent later removes `Bash`, the child silently loses it. Replace semantics make the child self-describing: what you see is what you get.

### Resolution Diagram

```
Parent: implementer.md
  model: sonnet
  maxTurns: 50
  tools: [Read, Glob, Grep, Write, Edit, Bash]
  skills: [testing]
  knowledge: [patterns, decisions]
  pipeline_stages: [implementing, fixing]

Child: coder.md (inherits: implementer)
  skills: [testing, linting]           # REPLACES parent skills
  knowledge: [patterns, decisions, conventions]  # REPLACES parent knowledge
  (all other fields inherited as-is)

Resolved coder:
  model: sonnet                        # from parent
  maxTurns: 50                         # from parent
  tools: [Read, Glob, Grep, Write, Edit, Bash]  # from parent
  skills: [testing, linting]           # from child (replaced)
  knowledge: [patterns, decisions, conventions]  # from child (replaced)
  pipeline_stages: [implementing, fixing]        # from parent
```

### Inheritance Constraints

| Constraint | Rule |
|------------|------|
| Depth | Max 2 levels (parent -> child). No grandparent chains. |
| Cycles | Prohibited. `init-roles` validates at instantiation time. |
| Cross-reference | Parent must exist in `roles/templates/` at resolution time. |
| Instance inheritance | Instances do NOT inherit from other instances. `inherits` always refers to a template. |
| Custom roles | Custom roles (no `source_template`) can still use `inherits` to reference a template as a base. |

---

## Backward Compatibility

### Agent Resolution Order

The controller and `/task advance` resolve which agent to spawn using this precedence:

```
1. .agent/roles/{role-name}.md         # Project-level role instance (highest priority)
2. roles/templates/{role-name}.md      # Plugin-level role template
3. agents/{role-name}.md               # Legacy agent definition (fallback)
```

If `.agent/roles/` exists and contains any files, only roles from that directory are used. The `agents/` directory is NOT mixed with `.agent/roles/` -- it is a complete fallback for projects that have not run `init-roles`.

### Resolution Logic

```
if .agent/roles/ exists AND has .md files:
    use .agent/roles/ exclusively
    stage routing via config.md stage_assignments
else:
    use agents/ directory (current behavior)
    stage routing via hardcoded stage-to-agent map:
      planning     -> planner
      implementing -> implementer
      reviewing    -> reviewer
      fixing       -> implementer
      researching  -> researcher
```

### Migration Path

| Step | Action | Reversible |
|------|--------|------------|
| 0 | Do nothing. Existing `agents/` work as before. | -- |
| 1 | Run `/init-roles`. Creates `.agent/roles/` from templates. | Yes: delete `.agent/roles/` |
| 2 | Controller detects `.agent/roles/`, uses role-based resolution. | Yes: same |
| 3 | Customize roles, add new ones, configure `stage_assignments`. | Yes: re-run `init-roles` |

The `agents/` directory is **never removed** from the plugin. It remains as the fallback for un-migrated projects and as a reference for the original agent definitions.

---

## Integration Points

### Controller

The controller reads role information to decide which agent to spawn for a given pipeline stage.

```
Controller reads:
  1. .agent/config.md -> stage_assignments map
  2. .agent/roles/{assigned-role}.md -> agent frontmatter for spawning

Controller does NOT read:
  - roles/templates/ (that is init-roles' domain)
  - agents/ (unless fallback mode)
```

**`stage_assignments` in `.agent/config.md`:**

```yaml
---
stage_assignments:
  planning: planner
  implementing: coder
  reviewing: code-reviewer
  fixing: coder
  researching: researcher
active_roles:
  - planner
  - coder
  - code-reviewer
  - researcher
---
```

The `stage_assignments` map is the single source of truth for routing. If two roles declare `pipeline_stages: [implementing]`, only the one named in `stage_assignments.implementing` is spawned. The other is available but inactive for that stage unless the user reconfigures.

When a task has specific needs (e.g., `tags: [infra]` should route to `devops` instead of `coder`), that is a controller-level concern using tag-based routing rules. The roles system provides the metadata; the controller owns the logic.

### init-roles

`init-roles` is the primary interface for managing role instances.

```
init-roles (first run):
  1. Read roles/templates/ -> list available templates
  2. Analyze project -> recommend roles
  3. User selects roles and optional overrides
  4. Write instances to .agent/roles/
  5. Write stage_assignments to .agent/config.md
  6. Write active_roles to .agent/config.md

init-roles --sync:
  1. Read .agent/roles/ instances
  2. Read roles/templates/ for source templates
  3. Compare each instance against its template (skip overrides fields)
  4. Show diff, user accepts/rejects per field
  5. Update instances and template_version

init-roles --add {role-name}:
  1. Read roles/templates/{role-name}.md
  2. Instantiate to .agent/roles/{role-name}.md
  3. Update active_roles in config.md
  4. Prompt: update stage_assignments?

init-roles --remove {role-name}:
  1. Move .agent/roles/{role-name}.md to .agent/roles/.archive/
  2. Remove from active_roles in config.md
  3. Remove from stage_assignments (warn if stage now unassigned)
```

### init-skills

`init-skills` uses role information to identify skill gaps.

```
init-skills reads:
  1. .agent/roles/*.md -> skills field from each role
  2. Installed plugins -> available skills
  3. Compares: required skills vs available skills
  4. Reports gaps as MISSING with high priority

Example:
  coder.md declares skills: [testing, linting]
  Only "testing" is installed.
  init-skills flags: MISSING linting (referenced by coder role)
```

### Pipeline Flow with Roles

```
User: /task create "Add JWT auth"
  |
  Lead: creates TASK-001.md (stage: planning)
  Lead: reads config.md -> stage_assignments.planning = "planner"
  Lead: reads .agent/roles/planner.md -> spawns agent
  |
  Planner: designs, sets status: ready
  |
  Controller: reads config.md -> stage_assignments.implementing = "coder"
  Controller: reads .agent/roles/coder.md -> spawns agent
  |
  Coder: implements, runs lint + test, sets status: ready
  |
  Controller: reads config.md -> stage_assignments.reviewing = "code-reviewer"
  Controller: reads .agent/roles/code-reviewer.md -> spawns agent
  |
  Code-reviewer: reviews, sets status: passed
  |
  Controller: advances to completed, archives
  Controller: reads config.md -> stage_assignments.researching = "researcher"
  Controller: reads .agent/roles/researcher.md -> spawns agent
  |
  Researcher: extracts learnings, updates knowledge base
```

---

## config.md Role-Related Fields

The following fields are added to `.agent/config.md` to support the roles system.

```yaml
---
# ... existing fields (build_command, test_command, etc.) ...

# === Roles Configuration ===
active_roles:
  - planner
  - coder
  - code-reviewer
  - researcher

stage_assignments:
  planning: planner
  implementing: coder
  reviewing: code-reviewer
  fixing: coder
  researching: researcher

roles_initialized: 2026-02-10T14:00:00Z
roles_plugin_version: 0.1.0
---
```

| Field | Type | Description |
|-------|------|-------------|
| `active_roles` | list[string] | Names of all active role instances in `.agent/roles/` |
| `stage_assignments` | map[string, string] | Maps each pipeline stage to exactly one role name |
| `roles_initialized` | datetime | When `init-roles` was first run |
| `roles_plugin_version` | string | Plugin version at last `init-roles` run |
