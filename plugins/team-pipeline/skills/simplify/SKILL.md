---
name: simplify
description: Multi-perspective code review — spawns 3 parallel agents (reuse, quality, efficiency) and synthesizes findings into an action plan
context: fork
agent: reviewer
model: sonnet
allowed-tools: [Read, Glob, Grep]
disable-model-invocation: true
argument-hint: "<file_or_directory_path>"
---

# Simplify

Run a multi-perspective code review by spawning 3 parallel review agents and synthesizing their findings.

## Steps

### 1. Parse Arguments

`$ARGUMENTS` is the file or directory path to review. If empty, ask the user:
"What file or directory should I review? Provide a path."

### 2. Discover Target Files

- If `$ARGUMENTS` is a directory: use Glob to find all source files (`**/*.{ts,js,tsx,jsx,py,go,rs}`). Cap at 20 files.
- If `$ARGUMENTS` is a single file: use that file only.

Display the file list and count. Ask: "Review these {n} files? [yes / adjust]"

If more than 20 files, warn: "Found {n} files — capped at 20. Use a more specific path to review different files."

### 3. Spawn 3 Review Agents in Parallel

Use the Task tool to spawn three independent review subagents. Each receives the same file list but a different review lens.

**Agent 1 — Code Reuse Review:**
Prompt: "Review these files for code reuse opportunities. Identify duplicated logic, similar patterns that could be abstracted, shared utilities that could replace inline implementations, and opportunities to extract reusable modules. For each finding, specify: files involved, the duplicated pattern, and a suggested refactoring approach. Read each file first. Output findings as a numbered list with HIGH/MEDIUM/LOW priority."
Files: [provide the discovered file list]

**Agent 2 — Code Quality Review:**
Prompt: "Review these files for code quality issues. Check: naming consistency, function length (flag >30 lines), nesting depth (flag >3 levels), error handling completeness, type safety gaps, missing documentation for public APIs, and single-responsibility violations. For each finding, specify: file, line range, issue, and suggested improvement. Read each file first. Output findings as a numbered list with HIGH/MEDIUM/LOW priority."
Files: [provide the discovered file list]

**Agent 3 — Efficiency Review:**
Prompt: "Review these files for efficiency improvements. Identify: unnecessary iterations, O(n^2) patterns that could be O(n), redundant computations, excessive memory allocations, missing caching opportunities, and unnecessary async/await chains. For each finding, specify: file, the inefficient pattern, performance impact (LOW/MEDIUM/HIGH), and a suggested optimization. Read each file first. Output findings as a numbered list."
Files: [provide the discovered file list]

### 4. Collect Results

Wait for all 3 agents to complete. If any agent times out or fails, note it in the report and proceed with results from the remaining agents.

### 5. Deduplicate and Prioritize

Review all findings. Remove duplicates (same file + substantially same issue). Assign consolidated priority:
- **High**: Found by 2+ agents, or single-agent finding with HIGH impact affecting multiple files
- **Medium**: Single-agent finding affecting multiple files, or HIGH impact on one file
- **Low**: Single-agent finding affecting one file with LOW/MEDIUM impact

### 6. Produce Synthesis Report

Output the following report:

```
---SIMPLIFY-START---
# Simplify Report: {target}
Generated: {timestamp}

## Summary
| Agent | Findings | Unique After Dedup |
|-------|----------|--------------------|
| Code Reuse | {n} | {n} |
| Code Quality | {n} | {n} |
| Efficiency | {n} | {n} |
| **Total** | {n} | {n} |

## High Priority
| # | Category | File(s) | Finding | Suggested Action |
|---|----------|---------|---------|------------------|
| 1 | ... | ... | ... | ... |

## Medium Priority
| # | Category | File(s) | Finding | Suggested Action |
|---|----------|---------|---------|------------------|

## Low Priority
| # | Category | File(s) | Finding | Suggested Action |
|---|----------|---------|---------|------------------|

## Recommended Actions
1. {Top action} (estimated effort: low/medium/high)
2. {Next action} (estimated effort: ...)
---SIMPLIFY-END---
```

### 7. Ask for Next Step

Present options:
- "Create pipeline tasks for the recommended actions?" — creates TASK-XXX files following the task-create pattern
- "Apply quick fixes now?" — only for LOW risk, purely mechanical changes (rename, simple extract)
- "Save report to `.agent/reports/simplify-{date}.md` only"

Wait for user choice before proceeding.
