# Team Pipeline Plugin

Stage-based task processing pipeline with planner, implementer, reviewer, and researcher agents.

## Structure

```
team-pipeline/
├── agents/                 # Agent definitions (11+ agents)
│   ├── adventure-planner.md
│   ├── adventure-preparer.md
│   ├── implementer.md
│   ├── planner.md
│   ├── researcher.md
│   └── reviewer.md
├── skills/                 # Slash command skills (12 skills)
│   ├── adventure-status/
│   ├── start-adventure/
│   ├── status/
│   ├── task-create/
│   ├── task-status/
│   ├── task-init/
│   ├── task-migrate/
│   ├── team-update/
│   └── ...
├── commands/               # CLI commands
├── hooks/                  # Hook configurations
├── roles/                  # Role templates for target projects
├── templates/              # Task and adventure templates
├── schema/                 # Agent schema definitions
├── dsl/                    # Visual schema language for pipeline definitions
├── docs/                   # Documentation
└── README.md
```

## Pipeline Stages

```
planning → implementing → reviewing → fixing → completed → researching
```

## Key Files

- `agents/*.md` — Agent prompts (planner=opus, implementer=sonnet, reviewer=sonnet, researcher=opus)
- `skills/*/skill.md` — Skill definitions invoked by slash commands
- `roles/*.md` — Role templates copied to target projects via `/task-init`
- `schema/agent-schema.md` — Schema for agent definitions

## Working Directory

Always verify the current working directory is a project root (not system directories like C:\WINDOWS\system32) before performing any file or pipeline operations. If not in a project directory, alert the user immediately.

## Task Pipeline Commands

Valid task commands are: `/task-status`, `/task-create`, `/adventure-status`, `/start-adventure`. Never suggest or attempt commands that don't exist (e.g., `/task`, `claude plugins update`). When a skill/command fails with 'Unknown skill', check .claude/settings.json and the skills directory before retrying.

## Agent Orchestration

### Subagent Limitations

Subagents (Task tool) cannot access MCP tools or external drives (e.g., O:\ drive). When spawning subagents, verify they have access to required resources first. If a subagent fails due to tool auto-denial or access restrictions, immediately fall back to direct lead execution instead of retrying the subagent.

### Subagent Failure Protocol

1. Set focused, narrow prompts -- broad prompts cause timeouts
2. If an agent fails or times out once, retry with a more focused prompt
3. If it fails twice, execute the work directly as lead -- do not attempt a third subagent spawn
4. Never spawn agents that require access to directories outside the project root

### Subagent Fast-Fail

Before spawning any subagent for a task, verify all three conditions:
1. All required file paths are within the project root
2. No MCP tools are needed
3. The task scope is narrow enough to complete in under 5 minutes

If any check fails, execute the work directly instead of delegating.

## Approach Frictions

For any change that will touch 3 or more files, first present a numbered plan listing each file and what will change. Wait for user's 'go' before executing. For single-file changes, proceed directly.

## Plugin/Skill Discovery

When skills or plugins aren't recognized: (1) Check .claude/settings.json for correct paths and disable-model-invocation flags. (2) Check the plugin cache directory for skill files. (3) Verify skill .md files exist at the expected paths. Do NOT spend extended time diagnosing -- if not resolvable in 2 attempts, tell the user the specific config issue found.
