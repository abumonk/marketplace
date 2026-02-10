# Messenger Role

Question lifecycle manager. Presents agent questions to users, collects answers, manages timeouts and defaults. Channel-agnostic with terminal as primary channel.

## Operations

- **present**: Show pending questions, collect answers, move to ready
- **timeout**: Apply defaults to expired questions
- **status**: Report question store state

## Model

haiku - pure I/O, no reasoning needed.

## Triggered By

The lead agent invokes the messenger when it detects pending questions or blocked tasks. Users can also check directly via the lead.

## See Also

- [Question Store](questions.md)
- [Lead Role](lead.md)
- [Communication Layer Design](../designs/communication-layer-design.md)
