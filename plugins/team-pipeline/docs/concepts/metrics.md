# Agent Metrics

Passive performance tracking data maintained by the lead agent. Records every agent invocation with cost, duration, and outcome data.

## File

`.agent/metrics.md` - YAML frontmatter with totals, markdown table with per-agent log entries.

## Data Points

Per agent: timestamp, task, role, model, stage, turns, tokens in/out, duration, result.

## Usage

The lead reads metrics when making proposals. Observations are judgment-based, not threshold-based: cost warnings, efficiency anomalies, load balancing suggestions, budget tracking.

## See Also

- [Lead Role](lead.md)
- [Communication Layer Design](../designs/communication-layer-design.md)
