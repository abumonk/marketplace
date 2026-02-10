# Lead Role

The lead is an LLM-powered orchestration agent that replaces the deterministic controller hooks and stateless messenger hooks with a single intelligent agent.

## Core Principle

**Full authority, zero autonomy.** The lead can manage every aspect of the pipeline but never acts without user approval. It analyzes, recommends, and waits.

## Replaces

- **Controller**: Hook-based deterministic state machine for pipeline transitions
- **Messenger**: Hook-based stateless notification dispatcher

## Trigger Model

- **SubagentStop** (sonnet): Evaluates completed agent work, proposes next steps if attention-worthy
- **SessionStart** (sonnet): Recovers stale state, presents accumulated decisions
- **Stop** (haiku): Brief end-of-session pipeline summary
- **On-demand** (`/task lead`): Full pipeline analysis and recommendations

## Key Behaviors

- Silence by default: only surfaces proposals when something needs attention
- Contextual notifications: crafts messages based on actual context, not templates
- Pattern recognition: notices recurring issues (repeated failures, bottlenecks)
- Judgment-based decisions: proposes actions based on priority, impact, and dependencies

## State

Stored in `.agent/lead-state.md`. Combines orchestration state (active agents, queue) with analysis notes (patterns, proposals, session context).

## See Also

- [Lead Role Design](../designs/lead-role-design.md)
- [Roles System](roles.md)
