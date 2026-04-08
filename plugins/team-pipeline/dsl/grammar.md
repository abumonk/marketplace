# PDSL Grammar Specification

**Version:** 0.1.0
**Language:** Pipeline DSL (PDSL)

This document defines the formal grammar for PDSL in Parsing Expression Grammar (PEG) notation. PDSL is a text-based domain-specific language for describing the team-pipeline ecosystem: agent lifecycles, hierarchical structures, and entity-relationship mappings.

---

## 1. Notation Conventions

| Notation          | Meaning                                   |
|-------------------|-------------------------------------------|
| `<-`              | Rule definition (rule name produces...)   |
| `'text'`          | Literal terminal string                   |
| `A B`             | Sequence: A followed by B                 |
| `A / B`           | Ordered choice: try A first, then B       |
| `A*`              | Zero or more repetitions of A             |
| `A+`              | One or more repetitions of A             |
| `A?`              | Optional A (zero or one)                  |
| `!A`              | Negative lookahead: succeeds if A fails   |
| `&A`              | Positive lookahead: succeeds if A matches |
| `[a-z]`           | Character class                           |
| `.`               | Any single character                      |
| `( A )`           | Grouping                                  |

**Naming conventions:**
- Non-terminals: `PascalCase` (e.g., `LifecycleDecl`, `EntityField`)
- Terminal keywords: lowercase quoted literals (e.g., `'lifecycle'`, `'entity'`)
- Token aliases: `UPPER_CASE` (e.g., `EOF`)

PEG grammars are **deterministic** -- ordered choice (`/`) resolves all ambiguity without backtracking. Earlier alternatives are tried first and committed to on match.

---

## 2. Lexical Productions

### 2.1 Spacing and Comments

```peg
# Entry point for insignificant whitespace
Spacing       <- (Whitespace / LineComment / BlockComment)*

Whitespace    <- [ \t\n\r]+

# Single-line comment: // ... to end of line
LineComment   <- '//' (!'\n' .)* '\n'?

# Block comment: /* ... */
BlockComment  <- '/*' (!'*/' .)* '*/'
```

Comments are consumed as part of `Spacing` and are lexically invisible to the parser. They may appear anywhere spacing is permitted.

### 2.2 Identifiers and Keywords

```peg
# An identifier is any non-keyword word starting with a letter or underscore
Identifier    <- !Keyword [a-zA-Z_] IdentContinue* Spacing
IdentContinue <- [a-zA-Z0-9_-]

# All reserved keywords (negative-lookahead prevents keyword use as identifier)
Keyword       <- ( 'lifecycle'
                 / 'structure'
                 / 'entity'
                 / 'relation'
                 / 'input'
                 / 'execute'
                 / 'transitions'
                 / 'completion'
                 / 'contains'
                 / 'spawns'
                 / 'delegates'
                 / 'checkpoints'
                 / 'on'
                 / 'from'
                 / 'type'
                 / 'via'
                 / 'cardinality'
                 / 'constraint'
                 / 'values'
                 / 'role'
                 / 'model'
                 / 'trigger'
                 / 'state'
                 / 'id'
                 ) !IdentContinue
```

### 2.3 Literals

```peg
# Double-quoted string literal
StringLiteral  <- '"' (!'"' .)* '"' Spacing

# Unsigned integer literal
NumberLiteral  <- [0-9]+ Spacing

# Regex pattern literal enclosed in forward slashes
PatternLiteral <- '/' (!('/' / '\n') .)+ '/' Spacing
```

Pattern literals use `/` as delimiters. The body may not contain unescaped forward slashes or newlines. Use `\/` to include a literal slash within a pattern.

### 2.4 Operators and Punctuation

```peg
# Operators (ordered: longer tokens before shorter to prevent prefix ambiguity)
Arrow         <- '->' Spacing
DotDot        <- '..' Spacing
CompEq        <- '==' Spacing
CompNe        <- '!=' Spacing
CompLe        <- '<=' Spacing
CompGe        <- '>=' Spacing
CompLt        <- '<' Spacing
CompGt        <- '>' Spacing
LogicAnd      <- '&&' Spacing
LogicOr       <- '||' Spacing
Equals        <- '=' Spacing
Colon         <- ':' Spacing
Pipe          <- '|' Spacing
Question      <- '?' Spacing
Dot           <- '.' Spacing
Star          <- '*' Spacing

# Punctuation
LBrace        <- '{' Spacing
RBrace        <- '}' Spacing
LBracket      <- '[' Spacing
RBracket      <- ']' Spacing
LParen        <- '(' Spacing
RParen        <- ')' Spacing
Comma         <- ',' Spacing
```

---

## 3. Top-Level Grammar

```peg
Program      <- Spacing (TopLevelDecl Spacing)* EOF
TopLevelDecl <- LifecycleDecl
              / StructureDecl
              / EntityDecl
              / RelationDecl
EOF          <- !.
```

A PDSL source file is a sequence of zero or more top-level declarations separated by spacing. Declarations may appear in any order. Multiple declarations of the same name are allowed (the validator may reject duplicates as a semantic error, not a syntax error).

---

## 4. Lifecycle Productions

A lifecycle declaration describes how an agent role is spawned, what it reads and writes, how it transitions between pipeline stages, and what it emits on completion.

```peg
LifecycleDecl  <- 'lifecycle' Spacing Identifier LBrace
                    LifecycleBody
                  RBrace

LifecycleBody  <- (LifecycleField / LifecycleBlock)*

# Simple key-value fields inside a lifecycle block
LifecycleField <- 'role'    Colon Identifier
               / 'model'   Colon Identifier
               / 'trigger' Colon Expression
```

### 4.1 Action Blocks

Action blocks group a sequence of action steps. Three named blocks are defined; their internal syntax is identical.

```peg
LifecycleBlock <- InputBlock
               / ExecuteBlock
               / TransitionsBlock
               / CompletionBlock

InputBlock      <- 'input'      Spacing LBrace ActionStep*      RBrace
ExecuteBlock    <- 'execute'    Spacing LBrace ActionStep*      RBrace
CompletionBlock <- 'completion' Spacing LBrace ActionStep*      RBrace
TransitionsBlock <- 'transitions' Spacing LBrace TransitionRule* RBrace
```

### 4.2 Action Steps

An action step is a verb followed by one or more operands. The verb set is extensible; the six verbs below are predefined.

```peg
ActionStep  <- Verb Spacing Operand+ Spacing

# Predefined verbs (extensible -- new verbs may be added in future versions)
Verb        <- 'read'
             / 'write'
             / 'update'
             / 'explore'
             / 'emit'
             / 'log'

# Operands: ordered-choice resolves StringLiteral before PathExpr before FieldRef
Operand     <- StringLiteral
             / PathExpr
             / FieldRef
```

### 4.3 Path and Field Expressions

```peg
# File system paths (may contain interpolated fields in { })
PathExpr    <- PathSegment (PathSep PathSegment)* Spacing
PathSegment <- ('{' Identifier '}' / [a-zA-Z0-9_.*-])+
PathSep     <- '/'

# Dot-separated field references, optionally followed by an assignment arrow
FieldRef    <- Identifier (Dot Identifier)* (Spacing Arrow StringLiteral)? Spacing
```

### 4.4 Transition Rules

```peg
TransitionRule <- 'on' Spacing Identifier Arrow Identifier Spacing
```

Each transition rule maps an event name to a target stage name.

### 4.5 Trigger Expressions

Trigger expressions are Boolean conditions evaluated to decide when a lifecycle activates. The syntax is intentionally minimal; complex expressions are deferred to future versions.

```peg
Expression  <- Conjunction (LogicOr Conjunction)*
Conjunction <- Comparison (LogicAnd Comparison)*
Comparison  <- FieldRef CompOp (StringLiteral / Identifier)
             / LParen Expression RParen

CompOp      <- CompEq / CompNe / CompLe / CompGe / CompLt / CompGt
```

---

## 5. Structure Productions

A structure declaration describes containment, ownership, and delegation patterns for a named pipeline artifact type.

```peg
StructureDecl  <- 'structure' Spacing Identifier LBrace
                    StructureBody
                  RBrace

StructureBody  <- (StructureField / StructureBlock)*

# Simple key-value fields inside a structure block
StructureField <- 'id'    Colon IdPattern
               / 'state'  Colon EnumValues

# The id pattern uses a simplified interpolation syntax (not a regex)
IdPattern      <- [A-Z]+ '-' '{' [A-Z]+ '}'
               / StringLiteral
               / PatternLiteral
```

### 5.1 Structure Sub-Blocks

```peg
StructureBlock   <- ContainsBlock
                  / SpawnsBlock
                  / DelegatesBlock
                  / CheckpointsBlock

ContainsBlock    <- 'contains'    Spacing LBrace ContainmentEntry* RBrace
SpawnsBlock      <- 'spawns'      Spacing LBrace SpawnEntry*       RBrace
DelegatesBlock   <- 'delegates'   Spacing LBrace DelegationEntry*  RBrace
CheckpointsBlock <- 'checkpoints' Spacing LBrace CheckpointEntry*  RBrace
```

### 5.2 Containment, Spawns, Delegates, Checkpoints

```peg
# contains block: file path -> TypeRef[cardinality]
ContainmentEntry <- PathExpr Arrow TypeRef Cardinality? Spacing

# spawns block: TypeRef[cardinality] from source
SpawnEntry       <- TypeRef Cardinality Spacing 'from' Spacing Identifier Spacing

# delegates block: stage -> role
DelegationEntry  <- Identifier Arrow Identifier Spacing

# checkpoints block: fromState -> toState: "condition string"
CheckpointEntry  <- Identifier Arrow Identifier Colon StringLiteral Spacing
```

---

## 6. Entity and Relation Productions

### 6.1 Entity Declarations

An entity declaration enumerates the typed fields of a pipeline data type. Enum-only entities use the `values` keyword.

```peg
EntityDecl   <- 'entity' Spacing Identifier LBrace
                  EntityBody
                RBrace

EntityBody   <- (EntityField / ValuesField)*

ValuesField  <- 'values' Colon EnumValues Spacing
```

### 6.2 Entity Fields

Entity fields have a **fixed suffix order** to eliminate ambiguity:
`name : TypeExpr [PatternLiteral] [?] [= DefaultValue] [Cardinality]`

```peg
# The suffix order is enforced by the grammar: type, then pattern, then optional, then default, then cardinality
EntityField  <- Identifier Colon TypeExpr PatternLiteral? Question? DefaultValue? Cardinality? Spacing

# Type expression: inline enum (pipe-separated identifiers) or a named type reference
TypeExpr     <- EnumValues / TypeRef
TypeRef      <- Identifier

# Pipe-separated enum values (used for inline enum type and the values: field)
EnumValues   <- Identifier (Spacing Pipe Spacing Identifier)*

# Default value: = followed by a literal
DefaultValue <- Equals (StringLiteral / NumberLiteral / Identifier)

# Cardinality: [N], [N..M], [N..*]
Cardinality      <- LBracket CardinalitySpec RBracket
CardinalitySpec  <- NumberLiteral DotDot (Star / NumberLiteral)
                  / NumberLiteral
```

**Disambiguation note:** `EnumValues` is tried before `TypeRef` in `TypeExpr`. However, a bare `Identifier` matches `EnumValues` with zero pipe terms. This means `TypeRef` is subsumed by `EnumValues` for single-identifier types; the parser treats them equivalently and the semantic distinction (enum vs reference) is resolved by the validator.

### 6.3 Relation Declarations

```peg
RelationDecl <- 'relation' Spacing Identifier Arrow Identifier LBrace
                  RelationBody
                RBrace

RelationBody <- RelationField*

RelationField <- 'type'        Colon Identifier Spacing
              / 'via'          Colon ViaRef     Spacing
              / 'cardinality'  Colon CardinalityNotation Spacing
              / 'constraint'   Colon Identifier Spacing
              / 'lifecycle'    Colon Identifier Spacing

# via field may reference a simple field or an array field (field[])
ViaRef              <- Identifier LBracket RBracket
                     / Identifier

# Cardinality notation in relation fields uses the bare N..M form (no brackets)
CardinalityNotation <- NumberLiteral DotDot (Star / NumberLiteral)
                     / NumberLiteral
```

---

## 7. Worked Examples

The following four complete examples are drawn from the real team-pipeline domain. Each example can be traced through the grammar productions step by step.

### 7.1 Lifecycle Example: `PlanningCycle`

```pdsl
lifecycle PlanningCycle {
  role: planner
  model: opus
  trigger: task.status == "pending" && task.stage == "planning"

  input {
    read .agent/tasks/{task.id}.md
    read .agent/config.md
    read .agent/knowledge/*
  }

  execute {
    explore codebase
    write .agent/designs/{task.id}-design.md
    update task.files
    update task.status -> "ready"
  }

  transitions {
    on success -> implementing
    on blocked_on_question -> wait
    on error -> error
  }

  completion {
    emit task.planned
    log "{timestamp} planner: design complete"
  }
}
```

**Parse trace (abbreviated):**
- `'lifecycle'` keyword matches, then `Identifier` = `PlanningCycle`
- `LBrace` opens `LifecycleBody`
- `LifecycleField`: `'role' Colon Identifier` = `planner`
- `LifecycleField`: `'model' Colon Identifier` = `opus`
- `LifecycleField`: `'trigger' Colon Expression` -- `Expression` parses `Conjunction LogicAnd Conjunction`
  - Left: `FieldRef`=`task.status`, `CompOp`=`==`, `StringLiteral`=`"pending"`
  - Right: `FieldRef`=`task.stage`, `CompOp`=`==`, `StringLiteral`=`"planning"`
- `LifecycleBlock` -> `InputBlock` -> `ActionStep*`: three `read` verbs with `PathExpr` operands
- `LifecycleBlock` -> `ExecuteBlock` -> `ActionStep*`: `explore` + `PathExpr`; `write` + `PathExpr`; two `update` with `FieldRef` and `FieldRef Arrow StringLiteral`
- `LifecycleBlock` -> `TransitionsBlock` -> `TransitionRule*`: three `on Identifier Arrow Identifier`
- `LifecycleBlock` -> `CompletionBlock` -> `ActionStep*`: `emit` + `FieldRef`; `log` + `StringLiteral`
- `RBrace` closes `LifecycleDecl`

### 7.2 Structure Example: `Adventure`

```pdsl
structure Adventure {
  id: ADV-{NNN}
  state: concept | planning | review | active | completed | blocked

  contains {
    designs/  -> Design[0..*]
    plans/    -> Plan[0..*]
    schemas/  -> Schema[0..*]
    manifest.md -> Manifest[1]
  }

  spawns {
    Task[1..*] from plans
  }

  delegates {
    planning  -> adventure-planner
    preparing -> adventure-preparer
  }

  checkpoints {
    concept -> planning: "user approves concept"
    review  -> active:   "user approves plan and tasks"
  }
}
```

**Parse trace (abbreviated):**
- `'structure'` keyword, `Identifier` = `Adventure`, `LBrace`
- `StructureField`: `'id' Colon IdPattern` = `ADV-{NNN}`
- `StructureField`: `'state' Colon EnumValues` = six pipe-separated identifiers
- `StructureBlock` -> `ContainsBlock`: four `ContainmentEntry` entries
  - e.g. `PathExpr`=`designs/`, `Arrow`, `TypeRef`=`Design`, `Cardinality`=`[0..*]`
  - e.g. `PathExpr`=`manifest.md`, `Arrow`, `TypeRef`=`Manifest`, `Cardinality`=`[1]`
- `StructureBlock` -> `SpawnsBlock`: one `SpawnEntry`
  - `TypeRef`=`Task`, `Cardinality`=`[1..*]`, `'from'`, `Identifier`=`plans`
- `StructureBlock` -> `DelegatesBlock`: two `DelegationEntry`
  - e.g. `Identifier`=`planning`, `Arrow`, `Identifier`=`adventure-planner`
- `StructureBlock` -> `CheckpointsBlock`: two `CheckpointEntry`
  - e.g. `Identifier`=`concept`, `Arrow`, `Identifier`=`planning`, `Colon`, `StringLiteral`
- `RBrace` closes `StructureDecl`

### 7.3 Entity Example: `Task`

This example demonstrates all entity field syntax variants:

```pdsl
entity Task {
  id:               string /TASK-\d+/             // string with pattern constraint
  title:            string                         // plain string
  stage:            Stage                          // reference to another entity
  status:           Status                         // reference to another entity
  iterations:       number = 0                     // number with default value
  depends_on:       Task[0..*]                     // collection with cardinality
  adventure_id:     Adventure?                     // optional field
  target_conditions: TargetCondition[0..*]         // optional collection
}

entity Stage {
  values: planning | implementing | reviewing | fixing | completed | researching | BLOCKED
}

entity Status {
  values: pending | in_progress | ready | blocked
}
```

**Parse trace for `id` field:**
- `Identifier`=`id`, `Colon`
- `TypeExpr` -> `TypeRef`=`string` (single identifier, no pipe)
- `PatternLiteral`=`/TASK-\d+/`
- No `Question`, no `DefaultValue`, no `Cardinality`
- `Spacing` (including `LineComment`)

**Parse trace for `iterations` field:**
- `Identifier`=`iterations`, `Colon`
- `TypeExpr` -> `TypeRef`=`number`
- No `PatternLiteral`, no `Question`
- `DefaultValue` -> `Equals NumberLiteral`=`0`
- No `Cardinality`

**Parse trace for `depends_on` field:**
- `Identifier`=`depends_on`, `Colon`
- `TypeExpr` -> `TypeRef`=`Task`
- No `PatternLiteral`, no `Question`, no `DefaultValue`
- `Cardinality` -> `LBracket CardinalitySpec RBracket` where `CardinalitySpec`=`0 DotDot Star`

**Parse trace for `adventure_id` field:**
- `Identifier`=`adventure_id`, `Colon`
- `TypeExpr` -> `TypeRef`=`Adventure`
- No `PatternLiteral`
- `Question` matches (field is optional)
- No `DefaultValue`, no `Cardinality`

### 7.4 Relation Examples: `Task -> Adventure` and `Task -> Task`

```pdsl
relation Task -> Adventure {
  type:        belongs_to
  via:         adventure_id
  cardinality: 0..1
}

relation Task -> Task {
  type:        depends_on
  via:         depends_on
  cardinality: 0..*
  constraint:  no_cycles
}

relation Adventure -> Task {
  type:        owns
  via:         tasks[]
  cardinality: 1..*
  lifecycle:   cascade_delete
}
```

**Parse trace for `relation Task -> Adventure`:**
- `'relation'` keyword, `Identifier`=`Task`, `Arrow`, `Identifier`=`Adventure`, `LBrace`
- `RelationField`: `'type' Colon Identifier`=`belongs_to`
- `RelationField`: `'via' Colon ViaRef`=`adventure_id` (simple field, no brackets)
- `RelationField`: `'cardinality' Colon CardinalityNotation`=`0..1`
- `RBrace`

**Parse trace for `relation Adventure -> Task`:**
- `RelationField`: `'via' Colon ViaRef` -- `Identifier`=`tasks` followed by `LBracket RBracket` (array ref)
- `RelationField`: `'lifecycle' Colon Identifier`=`cascade_delete`

---

## 8. Token Summary Table

| Token Type        | Pattern / Keyword             | Example                   |
|-------------------|-------------------------------|---------------------------|
| **Keyword**       | `lifecycle`                   | `lifecycle PlanningCycle` |
| **Keyword**       | `structure`                   | `structure Adventure`     |
| **Keyword**       | `entity`                      | `entity Task`             |
| **Keyword**       | `relation`                    | `relation Task -> Task`   |
| **Keyword**       | `input`                       | `input { ... }`           |
| **Keyword**       | `execute`                     | `execute { ... }`         |
| **Keyword**       | `transitions`                 | `transitions { ... }`     |
| **Keyword**       | `completion`                  | `completion { ... }`      |
| **Keyword**       | `contains`                    | `contains { ... }`        |
| **Keyword**       | `spawns`                      | `spawns { ... }`          |
| **Keyword**       | `delegates`                   | `delegates { ... }`       |
| **Keyword**       | `checkpoints`                 | `checkpoints { ... }`     |
| **Keyword**       | `on`                          | `on success -> done`      |
| **Keyword**       | `from`                        | `Task[1..*] from plans`   |
| **Keyword**       | `type`                        | `type: belongs_to`        |
| **Keyword**       | `via`                         | `via: adventure_id`       |
| **Keyword**       | `cardinality`                 | `cardinality: 0..*`       |
| **Keyword**       | `constraint`                  | `constraint: no_cycles`   |
| **Keyword**       | `values`                      | `values: a \| b \| c`     |
| **Keyword**       | `role`                        | `role: planner`           |
| **Keyword**       | `model`                       | `model: opus`             |
| **Keyword**       | `trigger`                     | `trigger: x == "y"`       |
| **Keyword**       | `state`                       | `state: a \| b`           |
| **Keyword**       | `id`                          | `id: TASK-{NNN}`          |
| **Identifier**    | `[a-zA-Z_][a-zA-Z0-9_-]*`    | `PlanningCycle`, `task`   |
| **StringLiteral** | `"..."` (double-quoted)       | `"pending"`, `"0"`        |
| **NumberLiteral** | `[0-9]+`                      | `0`, `1`, `42`            |
| **PatternLiteral**| `/regex/`                     | `/TASK-\d+/`              |
| **Arrow**         | `->`                          | `on success -> done`      |
| **DotDot**        | `..`                          | `0..1`, `0..*`            |
| **CompEq**        | `==`                          | `task.status == "done"`   |
| **CompNe**        | `!=`                          | `task.status != "done"`   |
| **CompLe**        | `<=`                          | `count <= 10`             |
| **CompGe**        | `>=`                          | `count >= 1`              |
| **CompLt**        | `<`                           | `count < 10`              |
| **CompGt**        | `>`                           | `count > 0`               |
| **LogicAnd**      | `&&`                          | `a == "x" && b == "y"`    |
| **LogicOr**       | `\|\|`                        | `a == "x" \|\| b == "y"` |
| **Equals**        | `=`                           | `iterations: number = 0`  |
| **Colon**         | `:`                           | `role: planner`           |
| **Pipe**          | `\|`                          | `active \| blocked`       |
| **Question**      | `?`                           | `adventure_id: Adventure?`|
| **Dot**           | `.`                           | `task.status`             |
| **Star**          | `*`                           | `[0..*]`                  |
| **LBrace**        | `{`                           | `lifecycle Foo {`         |
| **RBrace**        | `}`                           | `}` (closes block)        |
| **LBracket**      | `[`                           | `Task[0..*]`              |
| **RBracket**      | `]`                           | `]`                       |
| **LParen**        | `(`                           | `(expr)`                  |
| **RParen**        | `)`                           | `)`                       |
| **LineComment**   | `// ... \n`                   | `// this is a comment`    |
| **BlockComment**  | `/* ... */`                   | `/* multi-line */`        |
| **EOF**           | end of input                  | (implicit)                |

---

## 9. Notes on Extensibility and Ambiguity Resolution

### Verb Set

The action verb set (`read`, `write`, `update`, `explore`, `emit`, `log`) is intentionally minimal and drawn from the pipeline domain. New verbs may be added in future grammar versions by extending the `Verb` rule. Parsers should be written to accept unknown verbs with a warning rather than a hard error, enabling forward compatibility.

### TypeExpr Disambiguation

`TypeExpr <- EnumValues / TypeRef` where `EnumValues` with a single identifier is identical to `TypeRef`. The grammar allows this because:
1. A single identifier without a `|` is treated as a type reference (not an inline enum).
2. The validator determines at semantic analysis time whether a bare identifier names a known entity type or an undeclared enum.

### PatternLiteral vs Division

The `PatternLiteral` token (`/regex/`) could theoretically conflict with a division operator. PDSL has no arithmetic expressions, so `/` is always the start of a pattern literal in field positions. The parser is unambiguous because pattern literals only appear in `EntityField` after the type expression.

### Cardinality in Containment vs Relations

Containment entries use bracketed cardinality (`TypeRef[0..*]`) while relation fields use a bare notation (`cardinality: 0..*`). This distinction is intentional: bracketed cardinality is a suffix on a type reference (analogous to UML multiplicity), while the bare notation in relation bodies is a key-value pair.

### Grammar Version and Evolution

This grammar is version 0.1.0. Future versions may add:
- Import/use declarations for multi-file PDSL projects
- Extended expression syntax (function calls, arithmetic)
- Annotation syntax (`@decorator` style)
- Template parameters on entity declarations

Breaking changes to existing productions will increment the minor version. Additive changes increment the patch version.
