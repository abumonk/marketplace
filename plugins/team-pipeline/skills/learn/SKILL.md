---
name: learn
description: Analyze an external project to extract adoptable patterns, generate a structured report, and create adoption plans
disable-model-invocation: true
argument-hint: "<project_path> [--report | --quick]"
---

# Learn From Project

Perform read-only analysis of an external project. Generate a structured report and present adoptable patterns for the current project.

## Prerequisites

- `.agent/` directory must exist in the current project. If not, tell the user to run `/task-init` first and STOP.

## Arguments

Parse `$ARGUMENTS`:
- First argument: `project_path` (required). Path to the target project directory.
- `--report`: Report-only mode. Skip interactive selection.
- `--quick`: Quick mode. Structure and config only, no source sampling.

## Steps

### 1. Validate Path

Verify `project_path` exists and is a directory. If not, report the error and STOP.
Verify `.agent/` exists in the current project. If not, tell the user to run `/task-init` and STOP.

### 2. Enumerate Files

Glob the target project to build a file inventory. Apply exclusions:
- Skip: `node_modules/`, `.git/`, `vendor/`, `dist/`, `build/`, `__pycache__/`, `target/`, `.next/`, `.nuxt/`
- Skip binary files (images, compiled assets, archives)
- Cap at 500 files total

Count files and record the top-level directory structure (3 levels deep).

Display progress:
```
Analyzing project at {project_path}...

  Scanning structure...        {file_count} files found
```

### 3. Read Config Files

Read root-level config files that exist in the target project:
- `package.json`, `tsconfig.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`
- `.eslintrc.*`, `eslint.config.*`, `.prettierrc`, `prettier.config.*`
- `Makefile`, `Dockerfile`, `docker-compose.yml`, `compose.yml`
- `.github/workflows/*.yml`, `.gitlab-ci.yml`
- `README.md`

```
  Reading configs...           {config_count} config files read
```

### 4. Sample Source Files (skip if --quick)

Select up to 20 source files using this priority order. At each level, pick files until the 20-file budget is exhausted. Remaining slots roll forward to the next level.

1. **Entry points** (up to 4 files): `index.*`, `main.*`, `app.*`, `server.*`, `cli.*` at project root or one level deep in `src/`.
2. **Configuration and setup** (up to 3 files): Files in root or `config/` named `config.*`, `settings.*`, `constants.*`, `env.*`.
3. **Core modules** (up to 5 files): First file in each top-level `src/` subdirectory (e.g., `src/auth/index.ts`, `src/billing/service.py`). Cover directory breadth first.
4. **Utility and shared code** (up to 3 files): Files in `utils/`, `lib/`, `shared/`, `common/`, `helpers/` directories.
5. **Models and types** (up to 3 files): Files in `models/`, `types/`, `entities/`, `schemas/` directories, or files named `types.*`, `models.*`.
6. **Tests** (up to 2 files): One unit test and one integration test if distinguishable.

Skip files > 500 lines. Read each selected file.

```
  Sampling source files...     {sample_count} files sampled
```

### 5. Analyze Test Structure (skip if --quick)

Glob for test files: `**/*.test.*`, `**/*.spec.*`, `**/test_*`, `tests/**`, `test/**`.
Read 3-5 test file samples.

```
  Analyzing test structure...  {test_count} test files found
```

### 6. Check Git History

Run: `git -C {project_path} log --oneline -20` (Bash, read-only).
If this fails (not a git repo), note "no git history" and continue.

```
  Checking git history...      {commit_count} recent commits
```

### 7. Generate Report

Analyze all collected data. Write the report to:
`.agent/reports/learn-{project-name}-report.md`

The project name is the target directory's basename, sanitized to lowercase kebab-case (replace spaces and special characters with hyphens).

Report format:

```markdown
---
project: {project-name}
path: {absolute path to project}
date: {ISO 8601 timestamp}
file_count: {total files enumerated, up to 500}
stack: [{detected languages and frameworks}]
sampled_files: {number of source files read}
scan_mode: {full | quick}
---

# Learn Report: {project-name}

## Overview
{1-3 paragraphs. Project purpose and scope from README. Primary language/framework. Approximate maturity.}

## Architecture

### Directory Structure
{Indented tree showing top 3 levels. Annotated with role of each major directory.}

### Module Boundaries
{Feature-based vs layer-based vs hybrid vs flat. Consistency level.}

### Dependency Flow
{Import patterns. Dependency direction. Barrel files. Dependency injection.}

## Code Patterns

### Naming Conventions
{Variable/function naming. File naming. Consistency level.}

### Error Handling
{Strategy: custom classes, Result types, raw throws. Central handler.}

### Logging
{Library. Log levels. Structured vs unstructured. Consistency.}

### Type Usage
{TypeScript strict, JSDoc, Python hints, Go interfaces. Coverage level.}

### Import Organization
{Grouped imports. Sorted. Barrel imports. Path aliases.}

## Testing Strategy

### Framework
{Detected test framework and configuration.}

### Organization
{Co-located vs separate. Naming convention.}

### Patterns
{Describe/it vs test functions. Fixtures. Setup/teardown. Snapshots.}

### Coverage
{Coverage tool configured. Thresholds. CI enforcement.}

## DevOps & Configuration

### Build System
{Build tool. Scripts. Output directory.}

### CI/CD
{Platform. Stages. Triggers. Artifacts.}

### Deployment
{Deployment method if detectable. Environment configuration.}

### Environment Management
{.env files. Config per environment. Secrets management.}

## Documentation

### README Quality
{Comprehensive vs minimal vs absent. Badges, diagrams, examples.}

### Inline Documentation
{JSDoc/docstrings. Comment density. Self-documenting.}

### API Documentation
{OpenAPI/Swagger. Generated docs. Docs directory.}

## Strengths
{Bulleted list of 3-7 specific things the project does well, referencing sections.}

## Adoptable Patterns
{Numbered list. Each entry:}

1. **{pattern name}**
   - Category: {architecture | code | testing | tooling | conventions}
   - Description: {What the pattern is and why it is valuable}
   - Source files: {files that demonstrate this pattern}
   - Effort: {low | medium | high}
   - Confidence: {high | medium | low}
```

If --quick mode, note "source sampling skipped (quick mode)" in Code Patterns and Testing Strategy sections.

```
Scan complete. Generating report...
```

### 8. Display Summary

Show a summary (not the full report):

```
Report saved: .agent/reports/learn-{project-name}-report.md

Summary:
  Project:       {project-name}
  Stack:         {languages and frameworks}
  Architecture:  {one-line description}
  Testing:       {framework + organization}
  CI/CD:         {platform or "none detected"}
  Strengths:     {count} identified
  Patterns:      {count} adoptable patterns extracted
```

If --report mode, STOP here.

### 9. Present Patterns

Display the patterns as a numbered checklist grouped by category:

```
Adoptable patterns from {project-name}:

ARCHITECTURE:
  [ ] 1. {name}    effort: {effort}   confidence: {confidence}

CODE:
  [ ] 2. {name}    effort: {effort}   confidence: {confidence}

TESTING:
  [ ] 3. {name}    effort: {effort}   confidence: {confidence}

TOOLING:
  [ ] 4. {name}    effort: {effort}   confidence: {confidence}

CONVENTIONS:
  [ ] 5. {name}    effort: {effort}   confidence: {confidence}

Select patterns to adopt (numbers, ranges like 1-3, or 'all'):
```

### 10. User Selection

Parse the user's input. Accept numbers, ranges (e.g., `1-3`), comma-separated (e.g., `1,3,5`), or `all`.

Confirm the selection:
```
Selected {count} patterns: {list}

Proceed with these? [yes / adjust]
```

### 11. Choose Output Mode

```
What should I do with the selected patterns?

  1. Create adoption plan only (.agent/reports/learn-{project-name}-plan.md)
  2. Create adoption plan + pipeline tasks (/task create for each pattern)

Choice [1/2]:
```

### 12. Generate Plan

For each selected pattern, write to `.agent/reports/learn-{project-name}-plan.md`:

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

### Dependencies

- {Packages to install, tools to configure, prerequisite patterns}

### Files to Create/Modify

- `{path}` -- {what to do}
```

### 13. Create Tasks (if selected)

For each pattern in the plan:
- Determine next TASK-ID: scan `.agent/tasks/` for the highest existing `TASK-\d+` number and increment.
- Create `.agent/tasks/{TASK-ID}.md` with:
  ```yaml
  ---
  id: {TASK-ID}
  title: "Adopt pattern: {pattern name}"
  stage: planning
  status: in_progress
  created: {ISO 8601 timestamp}
  updated: {ISO 8601 timestamp}
  iterations: 0
  assignee: planner
  files: []
  depends_on: []
  tags: [learn-{project-name}, {category}]
  ---

  ## Description
  Adopt the "{pattern name}" pattern from {project-name}.

  {pattern description}

  ### Adoption Steps
  {steps from the plan}

  ### Source Reference
  See adoption plan: .agent/reports/learn-{project-name}-plan.md

  ## Acceptance Criteria
  - [ ] Pattern implemented following adoption plan steps
  - [ ] Existing functionality not broken
  - [ ] Tests pass

  ## Design
  <!-- Filled by planner agent -->

  ## Log
  - [{timestamp}] learn: Created from learn analysis of {project-name}
  ```

### 14. Update Knowledge Base

Append selected patterns to `.agent/knowledge/patterns.md`:

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

### 15. Summary

```
Learn complete.

  Report:    .agent/reports/learn-{project-name}-report.md
  Plan:      .agent/reports/learn-{project-name}-plan.md
  Patterns:  {count} written to .agent/knowledge/patterns.md
  Tasks:     {count} created (TASK-{first} through TASK-{last})

Review the report:  Read .agent/reports/learn-{project-name}-report.md
Check tasks:        /task status
```

## Rules

- NEVER modify any file in the target project. This is read-only analysis.
- NEVER execute code in the target project (no npm install, no build, no test runs).
- The only Bash commands allowed on the target project are `git log` and `git branch`.
- All output files are written to the CURRENT project's `.agent/` directory, not the target.
- If the scan encounters more than 500 files after exclusions, stop enumerating and note the cap in the report.
- If a sampled file exceeds 500 lines, skip it and pick the next candidate.
- Sanitize the project name for filenames: lowercase, replace spaces and special characters with hyphens.
