# Agent Memory System — Detailed Design

## Storage Structure

```
.agent/
  agent-memory/
    lead/
      MEMORY.md
    planner/
      MEMORY.md
      estimation-accuracy.md     (topic, created on demand)
      scope-patterns.md          (topic, created on demand)
    coder/
      MEMORY.md
      build-errors.md            (topic, created on demand)
      fix-patterns.md            (topic, created on demand)
      test-failures.md           (topic, created on demand)
    code-reviewer/
      MEMORY.md
      common-issues.md           (topic, created on demand)
      convention-violations.md   (topic, created on demand)
    reviewer/
      MEMORY.md
      common-issues.md           (topic, created on demand)
    researcher/
      MEMORY.md
      cross-task-patterns.md     (topic, created on demand)
      architecture-evolution.md  (topic, created on demand)
```

## Loading Rules

### Rule 1: MEMORY.md Injection (200-line cap)

- On every agent spawn, the lead reads `.agent/agent-memory/{role}/MEMORY.md`
- Only the first 200 lines are included (truncation boundary)
- Content is injected into the spawn prompt under a `# Persistent Agent Memory` heading
- If the file does not exist, the section is still included with instructions to create it

### Rule 2: Topic File Loading (on-demand)

- Agents may read topic files from their own memory directory during task execution
- Loading is triggered by the agent's own judgment (e.g., "this task involves build errors, let me check build-errors.md")
- Topic files are NOT auto-loaded; only MEMORY.md is auto-loaded
- MEMORY.md should reference topic files so the agent knows they exist

### Rule 3: Memory Writing (task-end curation)

- At the end of each task, agents evaluate whether new learnings are worth recording
- Agents use Write/Edit tools to update MEMORY.md and/or topic files
- Updates should be concise (1-2 sentences per entry)
- Agents should prune outdated or incorrect entries when updating

## Memory Curation Instructions Per Role

### Lead

What to save:
- Pipeline throughput patterns (which stages are bottlenecks)
- Agent performance observations (which models/roles work best for which task types)
- Common failure modes and their resolutions
- Estimation accuracy trends across adventures

What NOT to save:
- Individual task details (these are in task files)
- Metrics data (this is in metrics.md)

### Planner

What to save:
- Estimation accuracy (predicted vs actual duration/complexity for past tasks)
- Scope creep patterns (when designs needed expansion during implementation)
- Design patterns that worked well for specific task types
- Files that frequently need changes together (co-change patterns)

What NOT to save:
- Task-specific design details (these are in design documents)
- Architecture decisions (these go in shared knowledge base)

Topic files: `estimation-accuracy.md`, `scope-patterns.md`

### Coder

What to save:
- Build errors encountered and their fixes (especially environment-specific ones)
- Fix patterns (common code patterns that resolve recurring review issues)
- Test failure patterns and solutions
- Package-specific quirks (e.g., config overrides, tool incompatibilities)

What NOT to save:
- Code patterns (these go in shared `.agent/knowledge/patterns.md` via researcher)
- Task-specific implementation details

Topic files: `build-errors.md`, `fix-patterns.md`, `test-failures.md`

### Code-Reviewer

What to save:
- Common issues found across reviews (recurring defect categories)
- Convention violations that implementations frequently miss
- Files or packages that tend to have issues (hotspots)
- False positives to avoid (things that look wrong but are intentional)

What NOT to save:
- Individual review results (these are in review reports)
- Code style rules (these belong in `.agent/knowledge/conventions.md`)
- Observations from a single review — wait for a pattern across multiple reviews

Topic files: `common-issues.md`, `convention-violations.md`

### Reviewer (base)

What to save:
- Common issues found in reviews (test gaps, build quirks)
- Acceptance criteria patterns that are easily missed
- Build/test command quirks for this project

What NOT to save:
- Individual review details (these are in review reports)
- Information that duplicates shared knowledge base entries

Topic files: `common-issues.md`

### Researcher

What to save:
- Cross-task patterns that recur across multiple tasks
- Architecture evolution observations (how the codebase is changing over time)
- Knowledge base quality observations (gaps, duplicates, stale entries)
- Estimation variance data and suggested multipliers for future adventures

What NOT to save:
- Individual task findings (these go in shared `.agent/knowledge/`)
- Speculative patterns observed only in a single task

Topic files: `cross-task-patterns.md`, `architecture-evolution.md`

## Lead Agent Memory Injection

The lead constructs the spawn prompt as follows:

```
{role template instructions}

# Persistent Agent Memory

Your memory directory is at `.agent/agent-memory/{role}/`. Its contents persist across conversations.

As you work, consult your memory files to build on previous experience. When you encounter something worth remembering, update your memory before completing the task.

## MEMORY.md

{first 200 lines of .agent/agent-memory/{role}/MEMORY.md}

---

{task-specific prompt}
```

If `.agent/agent-memory/{role}/MEMORY.md` does not exist:

```
# Persistent Agent Memory

Your memory directory is at `.agent/agent-memory/{role}/`. Its contents persist across conversations.

No memory file found. After completing this task, create `.agent/agent-memory/{role}/MEMORY.md` with key learnings worth remembering for future tasks.
```

## MEMORY.md Template

Each MEMORY.md starts with a recommended structure:

```markdown
# {Role} Agent Memory

## Key Learnings
{Most important operational knowledge for this role}

## Topic Files
- `topic-file.md` - Brief description of contents

## Notes
{Temporary or recent observations not yet promoted to a topic file}
```

Lines after 200 will be truncated when loaded, so agents must keep the most important content in the first 200 lines.

## Schema Changes Required

Add to `schema/agent-schema.md` directories list:

```yaml
  - agent-memory
  - agent-memory/lead
  - agent-memory/planner
  - agent-memory/coder
  - agent-memory/code-reviewer
  - agent-memory/reviewer
  - agent-memory/researcher
```

Add MEMORY.md template files for each role in the `files:` section.

## Upgrade Path

Existing projects using team-pipeline will not have `agent-memory/` directories. The `reinit` skill handles this via deep-merge — it creates missing directories and files from the schema without overwriting existing content. No special migration needed.
