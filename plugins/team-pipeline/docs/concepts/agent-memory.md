# Agent Persistent Memory

## Problem

The pipeline's knowledge base (`.agent/knowledge/`) is shared and role-agnostic. All agents see the same patterns, issues, and decisions. Agents cannot accumulate role-specific institutional knowledge across sessions. A planner that remembers estimation accuracy, or a reviewer that tracks common defects, would improve over time — but currently this learning is lost between sessions.

## Concept

Each agent role gets a persistent memory directory at `.agent/agent-memory/<role>/`. The directory contains:
- `MEMORY.md` — Index file. First 200 lines loaded into agent context at start.
- Topic files — Created on demand (e.g., `build-errors.md`, `fix-patterns.md`). Loaded when relevant to the current task.

Memory is:
- **Project-scoped**: Lives in `.agent/`, version-controllable with git
- **Role-specific**: Each role has its own directory; no cross-role contamination
- **Self-curated**: Agents update their own memory at task end
- **Bounded**: 200-line loading cap prevents context bloat

## Relationship to Current System

- `.agent/knowledge/` (shared, researcher-maintained) — Global patterns, issues, decisions. Updated by researcher agent after each task. All agents read the same entries. Continues unchanged.
- `.agent/agent-memory/<role>/` (per-role, self-maintained) — Role-specific operational knowledge. Updated by the role itself at task end. Only that role reads its own memory.

These are complementary, not competing. The knowledge base captures what happened and what the team learned. Agent memory captures how each role should work based on its own experience.

## Key Abstractions

### MEMORY.md (Index File)

- Always loaded (first 200 lines) on agent start via lead injection
- Contains: key learnings, links to topic files, high-priority notes
- Agent keeps it concise and curated (not append-only)
- Lines after 200 are truncated — most important content must be first

### Topic Files

- Created on demand when a role accumulates enough knowledge about a specific topic
- Examples: `build-errors.md`, `estimation-accuracy.md`, `common-review-issues.md`
- Loaded selectively: agent reads a topic file only when the current task is relevant
- No size cap per file, but agent should prune stale entries
- MEMORY.md should reference existing topic files so the agent knows to check them

### Memory Lifecycle

```
1. Agent starts   → MEMORY.md injected into context (first 200 lines, by lead)
2. Agent works    → May read topic files if relevant to current task
3. Agent finishes → Updates MEMORY.md and/or topic files with new learnings
4. Over time      → Agent prunes outdated entries, promotes frequent patterns
```

## Interaction Patterns

### Lead → Agent (Memory Injection)

When spawning an agent, the lead reads `.agent/agent-memory/<role>/MEMORY.md` (first 200 lines) and includes it in the spawn prompt as a `# Persistent Agent Memory` section. If the file does not exist, the section includes a prompt to create it after the task.

### Agent → Memory (Self-Curation)

At task end, each agent evaluates whether anything from the current task is worth remembering. If so, it updates its memory files using Write/Edit tools before setting status to ready.

### Role-Specific Memory Topics

| Role | What to Save | Topic Files |
|------|-------------|-------------|
| lead | Pipeline throughput patterns, agent performance observations | — |
| planner | Estimation accuracy, scope creep patterns, co-change files | `estimation-accuracy.md`, `scope-patterns.md` |
| coder | Build errors + fixes, fix patterns, test failure patterns | `build-errors.md`, `fix-patterns.md`, `test-failures.md` |
| code-reviewer | Recurring defect categories, convention violations, hotspot files | `common-issues.md`, `convention-violations.md` |
| reviewer | Common review issues, test gaps, build command quirks | `common-issues.md` |
| researcher | Cross-task patterns, knowledge base quality observations | `cross-task-patterns.md`, `architecture-evolution.md` |

## Open Questions

1. Should agents be able to read other roles' memory? (Current design: no)
2. Should memory files have a max total size? (Current design: no hard cap, rely on agent curation)
3. Should the researcher agent also update role-specific memories? (Current design: no, only shared knowledge base)

## Future Possibilities

- MCP tools for memory management (`pipeline.memory_get`, `pipeline.memory_set`, etc.)
- Memory analytics (which memories are most referenced, staleness detection)
- Cross-role memory sharing for specific topics (e.g., "architecture decisions" visible to all)
- Auto-pruning based on reference count or age
