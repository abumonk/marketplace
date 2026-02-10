# Init Roles

> Interactive skill that creates and updates project-specific agent roles from templates.

## Problem

After running `task-init`, every project gets the same four generic agents regardless of what the project actually needs. A React frontend project has no use for a `devops` role but desperately needs a `designer`. A Python data pipeline needs a `data-engineer` but not a `ux-designer`.

There is no mechanism to:
- Select which roles a project needs
- Customize role templates for project-specific requirements
- Update roles when templates evolve
- Remove roles that are no longer relevant

## Concept

`init-roles` is a skill (like `task-init`) that bridges the gap between generic role templates and project-specific agent configurations. It runs an interactive flow:

### Flow

```
1. Analyze project
   - Read tech stack (package.json, requirements.txt, Cargo.toml, etc.)
   - Read existing .agent/config.md
   - Read existing .agent/roles/ if any
   - Identify project type (frontend, backend, fullstack, data, infra)

2. Recommend roles
   - Match project type against role templates in roles/templates/
   - Present categorized list:
     Core:     [x] planner, [x] implementer, [x] reviewer
     Code:     [ ] coder, [ ] code-reviewer
     Design:   [ ] designer, [ ] ux-designer
     Quality:  [ ] qa-tester
     Ops:      [ ] devops
     Research: [x] researcher

3. User selects
   - Toggle roles on/off
   - Optionally customize per-role: model override, tool restrictions, etc.

4. Instantiate
   - Copy selected templates to .agent/roles/
   - Apply any user overrides to frontmatter
   - Verify referenced skills are available (warn if missing, suggest init-skills)

5. Register
   - Update .agent/config.md with active_roles list
   - Update controller-state if controller is configured
```

### Update Mode

Running `init-roles` on a project with existing roles enters update mode:

- **Add**: Present templates not yet instantiated
- **Sync**: Show diff between template and instance for roles that have upstream changes
- **Remove**: List currently active roles, allow deactivation (moves to `.agent/roles/.archive/`)

### Role Customization

During selection, the user can override any template field:

```
Selected: coder
  Model: sonnet (template default) -> Change? [sonnet/haiku/opus]
  Tools: Read, Glob, Grep, Write, Edit, Bash -> Remove any?
  Extra knowledge: Add project-specific knowledge files?
```

Overrides are stored in the instance frontmatter as `overrides:` to track what diverged from the template.

## Relationship to Current System

This feature **extends** `task-init`. The recommended flow becomes:

```
1. /task-init          --> creates .agent/ structure
2. /init-roles         --> populates .agent/roles/
3. /init-skills        --> installs needed skills
4. /task create        --> starts working
```

`task-init` remains unchanged. `init-roles` is additive -- it creates `.agent/roles/` which the controller reads. If no roles are configured, the pipeline falls back to the default `agents/` directory (backward compatible).

## Key Abstractions

**Project Profile** -- The analyzed summary of a project's tech stack, structure, and type. Generated during step 1, used to match role templates.

**Role Selection** -- The user's chosen set of roles with any overrides. Persisted as individual files in `.agent/roles/`.

**Template Diff** -- In update mode, the comparison between a role template and its project instance. Highlights fields that changed upstream vs. fields the user customized.

**Active Roles List** -- Maintained in `.agent/config.md` under `active_roles:`. The controller reads this to know which agents it can spawn.

## Interaction Patterns

- **roles** -- Reads templates from `roles/templates/`, writes instances to `.agent/roles/`.
- **init-skills** -- After role instantiation, checks if all referenced skills are available. If not, suggests running `init-skills`. Can be chained: `init-roles` then `init-skills`.
- **controller** -- After `init-roles` completes, the controller becomes aware of the new role set. It uses `.agent/config.md` `active_roles` to resolve agent spawning.
- **learn** -- Can suggest role configurations based on patterns observed in external projects ("this project uses a dedicated qa-tester role, want to add one?").
- **messenger** -- No direct interaction.

## Open Questions

1. **Mandatory roles** -- Are planner/implementer/reviewer always required? Or can a project opt for a minimal set (e.g., just coder + reviewer)?
2. **Role dependencies** -- If `qa-tester` requires the `testing` skill, should `init-roles` auto-install it or just warn?
3. **Team size presets** -- Should there be presets like "solo" (planner+implementer+reviewer), "small team" (adds coder+researcher), "full team" (all roles)?
4. **Project type detection accuracy** -- How reliably can we detect project type from file analysis? Probably good enough for recommendations, but always let user override.
5. **Multiple instances of same role** -- Can a project have two `coder` instances with different specializations (e.g., `coder-frontend`, `coder-backend`)?

## Future Possibilities

- **Role suggestions from task history** -- After N tasks, analyze which roles were most/least used and suggest adjustments.
- **Auto-init** -- Detect project type on first `/task create` and suggest roles automatically if `.agent/roles/` is empty.
- **Role sharing** -- Export a project's role configuration as a shareable preset for similar projects.
- **Skill auto-install** -- When a role references skills that aren't installed, automatically trigger `init-skills` for those specific skills.
