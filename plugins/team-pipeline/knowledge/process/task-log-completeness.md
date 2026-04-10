# Task Log Completeness: Implementer Entry Required

**Source**: ADV-022 review (T004 — marketplace sync)

## Rule

Each task must have at least one implementer log entry in its `## Log` section documenting:
- What was done
- When (timestamp)
- The resulting artifact state (files changed, tests passed, etc.)

## Rationale

ADV-022 T004 was marked `done` without an implementer log entry. The reviewer had to fall back to artifact inspection (file diffs, byte-for-byte comparison) to confirm completion. This adds review overhead and creates a traceability gap — future audits cannot determine what the implementer actually did vs. what the artifact state implies happened.

## Scope

- **Implementer entries**: Required. No exceptions.
- **Reviewer entries**: Optional but recommended for non-trivial decisions.
- **Researcher entries**: Optional.

## Applies To

- All tasks with `stage: completed`
- Especially tasks that skip the normal review stage (e.g., infrastructure sync, file copy tasks)
- Adventure tasks where the implementer is the last agent to touch the file

## Enforcement

The reviewer agent should flag tasks with no implementer log entry as a minor issue. The task may still pass review if artifact state confirms completion, but the missing entry must be noted in the review report.
