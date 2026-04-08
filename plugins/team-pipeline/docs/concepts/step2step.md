# Step-to-Step Pipeline

The step2step pipeline is a document-driven pipeline type for structured, iterative review of complex decisions where each step builds on the previous ones. It differs from the standard task pipeline in both purpose and lifecycle: rather than processing discrete development tasks, step2step walks through a chain of interdependent design or decision steps, analyzing each for strengths, weaknesses, and alternatives, tracking the downstream impact of any change, and producing a validated adventure as its output.

## Problem

The standard task pipeline (planning -> implementing -> reviewing -> fixing -> completed -> researching) processes individual tasks in isolation. It is well-suited for feature work, bug fixes, and bounded design tasks. It is not suited for reviewing a chain of interdependent decisions where changing one decision affects others downstream.

When an adventure produces a set of interconnected design decisions — such as agent roles, data structures, lifecycle rules, and command interfaces — those decisions do not exist in isolation. Revisiting any one of them requires understanding which others depend on it, whether the change creates contradictions, and whether the overall system remains coherent. The standard task pipeline provides no mechanism for tracing these cross-step impacts or for validating chain coherence before committing to implementation.

## Concept

A step2step pipeline instance begins with a **theme**: a statement of the decision chain to review (e.g., "revisit cascade tracking design from ADV-018"). From that theme, a planning subagent generates an ordered list of **steps** — macro-level decisions first, specifics later. Each step is analyzed individually for strengths, weaknesses, and suggested alternatives. After user decisions are recorded, a cascade tracker subagent identifies downstream impacts across steps. When all impacts are resolved, a proof reviewer subagent validates the full chain for individual correctness and global coherence. On pass, the lead creates a new adventure.

Key properties of the pipeline:

- **Theme-driven instantiation**: each instance is anchored to a specific review theme, not a feature or task
- **Top-down step ordering**: macro decisions appear first; specifics that depend on them appear later
- **Per-step analysis**: every step receives an explicit analysis with strengths, weaknesses, alternatives, and a recommendation
- **Cascade impact tracking**: changes to a step propagate to downstream steps with impact records and proposed fixes
- **Proof review gate**: the full chain is validated before an adventure is created
- **Document-only output**: all stages produce markdown artifacts; no code is executed within the pipeline

## Relationship to Current System

### Standard task pipeline

Step2step is a parallel pipeline type, not a replacement for the standard task pipeline. Tasks still use the 6-stage lifecycle (planning -> implementing -> reviewing -> fixing -> completed -> researching). Step2step addresses review and adjustment of existing decisions that span multiple tasks or adventures.

### Adventures

Step2step produces an adventure as its final output. The `adventure_created` stage calls `/start-adventure` with the validated step results as input. Step2step is a pipeline that feeds into the adventure system, not a replacement for it.

### Lead agent

The lead orchestrates step2step instances the same way it orchestrates the task pipeline: via skills and subagents. The SubagentStop hook is extended to recognize step2step agents (step-generator, step-analyzer, cascade-tracker, proof-reviewer) and handle their completion correctly. See [lead.md](lead.md).

### Hooks

Step2step transitions use the same hook system as the task pipeline. StageTransition hooks enforce user approval at key transitions. SubagentStop hooks log metrics for each step2step subagent. See [hooks.md](hooks.md).

### Schema

Step2step instances live under `.agent/step2step/` in the target project. This directory is created by `/task-init` and included in the `reinit` schema alongside `.agent/tasks/` and `.agent/adventures/`.

## Key Abstractions

### Pipeline Instance

A single run of the step2step pipeline, anchored to one theme. Created by the lead when the user runs `/step2step start`.

| Field | Description |
|-------|-------------|
| `id` | Instance identifier in `S2S-{NNN}` format (e.g., `S2S-001`) |
| `theme` | The review theme defined by the user |
| `stage` | Current pipeline stage |
| `created` | ISO 8601 timestamp |
| `updated` | ISO 8601 timestamp |
| `step_count` | Number of steps generated |
| `cascade_count` | Number of cascade records created |

Instance IDs are sequential within `.agent/step2step/`. The first instance is `S2S-001`.

### Stage Model

| Stage | Agent | Description | Entry Condition | Exit Condition |
|-------|-------|-------------|-----------------|----------------|
| `theme_defined` | lead | Lead creates the instance; user confirms or refines the theme | Instance created | User approves theme |
| `steps_generated` | planner (opus) | Subagent analyzes theme, generates ordered step list | Theme approved | Step list reviewed and approved by user |
| `step_analysis` | reviewer (sonnet) | Each step analyzed for strengths, weaknesses, alternatives, recommendation | Steps approved | User reviews and records decisions on all steps |
| `cascade_check` | planner (opus) | Cross-step impact analysis; downstream effects of user decisions traced | User approves step analyses | All cascade impacts documented and resolved |
| `proof_review` | reviewer (opus) | Full chain validated for individual correctness and global coherence | Cascade impacts resolved | Proof passes (-> `adventure_created`) or fails (-> `step_analysis`) |
| `adventure_created` | lead | Lead calls `/start-adventure` with validated results; instance closed | Proof passed | Adventure created |

### State Transitions

| From | To | Trigger | Notes |
|------|----|---------|-------|
| `theme_defined` | `steps_generated` | User approves theme and step list | User approval required |
| `steps_generated` | `step_analysis` | All step files created, automatic | No user gate; lead spawns analyzers |
| `step_analysis` | `cascade_check` | User approves or modifies step analyses | User approval required; changes are recorded in step frontmatter |
| `cascade_check` | `proof_review` | All cascade impacts resolved | Lead confirms all cascade records are marked resolved |
| `proof_review` | `adventure_created` | Proof review passes validation | Lead creates adventure and closes instance |
| `proof_review` | `step_analysis` | Proof review fails | Failure list from proof-reviewer specifies which steps need rework |

### Step

An individual step file under `steps/`. Each step represents one decision or design element within the theme.

Frontmatter fields:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Step identifier (e.g., `step-001`) |
| `title` | string | Short title for the decision |
| `status` | string | `pending`, `analyzed`, `decided`, `cascaded` |
| `depends_on` | list | IDs of steps this step depends on |
| `cascade_to` | list | IDs of steps that may be affected if this step changes |

Body sections: Description, Analysis (Strengths, Weaknesses, Alternatives, Recommendation), User Decision.

### Cascade Record

A file under `cascades/` documenting the downstream impact of a change to one step on another.

| Field | Description |
|-------|-------------|
| `id` | Cascade record identifier (e.g., `cascade-001`) |
| `source_step` | Step whose change triggered this cascade |
| `affected_step` | Step affected by the change |
| `severity` | `low`, `medium`, `high` |
| `description` | What changes in the affected step |
| `proposed_fix` | Specific change to restore consistency |
| `status` | `open`, `resolved` |

### Proof Review

A single file under `proof/proof-review.md`. Produced by the proof-reviewer subagent after all cascades are resolved.

Sections:
- **Individual Step Review**: verdict per step (pass/fail with notes)
- **Chain Coherence Review**: cross-step consistency check
- **Overall Verdict**: pass or fail
- **Failure List**: if failing, list of steps requiring rework (feeds back into `step_analysis`)

## Instance Directory Structure

```
.agent/step2step/S2S-{NNN}/
  manifest.md              # Pipeline instance manifest (theme, stage, metadata)
  log.md                   # Pipeline execution log (append-only)
  steps/
    step-001.md            # Step file (frontmatter + description + analysis + decision)
    step-002.md
    ...
  cascades/
    cascade-001.md         # Cascade impact record (source, affected, severity, proposed fix)
    ...
  proof/
    proof-review.md        # Final proof review (individual + chain coherence + verdict)
```

## Operational Rules

- **Cascade depth limit**: cascade tracking is limited to 5 levels of depth to prevent infinite loops. If a proposed fix to an affected step would itself cascade more than 5 steps deep, the cascade is flagged for manual resolution.
- **Failed proof review**: the pipeline returns to `step_analysis` (not `cascade_check`). The proof reviewer provides a specific list of steps requiring rework. Only those steps are re-analyzed.
- **Passed proof review**: the lead calls `/start-adventure` with a summary of the validated step chain as the adventure theme.
- **Step ordering**: steps are generated top-down. Macro-level decisions (architecture, roles, lifecycle) appear before specific decisions (file formats, command syntax, edge cases). A step should never depend on a step with a higher sequence number.
- **User approval gates**: two transitions require explicit user approval before the pipeline advances:
  1. `theme_defined` -> `steps_generated`: user reviews and approves the generated step list
  2. `step_analysis` -> `cascade_check`: user reviews all step analyses and records decisions
- **Step status lifecycle**: `pending` (created) -> `analyzed` (analyzer complete) -> `decided` (user records decision) -> `cascaded` (marked affected by a cascade record)

## Interaction Patterns

### Full Lifecycle Flow

```
User:   /step2step start "review cascade tracking design from ADV-018"

Lead:   Create instance S2S-001
        Spawn step-generator (planner/opus) with theme
        Wait for SubagentStop

Step-generator:
        Analyze theme
        Write steps/step-001.md through step-NNN.md
        Exit

Lead:   Present step list to user
        Wait for approval

User:   Approve step list (or request changes)

Lead:   Advance to step_analysis
        Spawn step-analyzer (reviewer/sonnet) for each step
        Wait for SubagentStop per step

Step-analyzer:
        For each step: write strengths, weaknesses, alternatives, recommendation
        Update step status to "analyzed"
        Exit

Lead:   Present analyses to user
        Wait for approval / decisions

User:   Review each step, record decisions
        Approve to advance

Lead:   Advance to cascade_check
        Spawn cascade-tracker (planner/opus) with all step decisions
        Wait for SubagentStop

Cascade-tracker:
        For each changed step: trace cascade_to links
        Write cascades/cascade-NNN.md for each impact
        Update affected step status to "cascaded"
        Exit

Lead:   Present cascade summary
        Confirm all cascades resolved

Lead:   Advance to proof_review
        Spawn proof-reviewer (reviewer/opus)
        Wait for SubagentStop

Proof-reviewer:
        Review each step individually
        Check chain coherence
        Write proof/proof-review.md
        Exit

Lead:   Read proof verdict
        On pass:  Advance to adventure_created
                  Call /start-adventure with step chain summary
        On fail:  Advance back to step_analysis
                  Present failure list to user
```

### Rework Loop

When proof review fails, only the steps listed in the failure list are re-analyzed. The cascade-tracker runs again after rework decisions are recorded, producing new cascade records as needed. The proof reviewer then re-validates the full chain.

## Open Questions

1. **Batch vs sequential step analysis**: should the step-analyzer process all steps in a single subagent pass, or spawn one subagent per step? Batching is faster but harder to interrupt; sequential allows user review between steps.

2. **User intervention during cascade resolution**: should the user be able to override a proposed cascade fix, or must they accept the tracker's proposal? Overrides would require a second cascade pass to validate the override's downstream effects.

3. **Pause and resume**: can a step2step instance be paused mid-pipeline (e.g., at `step_analysis`) and resumed in a later session? The `lead-state.md` file would need to track the active step2step instance alongside active task agents.

## Future Possibilities

- **Multi-theme composition**: run two step2step instances in parallel on related themes, then merge their outputs into a single adventure
- **Step2step templates**: pre-defined step orderings for common review patterns (e.g., "agent role review", "schema redesign", "command interface audit") to speed up step generation
- **Metrics integration**: track review cycle time per step, cascade frequency by step type, and proof pass rate across instances to surface systemic design patterns
- **Recursive step2step**: if a proof review failure exposes a problem large enough to warrant its own theme, automatically spawn a nested step2step instance rather than looping
