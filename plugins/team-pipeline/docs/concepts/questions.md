# Question Store

Structured communication channel between agents and users. When an agent needs input it cannot resolve autonomously, it writes a structured question with options to the question store.

## Three Files

- **pending.md**: Questions waiting for user answers. Agents write here, messenger reads.
- **ready.md**: Answered questions awaiting agent pickup. Messenger writes, agents read.
- **archive.md**: Processed questions. Append-only history.

## Lifecycle

Agent writes question -> pending.md -> user answers -> ready.md -> agent reads -> archive.md

## Question Format

Each question has: unique ID (Q-NNN), task reference, role, context, question text, options A-D, default, and timeout.

## Status: blocked_on_question

When an agent writes a question, it sets task status to `blocked_on_question` and stops. The lead detects this and proposes presenting questions via the messenger.

## See Also

- [Messenger Role](messenger.md)
- [Communication Layer Design](../designs/communication-layer-design.md)
