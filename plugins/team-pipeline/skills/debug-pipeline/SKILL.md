---
name: debug-pipeline
description: Pipeline diagnostics — reads pipeline state files and produces a health report with actionable recommendations
context: inline
allowed-tools: [Read, Glob, Grep]
disable-model-invocation: true
---

# Debug Pipeline

Read pipeline state files and produce a structured health report with actionable recommendations.

## Steps

### 1. Verify Pipeline Exists

Check that `.agent/` directory exists. If not, report:
"No pipeline found. Run /task-init first."
STOP.

### 2. Read Pipeline State Files

Read these files (skip any that do not exist):
- `.agent/config.md` — pipeline configuration
- `.agent/lead-state.md` — lead agent state (active tasks, current agent, queue)
- `.agent/metrics.md` — pipeline metrics
- All files in `.agent/tasks/TASK-*.md` — task inventory (Glob for `TASK-*.md`)
- `.agent/adventures/ADV-*/manifest.md` — adventure manifests (Glob)
- All files in `.agent/roles/*.md` — installed roles

### 3. Analyze Configuration

Check for issues:
- [ ] `pipeline_version` is set
- [ ] `build_command` and `test_command` are set and non-empty
- [ ] `stage_assignments` covers implementing, reviewing, fixing stages
- [ ] `active_roles` matches files in `.agent/roles/`
- [ ] `installed_skills` is populated (init-skills has been run)
- [ ] `skills_initialized` timestamp exists

### 4. Analyze Tasks

For each task file, check:
- [ ] Tasks in `status: in_progress` for more than 24 hours (stale — compare timestamps if available)
- [ ] Tasks in `stage: fixing` with `iterations` >= `max_iterations` from config (stuck in fix loop)
- [ ] Tasks with `assignee` that does not match any active role
- [ ] Tasks in implementing/reviewing/fixing stages with empty `files` field
- [ ] Tasks with `depends_on` referencing non-existent task IDs
- [ ] Tasks with invalid stage/status combinations (e.g., `stage: completed, status: in_progress`)

### 5. Analyze Lead State

If `.agent/lead-state.md` exists:
- [ ] `active_agents` entries reference tasks that exist and are in `status: in_progress`
- [ ] No orphaned agent references (agent listed but no matching in-progress task)

### 6. Analyze Adventures

For each adventure manifest:
- [ ] Adventure `state` is consistent with its tasks (e.g., not `active` if all tasks completed)
- [ ] `tasks` list matches task files that exist
- [ ] No circular dependencies in `depends_on` chains

### 7. Compute Metrics

Calculate from task data:
- Total tasks by stage
- Average iterations per completed task
- Pass rate (tasks that passed review on first attempt, i.e., iterations == 0)
- Most active files (file paths appearing in most task `files` lists)

### 8. Produce Diagnostics Report

Output the following report:

```
---DEBUG-PIPELINE-START---
# Pipeline Diagnostics Report
Generated: {timestamp}

## Health Status: HEALTHY | WARNINGS | CRITICAL
(CRITICAL if any critical-severity issues; WARNINGS if any warning issues; HEALTHY otherwise)

## Configuration
| Check | Status | Detail |
|-------|--------|--------|
| Pipeline version | ok/warn | {version} |
| Build command | ok/warn | {command or "not set"} |
| Test command | ok/warn | {command or "not set"} |
| Stage assignments | ok/warn | {coverage} |
| Roles installed | ok/warn | {count} roles |
| Skills initialized | ok/warn | {timestamp or "not run"} |

## Task Health
| Check | Status | Detail |
|-------|--------|--------|
| Stale tasks | ok/warn/crit | {list of IDs or "none"} |
| Stuck fix loops | ok/warn/crit | {list of IDs or "none"} |
| Invalid assignees | ok/warn | {list or "none"} |
| Missing file targets | ok/warn | {list or "none"} |
| Broken dependencies | ok/warn | {list or "none"} |
| Invalid state combos | ok/warn | {list or "none"} |

## Lead State
| Check | Status | Detail |
|-------|--------|--------|
| Active agents valid | ok/warn | {detail or "no lead-state.md"} |
| Orphaned references | ok/warn | {list or "none"} |

## Pipeline Metrics
| Metric | Value |
|--------|-------|
| Total tasks | {n} |
| Completed | {n} ({pct}%) |
| In progress | {n} |
| Planning | {n} |
| Implementing | {n} |
| Reviewing | {n} |
| Fixing | {n} |
| Avg iterations | {n} |
| First-pass rate | {pct}% |

## Issues Found
| # | Severity | Category | Description | Recommended Action |
|---|----------|----------|-------------|-------------------|
| 1 | critical/warning/info | config/task/lead/adventure | ... | ... |

## Recommendations
1. {Most important action}
2. {Next action}
---DEBUG-PIPELINE-END---
```

**Severity rules**:
- **critical**: stale in-progress tasks, stuck fix loops, broken dependency chains
- **warning**: missing build/test commands, empty file targets, invalid assignees
- **info**: skills not initialized, pipeline_version at default

### 9. Follow-Up Options

Present:
- "Fix configuration issues automatically?" — sets defaults for missing build/test commands from config
- "Create tasks for identified issues?" — creates TASK-XXX files for each actionable finding
- "Save report to `.agent/reports/debug-pipeline-{date}.md`?"

Wait for user choice.
