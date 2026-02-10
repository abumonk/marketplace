# Init-Skills Skill Design

**Date:** 2026-02-10
**Status:** DRAFT
**Depends on:** `docs/concepts/init-skills.md`, `docs/designs/roles-design.md`, `docs/designs/init-roles-design.md`

---

## Overview

`init-skills` is an interactive skill that scans a project's dependency manifests and configuration files to build a technology profile, maps detected technologies against a hardcoded known-skills registry and installed plugin inventories, presents categorized recommendations (MISSING, RECOMMENDED, OPTIONAL, AVAILABLE), and installs selected items by recording plugin skills in `.agent/config.md` or generating stub skill files in `.agent/skills/` for technologies with no matching skill. It complements `init-roles` -- roles declare which skills they need via the `skills` field, and `init-skills` ensures those skills are present and gaps are visible.

---

## Decisions

| Question | Decision | Rationale |
|----------|----------|-----------|
| Registry format | Local scan of installed plugins + hardcoded known-skills map. No remote API for v1. | Keeps init-skills offline and deterministic. The known-skills map is a static table in the SKILL.md instructions. Plugin scanning uses Glob on the plugin directory structure. A remote registry can be added later without breaking v1 installs. |
| Version management | Re-run `init-skills` to refresh. No auto-update. | Skills are static files. There is no versioning scheme for individual skills yet. Re-running init-skills re-scans, detects new technologies or newly installed plugins, and updates records. Simple and predictable. |
| Conflict detection | Warn if two skills in the same category are selected. User decides. | Two linting skills or two testing frameworks can coexist but usually indicate a misconfiguration. The skill surfaces the conflict as a warning with both options shown. The user picks one, both, or neither. No automatic resolution. |
| Custom skill creation | Offer stub creation for unmatched technologies. | The primary v1 value of init-skills is gap identification. When a technology is detected but no skill exists, offering a stub gives the user an immediate starting point. The stub contains frontmatter and placeholder instructions that the user fills in. |
| Analysis depth | File-level only (config files + dependency manifests). No AST parsing. | File existence checks and JSON/YAML key reads are fast, reliable, and language-agnostic. AST analysis would require language-specific parsers, increase complexity, and provide marginal benefit for skill matching. Dependency manifest parsing (reading `dependencies` keys from package.json) is sufficient to detect frameworks. |

---

## Tech Stack Detection

Detection uses two methods: **Glob check** (does the file exist?) and **file read + key check** (read the file, inspect specific fields). All Glob patterns are run from the project root.

### Detection Table

| File / Pattern | Technology | Detection Method | Details |
|----------------|-----------|-----------------|---------|
| `package.json` | Node.js | Glob check | Presence confirms Node.js project |
| `package.json` > `dependencies.react` | React | File read + key check | Check `dependencies` and `devDependencies` for `react` |
| `package.json` > `dependencies.vue` | Vue | File read + key check | Check `dependencies` and `devDependencies` for `vue` |
| `package.json` > `dependencies.@angular/core` | Angular | File read + key check | Check `dependencies` for `@angular/core` |
| `package.json` > `dependencies.express` | Express | File read + key check | Check `dependencies` for `express` |
| `package.json` > `dependencies.fastify` | Fastify | File read + key check | Check `dependencies` for `fastify` |
| `package.json` > `dependencies.next` | Next.js | File read + key check | Check `dependencies` for `next` |
| `tsconfig.json` | TypeScript | Glob check | Presence confirms TypeScript usage |
| `jest.config.*` or `package.json` > `jest` | Jest | Glob check + key check | Glob for `jest.config.{js,ts,mjs,cjs}`, or check `package.json` for `jest` key or `devDependencies.jest` |
| `vitest.config.*` | Vitest | Glob check | Glob for `vitest.config.{js,ts,mjs,cjs}` |
| `.eslintrc.*` or `eslint.config.*` | ESLint | Glob check | Glob for `.eslintrc.{js,json,yml,yaml,cjs}` or `eslint.config.{js,ts,mjs,cjs}` |
| `prettier.config.*` or `.prettierrc` or `.prettierrc.*` | Prettier | Glob check | Glob for `prettier.config.{js,cjs,mjs}` or `.prettierrc` or `.prettierrc.{json,yml,yaml,js,cjs}` |
| `requirements.txt` or `pyproject.toml` or `setup.py` or `setup.cfg` | Python | Glob check | Any one confirms Python project |
| `pytest.ini` or `conftest.py` or `pyproject.toml` > `[tool.pytest]` | pytest | Glob check + key check | Glob for `pytest.ini` or `conftest.py`; or read `pyproject.toml` for `[tool.pytest.ini_options]` |
| `Cargo.toml` | Rust | Glob check | Presence confirms Rust project |
| `go.mod` | Go | Glob check | Presence confirms Go project |
| `.github/workflows/*.yml` or `.github/workflows/*.yaml` | GitHub Actions | Glob check | Any YAML file in `.github/workflows/` |
| `.gitlab-ci.yml` | GitLab CI | Glob check | Presence confirms GitLab CI usage |
| `Dockerfile` or `docker-compose.yml` or `docker-compose.yaml` or `compose.yml` or `compose.yaml` | Docker | Glob check | Any one confirms Docker usage |
| `Makefile` | Make | Glob check | Presence confirms Make usage |
| `.env` or `.env.example` or `.env.local` | Environment configuration | Glob check | Any one confirms env-file usage |

### Detection Output

The scan produces a **tech profile** -- a flat list of detected technologies with their source file:

```
Detected technologies:
  Node.js          package.json
  React            package.json > dependencies.react
  TypeScript       tsconfig.json
  Jest             jest.config.ts
  ESLint           eslint.config.js
  Docker           Dockerfile
  GitHub Actions   .github/workflows/ci.yml
```

---

## Known Skills Map

This is the v1 hardcoded registry. It maps detected technologies to known skills and plugins. Many technologies have no matching skill -- this is expected. The map is embedded in the SKILL.md instructions and updated when new skills or plugins become available.

| Technology | Skill/Plugin | Source | Category |
|-----------|-------------|--------|----------|
| Node.js | (none available) | -- | runtime |
| React | (none available) | -- | frontend |
| Vue | (none available) | -- | frontend |
| Angular | (none available) | -- | frontend |
| Express | (none available) | -- | backend |
| Fastify | (none available) | -- | backend |
| Next.js | (none available) | -- | fullstack |
| TypeScript | (none available) | -- | language |
| Jest | test-driven-development | superpowers | testing |
| Vitest | test-driven-development | superpowers | testing |
| ESLint | (none available) | -- | linting |
| Prettier | (none available) | -- | formatting |
| Python | (none available) | -- | runtime |
| pytest | test-driven-development | superpowers | testing |
| Rust | (none available) | -- | runtime |
| Go | (none available) | -- | runtime |
| GitHub Actions | (none available) | -- | ci-cd |
| GitLab CI | (none available) | -- | ci-cd |
| Docker | (none available) | -- | infrastructure |
| Make | (none available) | -- | build |
| Environment configuration | (none available) | -- | configuration |

**Note:** The superpowers plugin's `test-driven-development` skill is the only currently available skill that maps to detected technologies. The `brainstorming`, `writing-plans`, and `executing-plans` skills from superpowers are workflow skills, not technology-specific, and are not part of the detection mapping. As new plugins are created or installed, entries in this map with `(none available)` can be replaced.

### Dynamic Plugin Scan

In addition to the hardcoded map, init-skills scans all installed plugins for skills by Globbing:

```
{plugin-root}/skills/*/SKILL.md
```

For each discovered skill, it reads the SKILL.md frontmatter `name` and `description` fields and checks if any match a detected technology by keyword. This allows newly installed plugins to surface without updating the hardcoded map. Matches from dynamic scan are flagged as lower confidence than hardcoded map matches and shown to the user for confirmation.

---

## Recommendation Scoring

Each item in the recommendation list receives one of four categories, evaluated in priority order:

| Category | Criteria | Priority | Display |
|----------|----------|----------|---------|
| MISSING | Skill is listed in a role's `skills` field but is not installed and has no matching plugin skill available | 1 (highest) | `[!]` prefix, shown first |
| RECOMMENDED | Technology detected AND a matching skill/plugin exists in the known-skills map or dynamic scan | 2 | `[x]` prefix, pre-selected |
| OPTIONAL | Technology detected but no matching skill exists. Stub creation offered. | 3 | `[ ]` prefix, not pre-selected |
| AVAILABLE | Installed plugin skill that is not referenced by any role and does not match any detected technology | 4 (lowest) | `[ ]` prefix, informational |

### Priority Resolution

When a skill appears in multiple categories, the highest-priority category wins:

- A skill referenced by a role AND matching a detected technology: **MISSING** (if not installed) or **RECOMMENDED** (if available).
- A detected technology with no skill match and no role reference: **OPTIONAL**.
- An installed skill with no role reference and no technology match: **AVAILABLE**.

---

## Interactive Flow

### Step-by-Step

1. **Check prerequisites**
   - Verify `.agent/` directory exists. If not, tell the user to run `/task-init` first and stop.
   - Read `.agent/config.md` for any existing `installed_skills` records.

2. **Scan project files**
   - Run all Glob checks from the detection table against the project root.
   - For files that require key inspection (package.json dependencies), read and parse the file.
   - Build the tech profile list.

3. **Display detected technologies**
   ```
   Detected technologies:
     Node.js          package.json
     React            package.json > dependencies.react
     TypeScript       tsconfig.json
     Jest             jest.config.ts
     ESLint           eslint.config.js
     Docker           Dockerfile
     GitHub Actions   .github/workflows/ci.yml
   ```
   Ask: "Is this correct? Any technologies to add or remove?"
   User may adjust before proceeding.

4. **Collect role skill requirements**
   - Read all `.agent/roles/*.md` files (if the directory exists).
   - Extract the `skills` field from each role's frontmatter.
   - Build a map of `skill-name -> [role-names]` (which roles reference which skills).

5. **Scan installed plugins**
   - Glob for `skills/*/SKILL.md` in each installed plugin directory.
   - Read each SKILL.md frontmatter for `name` and `description`.
   - Build an available-skills inventory.

6. **Match and categorize**
   - For each role-required skill: check if it exists in the available-skills inventory. If not, mark as MISSING.
   - For each detected technology: look up the known-skills map. If a matching skill exists and is available, mark as RECOMMENDED. If no match, mark as OPTIONAL.
   - For each available skill not referenced by any role and not matching any technology, mark as AVAILABLE.

7. **Display recommendations**
   ```
   Skill recommendations for this project:

   MISSING (referenced by roles but not installed):
     [!] linting          referenced by: coder, code-reviewer
     [!] testing          referenced by: coder, qa-tester

   RECOMMENDED (matching skill available):
     [x] test-driven-development    Jest detected, from: superpowers
                                    (satisfies: testing)

   OPTIONAL (technology detected, no matching skill):
     [ ] react-patterns             React detected (stub available)
     [ ] typescript-patterns        TypeScript detected (stub available)
     [ ] eslint-config              ESLint detected (stub available)
     [ ] docker-patterns            Docker detected (stub available)
     [ ] github-actions-patterns    GitHub Actions detected (stub available)

   AVAILABLE (installed but not referenced):
     [ ] brainstorming              from: superpowers
     [ ] writing-plans              from: superpowers
     [ ] executing-plans            from: superpowers
   ```

8. **User selects/deselects**
   - MISSING items cannot be deselected (they are informational warnings that are resolved by installing a RECOMMENDED skill or creating a stub).
   - RECOMMENDED items are pre-selected but can be deselected.
   - OPTIONAL items are not pre-selected. Selecting one triggers stub creation.
   - AVAILABLE items are informational only.
   - Ask: "Select skills to install. RECOMMENDED items are pre-selected. Add any OPTIONAL stubs you want."

9. **Install selected items**
   - For each selected item, run the appropriate installation process (see next section).

10. **Resolve MISSING skills**
    - After installation, re-check all MISSING skills.
    - If a RECOMMENDED skill satisfies a MISSING skill name (e.g., `test-driven-development` satisfies the `testing` skill reference), record the mapping.
    - If a stub was created for a MISSING skill, record it.
    - Report any still-unresolved MISSING skills.

11. **Write installation records**
    - Update `.agent/config.md` with `installed_skills` and `skill_gaps` entries (see Installation Records section).

12. **Summary report**
    ```
    Init-skills complete.
      Installed: 1 plugin skill, 3 stubs
      Resolved:  testing (via test-driven-development from superpowers)
      Remaining gaps:
        linting - no matching skill found. Stub created: .agent/skills/linting/SKILL.md

    Run /init-skills again after installing new plugins to refresh.
    ```

---

## Installation Process

### Plugin Skill (exists in an installed plugin)

The skill already exists in the plugin's `skills/` directory. No files are copied or created. Installation means recording it in `.agent/config.md` so init-skills can track what was explicitly activated.

**Actions:**
1. Verify the skill's SKILL.md is readable at the plugin path.
2. Add an entry to `installed_skills` in `.agent/config.md`.
3. If the skill satisfies a role's `skills` field entry, record the `referenced_by` list.

### Marketplace Plugin (not yet installed)

The skill exists in a plugin that is not installed. init-skills cannot install plugins programmatically in v1.

**Actions:**
1. Display: "The skill `{name}` is available in the `{plugin}` plugin, which is not installed."
2. Display: "Install it with: `claude plugins install {plugin}` then re-run `/init-skills`."
3. Record in `skill_gaps` with `reason: plugin-not-installed`.

### Stub Creation (no matching skill exists)

A stub skill is a minimal SKILL.md file in `.agent/skills/{name}/` that the user can fill in with project-specific instructions. This is the primary mechanism for handling detected technologies that have no matching skill.

**Actions:**
1. Create directory: `.agent/skills/{name}/`
2. Create `.agent/skills/{name}/SKILL.md` from the stub template (below).
3. Add an entry to `installed_skills` in `.agent/config.md` with `source: project-stub`.

### Stub Template

```markdown
---
name: {name}
description: Skill for {technology} patterns and conventions in this project
---

# {Name}

> Auto-generated stub by init-skills. Fill in project-specific instructions below.

## Context

This project uses {technology} (detected from `{source_file}`).

## Instructions

<!-- Add instructions for how agents should work with {technology} in this project. -->
<!-- Examples: coding conventions, preferred patterns, common pitfalls, tool commands. -->

1. TODO: Describe key patterns and conventions
2. TODO: List common commands (build, test, lint)
3. TODO: Document project-specific configuration
```

**Template variables:**
- `{name}`: Lowercase kebab-case skill name (e.g., `react-patterns`)
- `{Name}`: Title case skill name (e.g., `React Patterns`)
- `{technology}`: Detected technology name (e.g., `React`)
- `{source_file}`: File that triggered detection (e.g., `package.json`)

---

## Installation Records

Init-skills writes two YAML frontmatter sections to `.agent/config.md`.

### Schema

```yaml
---
# ... existing fields (build_command, test_command, stage_assignments, etc.) ...

# === Skills Configuration ===
installed_skills:
  - name: test-driven-development
    source: superpowers
    installed: 2026-02-10
    referenced_by: [coder, qa-tester]
  - name: react-patterns
    source: project-stub
    installed: 2026-02-10
    referenced_by: []
  - name: linting
    source: project-stub
    installed: 2026-02-10
    referenced_by: [coder, code-reviewer]

skill_gaps:
  - name: typescript-patterns
    reason: no-matching-skill
    detected_technology: TypeScript
  - name: deployment-patterns
    reason: plugin-not-installed
    detected_technology: GitHub Actions
    suggested_plugin: null

skills_initialized: 2026-02-10T14:00:00Z
---
```

### Field Reference

| Field | Type | Description |
|-------|------|-------------|
| `installed_skills` | list[object] | Skills that have been activated or created |
| `installed_skills[].name` | string | Skill name (matches SKILL.md frontmatter `name`) |
| `installed_skills[].source` | string | Where the skill comes from: plugin name (e.g., `superpowers`) or `project-stub` |
| `installed_skills[].installed` | date | Date when init-skills recorded this entry |
| `installed_skills[].referenced_by` | list[string] | Role names that list this skill in their `skills` field |
| `skill_gaps` | list[object] | Technologies detected but not satisfiable by any available skill |
| `skill_gaps[].name` | string | Suggested skill name for the gap |
| `skill_gaps[].reason` | string | One of: `no-matching-skill`, `plugin-not-installed` |
| `skill_gaps[].detected_technology` | string | The technology that triggered this gap |
| `skill_gaps[].suggested_plugin` | string or null | Plugin name if known, null otherwise |
| `skills_initialized` | datetime | When init-skills was first run |

### Update Behavior

When init-skills is re-run:
- Existing `installed_skills` entries are preserved unless the skill is no longer detectable (plugin uninstalled, stub deleted). In that case, the entry is removed.
- New detections are appended.
- `skill_gaps` is rebuilt from scratch on each run.
- `skills_initialized` is not overwritten on subsequent runs.

---

## Role Integration

Init-skills reads role information to identify skills that roles expect but the project does not have.

### Process

1. **Read role instances**: Glob `.agent/roles/*.md`. For each file, parse YAML frontmatter and extract the `skills` list.

2. **Build requirements map**:
   ```
   testing  -> [implementer, coder, qa-tester]
   linting  -> [coder, code-reviewer]
   ```

3. **Check availability**: For each required skill name, check:
   - Does an `installed_skills` entry with this name exist in `.agent/config.md`?
   - Does any installed plugin have a skill whose `name` matches?
   - Does `.agent/skills/{name}/SKILL.md` exist?

   If none of these are true, the skill is MISSING.

4. **Skill name resolution**: A role may reference `testing` while the actual skill is named `test-driven-development`. Init-skills handles this by:
   - Checking for exact name match first.
   - Checking the known-skills map for category matches (e.g., `testing` category contains `test-driven-development`).
   - If a category match is found, the RECOMMENDED display notes: `(satisfies: testing)`.
   - After installation, the `installed_skills` entry for `test-driven-development` includes `referenced_by: [coder, qa-tester]` to record the association.

5. **Post-installation verification**: After all installations complete, re-read roles and re-check. Report:
   - Resolved: skills that were MISSING and are now installed or stubbed.
   - Remaining: skills that are still MISSING. These appear in `skill_gaps`.

### Role-less Projects

If `.agent/roles/` does not exist or contains no files, init-skills skips steps 1-2 and the MISSING category is empty. The skill still functions for technology detection and RECOMMENDED/OPTIONAL categorization.

---

## SKILL.md Specification

```yaml
---
name: init-skills
description: Analyze project tech stack and install relevant skills, plugins, and pattern stubs
disable-model-invocation: true
---
```

```markdown
# Initialize Skills

Analyze the project's technology stack and ensure all required skills are available.

## Prerequisites

- `.agent/` directory must exist. If it does not, tell the user to run `/task-init` first and stop.

## Steps

### 1. Scan Project Technologies

Run Glob checks and file reads against the project root to detect technologies.

**Glob checks** (existence = detection):
- `package.json` -> Node.js
- `tsconfig.json` -> TypeScript
- `jest.config.*` -> Jest
- `vitest.config.*` -> Vitest
- `.eslintrc.*` or `eslint.config.*` -> ESLint
- `prettier.config.*` or `.prettierrc` or `.prettierrc.*` -> Prettier
- `requirements.txt` or `pyproject.toml` or `setup.py` or `setup.cfg` -> Python
- `pytest.ini` or `conftest.py` -> pytest
- `Cargo.toml` -> Rust
- `go.mod` -> Go
- `.github/workflows/*.yml` or `.github/workflows/*.yaml` -> GitHub Actions
- `.gitlab-ci.yml` -> GitLab CI
- `Dockerfile` or `docker-compose.yml` or `docker-compose.yaml` or `compose.yml` or `compose.yaml` -> Docker
- `Makefile` -> Make
- `.env` or `.env.example` or `.env.local` -> Environment configuration

**File read checks** (if `package.json` exists):
- Read `package.json`. Check `dependencies` and `devDependencies` for:
  - `react` -> React
  - `vue` -> Vue
  - `@angular/core` -> Angular
  - `express` -> Express
  - `fastify` -> Fastify
  - `next` -> Next.js

**File read checks** (if `pyproject.toml` exists):
- Check for `[tool.pytest.ini_options]` -> pytest

**File read checks** (if `package.json` exists, additional):
- Check for top-level `jest` key or `devDependencies.jest` -> Jest

### 2. Display Detected Technologies

Show the user a table of detected technologies and source files.

Ask: "Is this correct? Any technologies to add or remove?"

Wait for confirmation before proceeding. If the user adds technologies manually, include them in the tech profile.

### 3. Collect Role Skill Requirements

If `.agent/roles/` exists and contains `.md` files:
- Read each file's YAML frontmatter.
- Extract the `skills` field (a list of strings).
- Build a map: `skill-name -> [role-names-that-reference-it]`.

If `.agent/roles/` does not exist or is empty, skip this step.

### 4. Scan Installed Plugins

Use Glob to find all `skills/*/SKILL.md` files in installed plugin directories.

For each found skill:
- Read the SKILL.md frontmatter `name` field.
- Add to the available-skills inventory.

### 5. Match and Categorize

Apply the known-skills map:

| Technology | Skill | Source | Category |
|-----------|-------|--------|----------|
| Jest | test-driven-development | superpowers | testing |
| Vitest | test-driven-development | superpowers | testing |
| pytest | test-driven-development | superpowers | testing |

All other technologies currently map to `(none available)`.

Categorize each item:
- **MISSING**: In a role's `skills` field AND not in available-skills inventory. Priority 1.
- **RECOMMENDED**: Detected technology with a matching available skill. Priority 2.
- **OPTIONAL**: Detected technology with no matching skill. Priority 3.
- **AVAILABLE**: Installed skill not referenced by any role and not matching any technology. Priority 4.

### 6. Display Recommendations

Show recommendations grouped by category in priority order: MISSING, RECOMMENDED, OPTIONAL, AVAILABLE.

Use this format:
```
MISSING (referenced by roles but not installed):
  [!] {skill-name}     referenced by: {role1}, {role2}

RECOMMENDED (matching skill available):
  [x] {skill-name}     {technology} detected, from: {plugin}

OPTIONAL (technology detected, no matching skill):
  [ ] {suggested-name}  {technology} detected (stub available)

AVAILABLE (installed but not referenced):
  [ ] {skill-name}     from: {plugin}
```

### 7. User Selection

Ask the user to confirm or adjust the selection:
- RECOMMENDED items are pre-selected.
- OPTIONAL items are deselected by default.
- AVAILABLE items are informational.
- MISSING items are warnings, not selectable.

Ask: "Select skills to install. Adjust the list and confirm."

### 8. Install Selected Items

For each selected item:

**If plugin skill (source is a plugin name):**
1. Verify the SKILL.md exists at the plugin path.
2. Record in `installed_skills` in `.agent/config.md`.
3. Note which roles it satisfies in `referenced_by`.

**If stub (source is `project-stub`):**
1. Create `.agent/skills/{name}/SKILL.md` with this template:

```markdown
---
name: {name}
description: Skill for {technology} patterns and conventions in this project
---

# {Name}

> Auto-generated stub by init-skills. Fill in project-specific instructions below.

## Context

This project uses {technology} (detected from `{source_file}`).

## Instructions

1. TODO: Describe key patterns and conventions
2. TODO: List common commands (build, test, lint)
3. TODO: Document project-specific configuration
```

2. Record in `installed_skills` in `.agent/config.md` with `source: project-stub`.

### 9. Update config.md

Read the existing `.agent/config.md` frontmatter. Add or update:

```yaml
installed_skills:
  - name: {skill-name}
    source: {plugin-name or project-stub}
    installed: {today's date}
    referenced_by: [{role-names}]

skill_gaps:
  - name: {suggested-skill-name}
    reason: {no-matching-skill or plugin-not-installed}
    detected_technology: {technology}

skills_initialized: {timestamp, only set on first run}
```

Preserve all existing frontmatter fields. Merge `installed_skills` with existing entries (update if name matches, append if new). Rebuild `skill_gaps` from scratch.

### 10. Summary Report

Display:
- Number of plugin skills installed.
- Number of stubs created.
- Resolved MISSING skills (was missing, now installed/stubbed).
- Remaining skill gaps.

Tell the user: "Run /init-skills again after installing new plugins to refresh."
```
