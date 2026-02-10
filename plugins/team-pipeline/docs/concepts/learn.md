# Learn

> Analyze an external project, generate a structured report, and offer actionable options for adopting its patterns.

## Problem

Developers frequently encounter well-structured projects they want to learn from -- open source libraries with clean architecture, team projects with good conventions, or reference implementations. Currently, learning from these projects is manual: read through the code, take notes, try to apply patterns. This is time-consuming, inconsistent, and easy to lose.

There is no structured way to:
- Systematically analyze what makes a project well-organized
- Extract specific, adoptable patterns
- Apply those patterns to the current project
- Track what was learned and from where

## Concept

`learn` is a command/skill that takes a `project_path`, performs deep analysis, generates a report, and presents actionable options. The user chooses what to adopt, and the system creates a plan for applying those learnings.

### Command

```
/learn <project_path>
```

### Flow

```
1. Scan project at project_path
   - Directory structure and organization patterns
   - Configuration files (build, lint, test, CI/CD, editor)
   - Code patterns (naming conventions, module structure, error handling)
   - Testing approach (framework, coverage, test organization)
   - Documentation style (README structure, inline docs, API docs)
   - Dependency management (versions, lockfiles, monorepo setup)
   - Git practices (branch strategy, commit conventions, PR templates)

2. Generate report
   Write to: .agent/reports/learn-{project-name}-report.md

   Sections:
   - Overview (size, language, framework, maturity)
   - Architecture (module boundaries, dependency graph, layers)
   - Code Patterns (naming, error handling, logging, types)
   - Testing Strategy (framework, patterns, coverage approach)
   - DevOps & Config (CI/CD, deployment, environment management)
   - Documentation (quality, coverage, style)
   - Strengths (what this project does well)
   - Weaknesses (potential issues or anti-patterns)

3. Present options
   Extract learnable items grouped by category:

   ARCHITECTURE:
   [ ] Adopt their modular directory structure (src/modules/{name}/)
   [ ] Use their dependency injection pattern
   [ ] Mirror their error handling hierarchy

   TESTING:
   [ ] Adopt their test co-location pattern (*.test.ts next to source)
   [ ] Use their fixture/factory approach
   [ ] Apply their integration test structure

   CONVENTIONS:
   [ ] Adopt their commit message format (conventional commits)
   [ ] Use their PR template
   [ ] Apply their naming conventions

   TOOLING:
   [ ] Install their linting configuration
   [ ] Adopt their CI/CD pipeline structure
   [ ] Use their documentation generator setup

4. User selects options

5. Create plan
   For each selected option, generate an actionable plan:
   - What changes to make in the current project
   - Which files to create/modify
   - Any dependencies to install
   - Estimated effort

   Output: .agent/reports/learn-{project-name}-plan.md
   Optionally: create tasks via /task create for each item
```

### Analysis Depth

The scan uses read-only exploration (Glob, Grep, Read). It does not execute any code in the target project. Analysis is structural and pattern-based, not behavioral.

For large projects, the scan focuses on:
- Top-level structure and entry points
- Configuration files (usually at root)
- A representative sample of source files (not exhaustive)
- Test files and their relationship to source

### Report Format

```markdown
# Learn Report: {project-name}

> Analyzed: {date}
> Source: {project_path}
> Size: {file count} files, {line count} lines
> Stack: {detected languages and frameworks}

## Overview
Brief project description based on README and structure.

## Architecture
How the project is organized, key boundaries, dependency flow.

## Code Patterns
Naming conventions, error handling, module structure, types.

## Testing Strategy
Test framework, patterns, coverage approach, test organization.

## DevOps & Configuration
Build system, CI/CD, deployment, environment management.

## Documentation
README quality, inline documentation, API docs.

## Strengths
What this project does particularly well.

## Adoptable Patterns
Numbered list of specific, actionable patterns that could be applied
to the current project. Each with:
- What: the pattern
- Where: files/areas in the source project that demonstrate it
- How: rough sketch of how to apply it
- Effort: low/medium/high
```

## Relationship to Current System

`learn` is a standalone feature that connects to the pipeline through its outputs:

- Reports go to `.agent/reports/` (existing directory from `task-init`)
- Plans can generate tasks via `/task create` (existing command)
- Tooling recommendations can feed into `init-skills`
- Team structure observations can feed into `init-roles`

It does not modify the pipeline state machine or any existing agents.

## Key Abstractions

**Project Scan** -- The read-only analysis of an external project. Produces raw data about structure, patterns, and conventions.

**Learn Report** -- Structured markdown document summarizing the analysis. Stored in `.agent/reports/`. Permanent reference.

**Adoptable Pattern** -- A specific, actionable item extracted from the report. Has a category, description, source location, application sketch, and effort estimate.

**Adoption Plan** -- The user's selected patterns converted into concrete steps for the current project. Can be executed manually or converted into pipeline tasks.

## Interaction Patterns

- **init-skills** -- Learn can identify tooling the external project uses and recommend it for installation. Output includes a "Tooling" category that maps directly to `init-skills` input.
- **init-roles** -- Learn can observe the external project's team structure (if evident from CODEOWNERS, commit authors, or directory ownership) and suggest role configurations.
- **controller** -- No direct interaction during analysis. If the adoption plan creates tasks, those enter the normal pipeline.
- **messenger** -- No direct interaction.
- **roles** -- No direct interaction, but adopted conventions might update role knowledge bases (`.agent/knowledge/`).

## Open Questions

1. **Scope limits** -- How large a project can we meaningfully analyze in a single session? Need to cap file counts and sample strategically for monorepos.
2. **Private vs public projects** -- Does the target need to be a local path, or could it accept a Git URL and clone? Local path is simpler for v1.
3. **Comparison mode** -- Should `learn` be able to compare two projects and highlight differences? Useful but complex. Defer.
4. **Incremental learning** -- Run `learn` again after the source project updates? Or is it a point-in-time snapshot? Snapshot for v1.
5. **Pattern quality** -- How do we distinguish good patterns from project-specific quirks? Likely can't fully automate this -- the user's selection step is the quality gate.
6. **Knowledge base integration** -- Should adopted patterns automatically update `.agent/knowledge/patterns.md`? Yes, with user confirmation.

## Future Possibilities

- **Git URL support** -- Accept `https://github.com/user/repo` and clone to temp directory for analysis.
- **Pattern library** -- Accumulate patterns from multiple `learn` runs into a searchable library.
- **Diff-based learning** -- Analyze how a project evolved over time (git history) to understand not just what patterns exist but why they were introduced.
- **Team learning** -- Multiple team members run `learn` on different projects, pool findings.
- **Auto-apply** -- For low-effort patterns (config file changes, adding a PR template), offer one-click application instead of plan generation.
- **Comparative analysis** -- "Learn from X what they do better than us in Y" -- focused comparison on specific aspects.
