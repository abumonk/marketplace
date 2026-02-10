# Init Skills

> Analyze a project's needs and install relevant skills, plugins, patterns, and configurations.

## Problem

Projects depend on different tooling. A Node.js project needs linting skills, testing frameworks, and deployment patterns. A Python ML project needs data validation, notebook integration, and experiment tracking patterns. Currently, there is no automated way to:

- Discover which skills and plugins are relevant to a project
- Install and configure them
- Keep them updated as the project evolves
- Ensure roles have the skills they reference

Skills are the **what** (tools and knowledge available to the project). Roles are the **who** (agents that use those tools). `init-skills` handles the former.

## Concept

`init-skills` is a skill that performs project analysis and recommends installable capabilities. It operates independently from roles but complements them -- roles reference skills, and `init-skills` ensures those skills exist.

### Flow

```
1. Analyze project
   - Read dependency manifests: package.json, requirements.txt, Cargo.toml,
     go.mod, composer.json, Gemfile, pom.xml
   - Read config files: .eslintrc, tsconfig.json, pytest.ini, .github/workflows/
   - Read directory structure: src/, tests/, docs/, .docker/, etc.
   - Read .agent/config.md for existing configuration
   - Read .agent/roles/ for skills referenced by active roles

2. Identify needs
   - Map detected technologies to skill categories:
     Framework:    React -> react-patterns, component-testing
     Language:     TypeScript -> type-safety, ts-migration
     Testing:      Jest -> test-driven-development, snapshot-testing
     CI/CD:        GitHub Actions -> workflow-patterns, deployment
     Infra:        Docker -> container-patterns, compose-management
     Code Quality: ESLint -> linting-patterns, code-standards

3. Check availability
   - Scan installed plugins for matching skills
   - Search plugin registry for uninstalled matches
   - Check if roles reference skills that aren't available

4. Present recommendations
   Categorized and prioritized:

   RECOMMENDED (matches detected stack):
   [x] test-driven-development    (Jest detected, referenced by qa-tester role)
   [x] react-patterns             (React 18 detected)
   [ ] container-patterns         (Dockerfile detected)

   OPTIONAL (commonly paired):
   [ ] accessibility-testing      (React project, good practice)
   [ ] performance-monitoring     (Production app detected)

   MISSING (referenced by roles but not installed):
   [!] linting-patterns           (referenced by code-reviewer role)

5. Install selected
   - Install plugins via Claude Code plugin system
   - Create project-specific skill configurations if needed
   - Update .agent/config.md with installed_skills list
   - Warn about any skills that couldn't be resolved
```

### Skill Sources

| Source | How |
|--------|-----|
| Built-in plugin skills | Already available, just need activation |
| Marketplace plugins | Install via Claude Code plugin system |
| Community patterns | Download pattern files to `.agent/knowledge/` |
| Project-specific | Create custom skill stubs in `.agent/skills/` |

### Configuration

After installation, `.agent/config.md` gains:

```yaml
---
installed_skills:
  - name: test-driven-development
    source: superpowers
    installed: 2026-02-10
  - name: react-patterns
    source: community/react-plugin
    installed: 2026-02-10
missing_skills:
  - name: linting-patterns
    referenced_by: [code-reviewer]
    status: not-found
---
```

## Relationship to Current System

`init-skills` is a new addition with no direct predecessor. The closest existing pattern is `task-migrate` which also scans, presents options, and acts on selection.

It integrates into the setup flow after `task-init` and `init-roles`:

```
/task-init       --> structure
/init-roles      --> agents
/init-skills     --> capabilities
/task create     --> work
```

Can also run standalone to audit and update a project's skill set at any time.

## Key Abstractions

**Tech Profile** -- The analyzed summary of a project's technology stack, frameworks, languages, and tools. Generated during analysis, used for matching.

**Skill Match** -- A pairing between a detected technology and an available skill. Has a confidence score and category.

**Skill Registry** -- Index of all available skills across installed plugins and the marketplace. Searched during the availability check.

**Skill Gap** -- A skill referenced by a role but not installed. Flagged as `MISSING` with high priority in recommendations.

**Installation Record** -- Entry in `.agent/config.md` tracking what was installed, from where, and when. Used for updates and auditing.

## Interaction Patterns

- **roles** -- `init-skills` reads `.agent/roles/` to find referenced skills. Skill gaps between role requirements and installed skills are surfaced prominently.
- **init-roles** -- Can suggest running `init-skills` after role instantiation. The two skills complement each other and can be chained.
- **controller** -- No direct interaction. The controller spawns agents; agents use skills. The controller doesn't need to know about skills.
- **learn** -- Can output skill recommendations when analyzing external projects ("this project uses X skill effectively, want to install it?").
- **messenger** -- No direct interaction.

## Open Questions

1. **Registry format** -- What does the skill registry look like? A local JSON index of installed plugins' skills? A remote API?
2. **Version management** -- How to handle skill updates? Re-run `init-skills` to check for newer versions?
3. **Conflict detection** -- Can two skills conflict (e.g., different linting approaches)? How to handle?
4. **Custom skill creation** -- If no matching skill exists, should `init-skills` offer to create a stub? Or defer to manual creation?
5. **Depth of analysis** -- How deep should project analysis go? File-level (check for config files) or code-level (AST analysis of imports)?

## Future Possibilities

- **Continuous monitoring** -- Detect when new dependencies are added (new entries in package.json) and suggest relevant skills.
- **Skill scoring** -- Track which skills are actually used by agents and suggest removing unused ones.
- **Auto-configuration** -- Beyond installation, auto-configure skills based on project conventions (e.g., set test patterns based on existing test file locations).
- **Cross-project skill sharing** -- If the workspace has multiple projects, share skill configurations between similar projects.
- **Skill creation wizard** -- When no matching skill exists, guide the user through creating a custom skill tailored to their project.
