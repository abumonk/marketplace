# Learn Skill Design

**Date:** 2026-02-10
**Status:** DRAFT
**Depends on:** `docs/concepts/learn.md`, `docs/designs/init-skills-design.md`, `docs/designs/init-roles-design.md`

---

## Overview

`learn` is a read-only skill that takes a local `project_path`, performs structural and pattern-based analysis of the target project, and generates a report at `.agent/reports/learn-{project-name}-report.md`. The report catalogs architecture, code patterns, testing strategy, tooling, and conventions. It then presents a numbered list of adoptable patterns the user can select. Selected patterns are written to `.agent/knowledge/patterns.md` with source attribution. Optionally, the skill generates an adoption plan and creates pipeline tasks for applying each pattern to the current project.

---

## Decisions

| Question | Decision | Rationale |
|----------|----------|-----------|
| Scope limits | Max 500 files scanned. Sample 20 source files for pattern extraction. Keeps analysis under 5 minutes. | Large projects (monorepos, vendor-heavy codebases) would exceed context limits and session time. 500 files is enough to capture structure; 20 sampled files give sufficient pattern signal without exhaustive reads. |
| Local path vs Git URL | Local path only for v1. No git clone. | Avoids filesystem side effects (temp directories, disk usage, cleanup). The user can clone manually and point learn at the result. Git URL support is additive and does not change the core design. |
| Comparison mode | Deferred. Single-project analysis only. | Comparing two projects doubles the scan work and introduces a complex diff format. Single-project analysis covers the primary use case. Comparison can layer on top of learn reports later. |
| Incremental learning | Snapshot only. Re-run for updates. | The report captures the project at a point in time. There is no diffing mechanism between runs. Re-running learn overwrites the previous report. This avoids state management for external projects the plugin does not control. |
| Pattern quality | User selection is the quality gate. Report flags confidence level per pattern. | Automated quality detection cannot distinguish intentional patterns from project-specific quirks. Confidence levels (high/medium/low) give the user signal, but the final decision is theirs. |
| Knowledge base integration | Selected patterns written to `.agent/knowledge/patterns.md` with source attribution. | Aligns with the existing knowledge base structure from the team-pipeline design. Source attribution tracks provenance so patterns can be traced back to the project they came from. |

---

## Scan Scope

### Analyzed

| What | Method | Purpose |
|------|--------|---------|
| Top-level directory structure | `ls` / Glob `*/` and `*/**/` (depth 3) | Architecture patterns, module boundaries, layer identification |
| Config files (root) | Read (`package.json`, `tsconfig.json`, `.eslintrc.*`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `Makefile`, `docker-compose.yml`, etc.) | Tooling, build system, language conventions |
| README.md | Read | Project description, setup instructions, stated architecture |
| Source file sample (20 max) | Read | Code patterns: naming, error handling, imports, types |
| Test file structure | Glob (`**/*.test.*`, `**/*.spec.*`, `**/test_*`, `tests/**`) + Read sample (3-5 files) | Testing approach, framework, organization, fixture patterns |
| CI/CD config | Read (`.github/workflows/*.yml`, `.gitlab-ci.yml`, `Jenkinsfile`, `.circleci/config.yml`) | DevOps patterns, pipeline structure |
| Git log (last 20 commits) | Bash `git log --oneline -20` | Commit message conventions, contributor patterns |
| Package manifests | Read (`package.json`, `requirements.txt`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `pom.xml`, `build.gradle`) | Dependencies, tech stack, version management |

### Skipped

| What | Reason |
|------|--------|
| `node_modules/`, `.git/`, `vendor/`, `dist/`, `build/`, `__pycache__/`, `target/`, `.next/`, `.nuxt/` | Generated or vendored content, not authored code |
| Binary files (images, compiled assets, archives) | Not readable as text |
| Files > 500 lines | Too large for sampling; diminishing returns for pattern extraction |
| More than 500 total files enumerated | Scope limit to keep analysis tractable |

### Sampling Strategy

The 20 source file sample is selected with the following priority order. At each priority level, pick files until the 20-file budget is exhausted:

1. **Entry points** (up to 4 files): `index.*`, `main.*`, `app.*`, `server.*`, `cli.*` at the project root or one level deep in `src/`.
2. **Configuration and setup** (up to 3 files): Files in root or `config/` that define application behavior (`config.*`, `settings.*`, `constants.*`, `env.*`).
3. **Core modules** (up to 5 files): First file in each top-level `src/` subdirectory (e.g., `src/auth/index.ts`, `src/billing/service.py`). Identifies module boundary patterns.
4. **Utility and shared code** (up to 3 files): Files in `utils/`, `lib/`, `shared/`, `common/`, `helpers/` directories.
5. **Models and types** (up to 3 files): Files in `models/`, `types/`, `entities/`, `schemas/` directories, or files named `types.*`, `models.*`.
6. **Tests** (up to 2 files): One unit test and one integration test if distinguishable. Prefer tests that correspond to sampled source files.

If any priority level yields fewer files than its budget, the remaining slots roll forward to the next level. Files are selected by directory breadth first (cover more directories) rather than depth first (many files from one directory).

---

## Report Format

The report is written to `.agent/reports/learn-{project-name}-report.md` where `{project-name}` is the directory name of the target project (sanitized to lowercase kebab-case).

```markdown
---
project: {project-name}
path: {absolute path to project}
date: {ISO 8601 timestamp}
file_count: {total files enumerated, up to 500}
line_count: {estimated total lines from sampled files, or "not measured" if quick mode}
stack: [{detected languages and frameworks, comma-separated}]
sampled_files: {number of source files read}
scan_mode: {full | quick}
---

# Learn Report: {project-name}

## Overview

{1-3 paragraphs. Project purpose and scope derived from README analysis. If no README,
derived from directory structure and package manifests. Includes: what the project does,
primary language/framework, approximate maturity (based on commit count, file count,
dependency count).}

## Architecture

### Directory Structure

{Indented tree showing top 3 levels of the project directory. Annotated with the role
of each major directory (e.g., "src/ -- application source", "tests/ -- test suite").}

### Module Boundaries

{How the project divides functionality. Options observed:
- Feature-based: src/auth/, src/billing/, src/users/
- Layer-based: src/controllers/, src/services/, src/models/
- Hybrid: src/features/ + src/shared/
- Flat: all source in root or single directory

Note which pattern is used and how consistently it is applied.}

### Dependency Flow

{Observable import patterns. Do modules import from each other freely, or is there a
clear dependency direction (e.g., controllers -> services -> models)? Are there barrel
files (index.ts re-exports)? Is dependency injection used?}

## Code Patterns

### Naming Conventions

{Variable/function naming: camelCase, snake_case, PascalCase for classes.
File naming: kebab-case, camelCase, snake_case.
Consistency level: strict (all files follow), mixed (most follow), inconsistent.}

### Error Handling

{How errors are handled: try/catch with custom error classes, Result types, error codes,
unhandled. Is there a central error handler? Are errors logged consistently?}

### Logging

{Logging library used (if detectable). Log levels observed. Structured vs unstructured.
Consistency across sampled files.}

### Type Usage

{TypeScript strict mode, JSDoc annotations, Python type hints, Go interfaces, Rust
traits. Coverage: full, partial, none.}

### Import Organization

{Grouped imports (external, internal, relative)? Sorted? Barrel imports vs direct?
Path aliases (e.g., @/components)?}

## Testing Strategy

### Framework

{Detected test framework (Jest, Vitest, pytest, cargo test, go test, etc.) and how
it is configured.}

### Organization

{Test co-location (*.test.ts next to source) vs separate test directory (tests/).
Test file naming convention. Test subdirectory structure.}

### Patterns

{Describe/it blocks vs test functions. Fixture patterns (factories, builders, mocks).
Setup/teardown usage. Snapshot testing. Integration vs unit test separation.}

### Coverage

{Coverage tool configured? Coverage thresholds set? CI enforcement?}

## DevOps & Configuration

### Build System

{Build tool (webpack, vite, esbuild, tsc, cargo, go build, Make, etc.).
Build scripts in package.json or Makefile. Output directory.}

### CI/CD

{CI platform (GitHub Actions, GitLab CI, Jenkins, CircleCI, etc.).
Pipeline stages observed (lint, test, build, deploy). Trigger conditions.
Artifact handling.}

### Deployment

{Deployment method if detectable (Dockerfile, serverless config, platform config).
Environment configuration (.env files, config per environment).}

### Environment Management

{How environment variables are handled: .env files, config objects, environment-specific
files (.env.development, .env.production). Secrets management approach if visible.}

## Documentation

### README Quality

{Comprehensive (setup + usage + architecture + contributing) vs minimal (title +
description) vs absent. Badges, diagrams, examples present?}

### Inline Documentation

{JSDoc/docstrings on public APIs? Comment density in sampled files. Code
self-documenting via naming vs heavily commented.}

### API Documentation

{OpenAPI/Swagger spec present? Generated docs? Separate docs directory?}

## Strengths

{Bulleted list of 3-7 things the project does particularly well. Each item is specific
and references the section it was identified in. Examples:
- Clean module boundaries with feature-based directory structure (see Architecture)
- Consistent error handling with custom error classes (see Code Patterns)
- High test coverage with co-located test files (see Testing Strategy)}

## Adoptable Patterns

{Numbered list of specific, actionable patterns that could be applied to the current
project. Each entry follows the Adoptable Pattern Schema defined below.}

1. **{pattern name}**
   - Category: {architecture | code | testing | tooling | conventions}
   - Description: {What the pattern is and why it is valuable}
   - Source files: {Files in the target project that demonstrate this pattern}
   - Effort: {low | medium | high}
   - Confidence: {high | medium | low}

2. ...
```

---

## Adoptable Pattern Schema

Each pattern extracted from the report is structured as follows:

```yaml
- id: 1
  category: architecture
  name: Module-per-feature directory structure
  description: Source organized by feature (src/auth/, src/billing/) not by type (src/controllers/, src/models/). Each feature directory contains its own routes, services, and models.
  source_files: [src/auth/index.ts, src/billing/index.ts, src/users/index.ts]
  effort: low
  confidence: high
```

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | integer | Sequential number within the report. Starts at 1. |
| `category` | enum | One of: `architecture`, `code`, `testing`, `tooling`, `conventions` |
| `name` | string | Short descriptive name (under 60 characters) |
| `description` | string | What the pattern is, how it works, and why it is valuable. 1-3 sentences. |
| `source_files` | list[string] | Paths in the target project that demonstrate this pattern. Relative to project root. |
| `effort` | enum | `low` (config change or file move), `medium` (restructure existing code), `high` (significant rewrite or new infrastructure) |
| `confidence` | enum | `high` (clearly intentional -- consistent across files, documented, or configured), `medium` (likely intentional -- observed in most sampled files), `low` (might be incidental -- observed in few files or inconsistently applied) |

### Categories

| Category | Scope | Examples |
|----------|-------|---------|
| `architecture` | Project structure, module boundaries, dependency flow | Feature-based directories, barrel files, layered architecture |
| `code` | Source code patterns within files | Naming conventions, error handling, import organization, type usage |
| `testing` | Test organization and patterns | Co-located tests, fixture factories, snapshot testing, coverage thresholds |
| `tooling` | Build tools, CI/CD, linting, formatting | CI pipeline structure, linting config, build script patterns |
| `conventions` | Team/process conventions | Commit message format, branch naming, PR templates, changelog format |

---

## Pattern Extraction Rules

The scanner identifies patterns using the following heuristics per category. All analysis is structural (file existence, file content inspection, naming observation) -- no code execution, no AST parsing, no behavioral analysis.

### Architecture

| Signal | Method | Pattern Identified |
|--------|--------|--------------------|
| Directory depth and naming | Glob top 3 levels, count directories | Flat vs nested structure |
| Subdirectory naming consistency | Glob `src/*/`, check if names are features (auth, billing) or layers (controllers, services) | Feature-based vs layer-based organization |
| Barrel files | Glob `**/index.{ts,js,py}`, check if they re-export | Module boundary enforcement |
| Shared code location | Glob for `shared/`, `common/`, `lib/`, `utils/` at top level | Shared code extraction pattern |
| Monorepo signals | Glob for `packages/*/package.json`, `apps/*/`, `lerna.json`, `pnpm-workspace.yaml` | Monorepo structure |

### Code

| Signal | Method | Pattern Identified |
|--------|--------|--------------------|
| Variable/function names | Read sampled files, observe casing | camelCase, snake_case, PascalCase conventions |
| File naming | Glob source files, observe casing and separators | kebab-case, camelCase, snake_case file naming |
| Error handling | Read sampled files, search for `try`, `catch`, `throw`, `Result`, `Error` class definitions | Error handling strategy (custom classes, Result types, raw throws) |
| Import grouping | Read sampled files, observe import block structure | Grouped imports (external/internal/relative), sorted imports |
| Type annotations | Read sampled files, check for type hints (Python), interfaces (TS), generics | Type coverage level |
| Logging | Grep for `console.log`, `logger.`, `logging.`, `log.` in sampled files | Logging library and consistency |

### Testing

| Signal | Method | Pattern Identified |
|--------|--------|--------------------|
| Test file location | Glob `**/*.test.*`, `**/*.spec.*`, `tests/**`, `test/**` | Co-located vs separate test directory |
| Test file naming | Observe suffixes: `.test.ts` vs `.spec.ts` vs `test_*.py` | Naming convention |
| Test structure | Read test samples, check for `describe`/`it` vs `test()` vs `def test_` | Test framework idioms |
| Fixtures | Grep for `factory`, `fixture`, `mock`, `stub`, `faker` in test files | Fixture/factory patterns |
| Coverage config | Read `jest.config.*` or `pyproject.toml` for coverage thresholds | Coverage enforcement |
| Test/source ratio | Count test files vs source files via Glob | Testing investment level |

### Tooling

| Signal | Method | Pattern Identified |
|--------|--------|--------------------|
| CI/CD structure | Read workflow files, identify stages | Pipeline stages (lint, test, build, deploy) |
| Build scripts | Read `package.json` scripts, `Makefile` targets | Build automation patterns |
| Linting config | Read `.eslintrc.*`, `eslint.config.*`, `ruff.toml`, `.golangci.yml` | Linting rules and strictness |
| Formatting config | Read `.prettierrc`, `rustfmt.toml`, `pyproject.toml [tool.black]` | Code formatting approach |
| Pre-commit hooks | Read `.husky/`, `.pre-commit-config.yaml`, `lefthook.yml` | Git hook automation |

### Conventions

| Signal | Method | Pattern Identified |
|--------|--------|--------------------|
| Commit messages | Bash `git log --oneline -20`, observe format | Conventional commits, scope prefixes, ticket references |
| Branch naming | Bash `git branch -r --list` (if available), observe naming | feature/, bugfix/, hotfix/ prefixes |
| PR templates | Glob `.github/pull_request_template.md`, `.github/PULL_REQUEST_TEMPLATE/` | PR template usage |
| Changelog | Glob `CHANGELOG.md`, `CHANGES.md`, `HISTORY.md` | Changelog maintenance pattern |
| Contributing guide | Glob `CONTRIBUTING.md` | Contribution process documentation |

---

## Plan Generation

When the user selects patterns to adopt, learn generates an adoption plan.

### Plan Structure

The plan is written to `.agent/reports/learn-{project-name}-plan.md`:

```markdown
---
source_report: learn-{project-name}-report.md
created: {ISO 8601 timestamp}
patterns_selected: {count}
total_steps: {count}
---

# Adoption Plan: {project-name}

Patterns selected from learn report dated {date}.

## Pattern 1: {pattern name}

**Category:** {category}
**Effort:** {effort}
**Source:** {source files in target project}

### Steps

1. {Concrete action: create file, modify config, restructure directory, install dependency}
2. {Next action}
3. ...

### Dependencies

- {Any packages to install, tools to configure, or prerequisite patterns}

### Files to Create/Modify

- `{path}` -- {what to do with this file}
- ...

---

## Pattern 2: {pattern name}

...
```

### Generation Rules

For each selected pattern, the plan generator produces:

1. **Steps**: Ordered list of concrete actions. Each step is a single operation (create a file, edit a config, run a command). Steps reference specific file paths in the current project.
2. **Dependencies**: Packages to install, tools to configure, or other patterns that should be adopted first.
3. **Files to create/modify**: Explicit list of paths in the current project that will be affected. Uses the current project's directory structure as context.

### Pipeline Task Creation

After generating the plan, learn asks: "Create pipeline tasks for each pattern? [yes/no]"

If yes, for each pattern in the plan:

1. Create a task file at `.agent/tasks/{TASK-ID}.md` following the standard task format.
2. Set `stage: planning`, `status: in_progress`, `assignee: planner`.
3. Include the pattern description and plan steps in the task's `## Description` section.
4. Add `source: learn-{project-name}` to tags.
5. Link to the adoption plan in the task body.

Task IDs continue from the highest existing ID in `.agent/tasks/`.

---

## Command Interface

### `/learn` Command Definition

```yaml
---
description: Analyze an external project to extract adoptable patterns and generate a structured report
disable-model-invocation: true
argument-hint: <project_path> [--report | --quick]
---
```

```markdown
# Learn From Project

Analyze an external project at the specified path. Extract architecture, code patterns,
testing strategy, tooling, and conventions. Generate a report and present adoptable patterns.

## Arguments

Parse `$ARGUMENTS` for:
- `project_path` (required): Absolute or relative path to the target project directory.
- `--report` (optional): Generate report only. Skip pattern selection and plan generation.
- `--quick` (optional): Quick scan. Structure and config only, no source file sampling.

## Modes

### Default: Full analysis + interactive selection
`/learn /path/to/project`
Run the complete scan, generate the report, present adoptable patterns, and optionally
create an adoption plan and pipeline tasks.

### Report only
`/learn /path/to/project --report`
Run the complete scan and generate the report. Do not present the interactive pattern
selection flow. The user can review the report at their own pace.

### Quick scan
`/learn /path/to/project --quick`
Scan directory structure and config files only. Do not sample source files. The report
will have Architecture, DevOps & Configuration, and partial Tooling sections. Code Patterns
and Testing Strategy sections will note "source sampling skipped (quick mode)".
```

---

## Interactive Flow

### Step 1: Validate project path

```
Read $ARGUMENTS to extract project_path.
Verify the path exists and is a directory.
If the path does not exist:
  "Path not found: {project_path}"
  STOP.
If the path is a file, not a directory:
  "Expected a directory, got a file: {project_path}"
  STOP.
If .agent/ does not exist in the CURRENT project:
  "No .agent/ directory found. Run /task-init first."
  STOP.
```

### Step 2: Run scan

Display progress as each phase completes:

```
Analyzing project at {project_path}...

  Scanning structure...        {file_count} files found
  Reading configs...           {config_count} config files read
  Sampling source files...     {sample_count} files sampled
  Analyzing test structure...  {test_count} test files found
  Reading CI/CD config...      {ci_found ? "found" : "none"}
  Checking git history...      {commit_count} recent commits

Scan complete. Generating report...
```

If `--quick` mode, skip "Sampling source files" and "Analyzing test structure" phases.

### Step 3: Generate and save report

Write the report to `.agent/reports/learn-{project-name}-report.md`.

Display a summary (not the full report):

```
Report saved: .agent/reports/learn-{project-name}-report.md

Summary:
  Project:       {project-name}
  Stack:         {languages and frameworks}
  Architecture:  {one-line description, e.g., "Feature-based modules in src/"}
  Testing:       {framework + organization, e.g., "Jest with co-located test files"}
  CI/CD:         {platform or "none detected"}
  Strengths:     {count} identified
  Patterns:      {count} adoptable patterns extracted
```

If `--report` mode, STOP here.

### Step 4: Present adoptable patterns

Display the patterns as a numbered checklist grouped by category:

```
Adoptable patterns from {project-name}:

ARCHITECTURE:
  [ ] 1. Module-per-feature directory structure          effort: low   confidence: high
  [ ] 2. Barrel file module boundaries                   effort: low   confidence: high

CODE:
  [ ] 3. Strict TypeScript with no-any rule              effort: medium  confidence: high
  [ ] 4. Custom error class hierarchy                    effort: medium  confidence: medium

TESTING:
  [ ] 5. Co-located test files (*.test.ts)               effort: low   confidence: high
  [ ] 6. Factory-based test fixtures                     effort: medium  confidence: medium

TOOLING:
  [ ] 7. Multi-stage CI pipeline (lint -> test -> build)  effort: medium  confidence: high

CONVENTIONS:
  [ ] 8. Conventional commits with scope                  effort: low   confidence: high

Select patterns to adopt (numbers, ranges like 1-3, or 'all'):
```

### Step 5: User selects patterns

Accept the user's selection. Parse numbers, ranges (e.g., `1-3`), or `all`.

Confirm the selection:

```
Selected 5 patterns: 1, 2, 5, 7, 8

Proceed with these? [yes / adjust]
```

### Step 6: Choose output mode

```
What should I do with the selected patterns?

  1. Create adoption plan only (.agent/reports/learn-{project-name}-plan.md)
  2. Create adoption plan + pipeline tasks (/task create for each pattern)

Choice [1/2]:
```

### Step 7: Generate plan and optionally create tasks

Generate the adoption plan (see Plan Generation section).

If the user chose option 2, create pipeline tasks for each selected pattern.

### Step 8: Write to knowledge base

Append selected patterns to `.agent/knowledge/patterns.md` with source attribution:

```markdown
## Patterns from {project-name}

> Source: {project_path}
> Learned: {date}

### {pattern name}
- **Category:** {category}
- **Description:** {description}
- **Adopted from:** {source files}
- **Effort:** {effort}
```

If `.agent/knowledge/patterns.md` does not exist, create it with a header:

```markdown
# Project Patterns

Patterns adopted from external projects and identified during development.

---
```

### Step 9: Summary

```
Learn complete.

  Report:    .agent/reports/learn-{project-name}-report.md
  Plan:      .agent/reports/learn-{project-name}-plan.md
  Patterns:  {count} written to .agent/knowledge/patterns.md
  Tasks:     {count} created (TASK-{first} through TASK-{last})

Review the report:  Read .agent/reports/learn-{project-name}-report.md
Check tasks:        /task status
```

---

## Integration Points

### init-skills

Tooling patterns extracted by learn (CI/CD structure, linting config, build scripts, testing framework) map to technology recommendations in init-skills. Specifically:

- If learn detects a testing framework in the target project that the current project does not use, this surfaces as a tooling pattern. Running `/init-skills` after learn will detect the same technology if the user has adopted it, and offer the corresponding skill.
- The adoption plan may include steps like "install ESLint with this config," which directly creates the config files that init-skills' detection table looks for.
- Learn does not call init-skills directly. The connection is through the files written to the current project as part of plan execution.

### init-roles

Team structure observations from learn can inform role configurations:

- If learn detects CODEOWNERS, commit author patterns, or directory ownership conventions in the target project, these appear as `conventions` category patterns.
- The user can reference these observations when running `/init-roles` to decide on role configurations (e.g., "the target project has separate frontend and backend owners, so I should add `coder-frontend` and `coder-backend` variants").
- Learn does not call init-roles directly. The connection is advisory -- patterns in the report inform the user's choices.

### Knowledge Base

Selected patterns are appended to `.agent/knowledge/patterns.md` with full source attribution (project name, path, date, original source files). This file is read by agents with `knowledge: [patterns]` in their frontmatter (per the team-pipeline design, this includes the researcher and any role with patterns in its knowledge list).

### Pipeline

Adoption plans can create pipeline tasks that enter the normal task lifecycle:

- Tasks are created at `stage: planning` with `assignee: planner`.
- The planner agent reads the task description (which includes the pattern and adoption steps) and produces a design document.
- From there, the task follows the standard pipeline: planning -> implementing -> reviewing -> fixing -> completed -> researching.
- The researcher agent, upon completing an adopted-pattern task, may update `.agent/knowledge/patterns.md` with implementation notes, closing the loop.

---

## SKILL.md Specification

```yaml
---
name: learn
description: Analyze an external project to extract adoptable patterns, generate a structured report, and create adoption plans
disable-model-invocation: true
argument-hint: "<project_path> [--report | --quick]"
---
```

```markdown
# Learn From Project

Perform read-only analysis of an external project. Generate a structured report and
present adoptable patterns for the current project.

## Prerequisites

- `.agent/` directory must exist in the current project. If not, tell the user to run
  `/task-init` first and STOP.

## Arguments

Parse `$ARGUMENTS`:
- First argument: `project_path` (required). Path to the target project directory.
- `--report`: Report-only mode. Skip interactive selection.
- `--quick`: Quick mode. Structure and config only, no source sampling.

## Steps

### 1. Validate Path

Verify `project_path` exists and is a directory. If not, report the error and STOP.
Verify `.agent/` exists in the current project. If not, tell the user to run
`/task-init` and STOP.

### 2. Enumerate Files

Glob the target project to build a file inventory. Apply exclusions:
- Skip: `node_modules/`, `.git/`, `vendor/`, `dist/`, `build/`, `__pycache__/`,
  `target/`, `.next/`, `.nuxt/`
- Skip binary files (images, compiled assets, archives)
- Cap at 500 files total

Count files and record the top-level directory structure (3 levels deep).

### 3. Read Config Files

Read root-level config files that exist:
- `package.json`, `tsconfig.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`
- `.eslintrc.*`, `eslint.config.*`, `.prettierrc`, `prettier.config.*`
- `Makefile`, `Dockerfile`, `docker-compose.yml`, `compose.yml`
- `.github/workflows/*.yml`, `.gitlab-ci.yml`
- `README.md`

### 4. Sample Source Files (skip if --quick)

Select up to 20 source files using this priority:
1. Entry points (4): `index.*`, `main.*`, `app.*`, `server.*`, `cli.*`
2. Config/setup (3): `config.*`, `settings.*`, `constants.*`
3. Core modules (5): First file in each top-level src/ subdirectory
4. Utilities (3): Files in `utils/`, `lib/`, `shared/`, `common/`
5. Models/types (3): Files in `models/`, `types/`, `entities/`, `schemas/`
6. Tests (2): One unit test, one integration test

Skip files > 500 lines. Read each selected file.

### 5. Analyze Test Structure (skip if --quick)

Glob for test files: `**/*.test.*`, `**/*.spec.*`, `**/test_*`, `tests/**`, `test/**`.
Read 3-5 test file samples.

### 6. Check Git History

Run: `git -C {project_path} log --oneline -20` (Bash, read-only).
If this fails (not a git repo), note "no git history" and continue.

### 7. Generate Report

Analyze all collected data. Write the report to:
`.agent/reports/learn-{project-name}-report.md`

The project name is the target directory's basename, sanitized to lowercase kebab-case.

Report sections: Overview, Architecture, Code Patterns, Testing Strategy,
DevOps & Configuration, Documentation, Strengths, Adoptable Patterns.

If --quick mode, note "source sampling skipped" in Code Patterns and Testing Strategy.

### 8. Display Summary

Show: project name, stack, architecture summary, testing summary, CI/CD status,
strength count, pattern count. Show the path to the saved report.

If --report mode, STOP here.

### 9. Present Patterns

Display adoptable patterns as a numbered checklist grouped by category:
architecture, code, testing, tooling, conventions.

Each item shows: number, name, effort, confidence.

Ask: "Select patterns to adopt (numbers, ranges, or 'all'):"

### 10. User Selection

Parse the user's input. Confirm the selection. Allow adjustment.

### 11. Choose Output Mode

Ask: "Create adoption plan only, or also create pipeline tasks? [plan/tasks]"

### 12. Generate Plan

For each selected pattern, write to
`.agent/reports/learn-{project-name}-plan.md`:
- Pattern name, category, effort
- Concrete steps to adopt the pattern in the current project
- Files to create or modify
- Dependencies to install

### 13. Create Tasks (if selected)

For each pattern in the plan:
- Determine next TASK-ID (scan `.agent/tasks/` for highest number).
- Create `.agent/tasks/{TASK-ID}.md` with:
  - stage: planning, status: in_progress, assignee: planner
  - Description includes pattern details and adoption steps
  - Tags include: learn-{project-name}, {category}
- Append to Log: `[{timestamp}] learn: Created from learn analysis of {project-name}`

### 14. Update Knowledge Base

Append selected patterns to `.agent/knowledge/patterns.md`:
- Source attribution: project name, path, date
- Pattern details: name, category, description, source files, effort

Create the file with a header if it does not exist.

### 15. Summary

Display:
- Report path
- Plan path (if generated)
- Number of patterns written to knowledge base
- Number of tasks created (if any)
- Suggest: "Review the report" and "/task status"

## Rules

- NEVER modify any file in the target project. This is read-only analysis.
- NEVER execute code in the target project (no npm install, no build, no test runs).
- The only Bash command allowed on the target project is `git log` and `git branch`.
- All output files are written to the CURRENT project's `.agent/` directory, not the target.
- If the scan encounters more than 500 files after exclusions, stop enumerating and note
  the cap in the report.
- If a sampled file exceeds 500 lines, skip it and pick the next candidate.
- Sanitize the project name for filenames: lowercase, replace spaces and special
  characters with hyphens.
```
