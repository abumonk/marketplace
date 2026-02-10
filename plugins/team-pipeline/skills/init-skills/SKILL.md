---
name: init-skills
description: Analyze project tech stack and install relevant skills, plugins, and pattern stubs
disable-model-invocation: true
---

# Initialize Skills

Analyze the project's technology stack and ensure all required skills are available.

## Prerequisites

- `.agent/` directory must exist. If it does not, tell the user to run `/task-init` first and STOP.

## Steps

### 1. Scan Project Technologies

Run Glob checks and file reads against the project root to detect technologies.

**Glob checks** (existence = detection):
- `package.json` -> Node.js
- `tsconfig.json` -> TypeScript
- `jest.config.*` (`jest.config.{js,ts,mjs,cjs}`) -> Jest
- `vitest.config.*` (`vitest.config.{js,ts,mjs,cjs}`) -> Vitest
- `.eslintrc.*` (`.eslintrc.{js,json,yml,yaml,cjs}`) or `eslint.config.*` (`eslint.config.{js,ts,mjs,cjs}`) -> ESLint
- `prettier.config.*` (`prettier.config.{js,cjs,mjs}`) or `.prettierrc` or `.prettierrc.*` (`.prettierrc.{json,yml,yaml,js,cjs}`) -> Prettier
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

Show the user a table of detected technologies and source files:

```
Detected technologies:
  {technology}    {source_file}
  ...
```

Ask: "Is this correct? Any technologies to add or remove?"

Wait for confirmation before proceeding. If the user adds technologies manually, include them in the tech profile.

### 3. Collect Role Skill Requirements

If `.agent/roles/` exists and contains `.md` files:
- Read each file's YAML frontmatter.
- Extract the `skills` field (a list of strings).
- Build a map: `skill-name -> [role-names-that-reference-it]`.

If `.agent/roles/` does not exist or is empty, skip this step (MISSING category will be empty).

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

Categorize each item by priority (highest wins when an item appears in multiple categories):

- **MISSING** (priority 1): Skill name is in a role's `skills` field AND not in available-skills inventory. These are warnings -- not selectable, resolved by installing RECOMMENDED skills or creating stubs.
- **RECOMMENDED** (priority 2): Detected technology has a matching available skill in the known-skills map or dynamic plugin scan. Pre-selected.
- **OPTIONAL** (priority 3): Detected technology with no matching skill available. Not pre-selected. Selecting triggers stub creation.
- **AVAILABLE** (priority 4): Installed plugin skill not referenced by any role and not matching any detected technology. Informational only.

**Skill name resolution:** A role may reference `testing` while the actual skill is `test-driven-development`. Check the known-skills map for category matches (e.g., `testing` category contains `test-driven-development`). If a match is found, note `(satisfies: testing)` in the display.

### 6. Display Recommendations

Show recommendations grouped by category in priority order:

```
Skill recommendations for this project:

MISSING (referenced by roles but not installed):
  [!] {skill-name}     referenced by: {role1}, {role2}

RECOMMENDED (matching skill available):
  [x] {skill-name}     {technology} detected, from: {plugin}
                        (satisfies: {role-skill-name})

OPTIONAL (technology detected, no matching skill):
  [ ] {suggested-name}  {technology} detected (stub available)

AVAILABLE (installed but not referenced):
  [ ] {skill-name}     from: {plugin}
```

### 7. User Selection

Ask the user to confirm or adjust the selection:
- RECOMMENDED items are pre-selected `[x]`.
- OPTIONAL items are deselected `[ ]` by default.
- AVAILABLE items are informational only.
- MISSING items are warnings `[!]`, not directly selectable.

Ask: "Select skills to install. Adjust the list and confirm."

Accept `+name` to select, `-name` to deselect.

### 8. Install Selected Items

For each selected item:

**If plugin skill (source is a plugin name):**
1. Verify the SKILL.md exists at the plugin path.
2. Record in `installed_skills` in `.agent/config.md`.
3. Note which roles it satisfies in `referenced_by`.

**If stub (source is `project-stub`):**
1. Create `.agent/skills/{name}/` directory.
2. Create `.agent/skills/{name}/SKILL.md` with this template:

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

Template variables:
- `{name}`: lowercase kebab-case skill name (e.g., `react-patterns`)
- `{Name}`: title case skill name (e.g., `React Patterns`)
- `{technology}`: detected technology name (e.g., `React`)
- `{source_file}`: file that triggered detection (e.g., `package.json`)

3. Record in `installed_skills` in `.agent/config.md` with `source: project-stub`.

### 9. Update config.md

Read the existing `.agent/config.md` frontmatter. Add or update these fields (preserve all existing fields):

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

skills_initialized: {ISO 8601 timestamp, only set on first run}
```

Merge `installed_skills` with existing entries: update if name matches, append if new. Rebuild `skill_gaps` from scratch on each run.

### 10. Summary Report

Display:
```
Init-skills complete.
  Installed: {n} plugin skill(s), {n} stub(s)
  Resolved:  {skill} (via {actual-skill} from {plugin})
  Remaining gaps:
    {skill} - no matching skill found. Stub created: .agent/skills/{name}/SKILL.md

Run /init-skills again after installing new plugins to refresh.
```
