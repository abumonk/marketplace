---
schema_version: "0.1.0"

directories:
  - steps
  - cascades
  - proof

files:
  manifest.md:
    type: frontmatter
    required_fields:
      id: { type: string, format: "S2S-{NNN}" }
      theme: { type: string }
      stage:
        type: enum
        values: [theme_defined, steps_generated, step_analysis, cascade_check, proof_review, adventure_created]
        default: theme_defined
      created: { type: datetime }
      updated: { type: datetime }
      step_count: { type: number, default: 0 }
      cascade_count: { type: number, default: 0 }
      adventure_id: { type: string, default: null }
      proof_status:
        type: enum
        values: [passed, failed]
        default: null
    body_template: |
      # Step-to-Step: {theme}

      ## Theme Description

      {Describe the process, workflow, or plan being reviewed. What decisions does it involve?
      What is the expected outcome when all steps are resolved?}

  "steps/step-{NNN}.md":
    type: frontmatter
    template_pattern: true
    note: "{NNN} is a zero-padded sequential number (001, 002, ...) assigned at generation time."
    required_fields:
      id: { type: string, format: "step-{NNN}" }
      title: { type: string }
      status:
        type: enum
        values: [pending, analyzed, decided, cascaded]
        default: pending
      depends_on: { type: array, items: string, default: [] }
      cascade_to: { type: array, items: string, default: [] }
      cascade_ids: { type: array, items: string, default: [] }
      recommendation:
        type: enum
        values: [keep, modify, replace]
        default: null
      user_decision:
        type: enum
        values: [approved, modified, overridden]
        default: null
    body_template: |
      # Step {NNN}: {title}

      ## Description

      {What decision or action does this step represent? What is its role in the overall process?}

      ## Analysis

      ### Strengths

      - {strength 1}
      - {strength 2}

      ### Weaknesses

      - {weakness 1} — Impact: {impact}
      - {weakness 2} — Impact: {impact}

      ### Alternatives

      | Alternative | Pros | Cons | Effort |
      |-------------|------|------|--------|
      | {option 1}  | {pros} | {cons} | low/medium/high |
      | {option 2}  | {pros} | {cons} | low/medium/high |

      ### Recommendation

      **{keep / modify / replace}**

      {Reasoning for the recommendation. If modify or replace, describe proposed changes.}

      ## User Decision

      **Decision:** {approved / modified / overridden}

      {User's rationale or notes on the decision. Record any modifications made.}

  "cascades/cascade-{NNN}.md":
    type: frontmatter
    template_pattern: true
    note: "{NNN} is a zero-padded sequential number (001, 002, ...) assigned when the cascade is created."
    required_fields:
      id: { type: string, format: "cascade-{NNN}" }
      source_step: { type: string, note: "step ID that triggered this cascade" }
      source_change:
        type: enum
        values: [modify, replace]
      affected_steps: { type: array, items: string, note: "step IDs affected by this cascade" }
      status:
        type: enum
        values: [pending, resolved]
        default: pending
      created: { type: datetime }
    body_template: |
      # Cascade {NNN}: {source_step} -> {affected_steps}

      ## Description

      {What change to {source_step} triggered this cascade? What is the nature of the impact
      on the affected steps?}

      ## Impact per Affected Step

      ### {affected_step_id}

      **Severity:** high / medium / low

      **Impact:** {How does the source change affect this step?}

      **Proposed Fix:** {What change should be made to this step to resolve the cascade?}

      **Status:** pending / applied / rejected

      ## Resolution

      {When status is resolved: describe what was done to close this cascade. Which steps were
      updated and how? Were any new cascades triggered?}

  "proof/proof-review.md":
    type: frontmatter
    required_fields:
      status:
        type: enum
        values: [pending, passed, failed]
        default: pending
      reviewed: { type: datetime, default: null }
      steps_reviewed: { type: number, default: 0 }
      cascades_reviewed: { type: number, default: 0 }
      issues_found: { type: number, default: 0 }
      adventure_concept: { type: string, default: null, note: "draft concept text if proof passed" }
    body_template: |
      # Proof Review

      ## Individual Step Review

      | Step ID | Title | Status | Recommendation | User Decision | OK? |
      |---------|-------|--------|----------------|---------------|-----|
      | step-001 | {title} | decided | keep | approved | yes |

      ## Chain Coherence Review

      {Are the steps ordered correctly? Are dependencies (depends_on) consistent? Do any
      decided modifications create conflicts with other steps? Are all cascades accounted for?}

      ## Cascade Coverage Review

      | Cascade ID | Source | Affected | Status | OK? |
      |------------|--------|----------|--------|-----|
      | cascade-001 | step-001 | step-002 | resolved | yes |

      ## Overall Verdict

      **Status:** passed / failed

      {Summary of the review. If passed: describe why the chain is coherent and ready for
      adventure creation. If failed: list the blocking issues.}

      ## Failure List

      | # | Severity | Steps | Description | Resolution |
      |---|----------|-------|-------------|------------|
      | 1 | high | step-002, step-003 | {description} | {resolution} |

  log.md:
    type: template
    note: "Append-only. One row per event. Never edit existing rows."
    template: |
      # Step-to-Step Log

      | timestamp | event | actor | detail |
      |-----------|-------|-------|--------|
---

# Step-to-Step Schema

Schema definition for step-to-step pipeline instances under `.agent/step2step/{S2S-ID}/`.

Read by initialization tools to create or validate step2step instance directories.

## Instance Layout

Each instance is created at `.agent/step2step/{S2S-ID}/` where `S2S-ID` follows the format `S2S-001`, `S2S-002`, etc.

```
.agent/step2step/S2S-001/
├── manifest.md          # Instance state, stage, counts
├── log.md               # Append-only event log
├── steps/
│   ├── step-001.md      # One file per decision point
│   ├── step-002.md
│   └── ...
├── cascades/
│   ├── cascade-001.md   # One file per cascade event
│   └── ...
└── proof/
    └── proof-review.md  # Final coherence review before adventure creation
```

## File Types

- **frontmatter**: YAML frontmatter + markdown body. Fields are validated against `required_fields`.
- **template**: Plain markdown. Created once and appended to; never structurally modified.

## Template Patterns

Files whose keys contain `{NNN}` (e.g., `steps/step-{NNN}.md`) are **template patterns**. They are not created at initialization. Instead, they are instantiated on demand with a sequential zero-padded number (001, 002, ...) assigned at creation time. The schema defines the frontmatter shape and body template for each such file type.

## Stage Model

The `manifest.md` `stage` field tracks pipeline progress:

| Stage | Description |
|-------|-------------|
| `theme_defined` | Theme set; steps not yet generated |
| `steps_generated` | Steps files created; analysis not started |
| `step_analysis` | Agent analyzing each step |
| `cascade_check` | Cascades from decided steps being evaluated |
| `proof_review` | Proof reviewer validating the full chain |
| `adventure_created` | Proof passed; adventure has been created |

## Step Status Transitions

```
pending -> analyzed -> decided -> cascaded
```

- `pending`: Awaiting agent analysis
- `analyzed`: Agent analysis written; awaiting user decision
- `decided`: User has approved, modified, or overridden the recommendation
- `cascaded`: Step was updated due to a cascade from another step

## Cascade Status Transitions

```
pending -> resolved
```

A cascade moves to `resolved` when all affected steps have been updated and the impact entries marked `applied` or `rejected`.

## Proof Review

The `proof/proof-review.md` file is created once per instance when the stage reaches `proof_review`. It is filled in by the proof-reviewer agent and contains the final verdict. If `status: passed`, the `adventure_concept` field holds a draft concept for the adventure creation step.
