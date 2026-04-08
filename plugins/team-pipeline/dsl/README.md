# PDSL - Pipeline DSL

A domain-specific language for describing pipeline agent lifecycles, hierarchical structures, and entity relationships as visual diagrams.

PDSL source files (`.pdsl`) describe the data model and agent behavior of a task processing pipeline. The library parses them into an AST, validates semantic constraints, lays out nodes into a graph, and renders the graph to SVG.

## Syntax Overview

### Lifecycle Declarations

A `lifecycle` block describes one agent cycle: what role executes it, which model to use, the trigger condition, what to read and write, how to transition, and what to emit on completion.

```
lifecycle PlanningCycle {
  role: planner
  model: opus
  trigger: task.status == "pending" && task.stage == "planning"

  input {
    read .agent/tasks/task.md
    read .agent/config.md
  }

  execute {
    explore codebase
    write .agent/designs/design.md
    update task.status -> "ready"
  }

  transitions {
    on success -> implementing
    on blocked -> wait
    on error   -> wait
  }

  completion {
    emit task.planned
    log "planner: design complete"
  }
}
```

**Fields:**
- `role:` - agent role identifier (e.g. `planner`, `implementer`, `reviewer`)
- `model:` - model tier (`opus`, `sonnet`, `haiku`)
- `trigger:` - boolean expression combining `==`, `!=`, `&&`, `||`
- `input {}` - list of `read` action steps (paths or field refs)
- `execute {}` - list of action steps (`explore`, `write`, `update`, `read`)
- `transitions {}` - list of `on <event> -> <target-stage>` rules
- `completion {}` - list of `emit` and `log` steps

### Structure Declarations

A `structure` block describes a hierarchical artifact type: its file-system layout, what sub-objects it contains and can spawn, which agents handle each stage, and which checkpoints require user approval.

```
structure Adventure {
  id: ADV-{NNN}
  state: concept | planning | review | active | completed | blocked

  contains {
    designs/    -> Design[0..*]
    plans/      -> Plan[0..*]
    manifest.md -> Manifest[1]
  }

  spawns {
    Task[1..*] from plans
  }

  delegates {
    planning -> adventure-planner
  }

  checkpoints {
    concept -> planning: "user approves concept"
    review  -> active:   "user approves plan and tasks"
  }
}
```

**Fields:**
- `id:` - identifier pattern (e.g. `TASK-{NNN}`, `ADV-{NNN}`)
- `state:` - pipe-separated enum of valid state values
- `contains {}` - path -> EntityType[cardinality] entries
- `spawns {}` - EntityType[cardinality] from <source> entries
- `delegates {}` - stage -> role entries
- `checkpoints {}` - fromState -> toState: "condition" entries

### Entity and Relation Declarations

`entity` blocks define data types with typed fields, optional constraints, cardinality, and default values. `relation` blocks define directed associations between entities.

```
entity Task {
  id:          string /TASK-\d+/
  title:       string
  stage:       Stage
  iterations:  number = 0
  depends_on:  Task[0..*]
  adventure_id: Adventure?
}

entity Stage {
  values: planning | implementing | reviewing | fixing | completed | researching
}

relation Task -> Adventure {
  type:        belongs_to
  via:         adventure_id
  cardinality: 0..1
}

relation Adventure -> Task {
  type:        owns
  via:         tasks[]
  cardinality: 1..*
  lifecycle:   cascade_delete
}
```

**Entity field syntax:** `name: type [/pattern/] [?] [= default] [cardinality]`

**Relation fields:**
- `type:` - semantic relationship name (e.g. `belongs_to`, `owns`, `depends_on`)
- `via:` - field name on the source entity (append `[]` for array fields)
- `cardinality:` - min..max notation (`0..1`, `1..*`, `0..*`, `1`)
- `constraint:` - `no_cycles` to enforce acyclicity
- `lifecycle:` - `cascade_delete` to cascade deletions

## CLI Usage

The PDSL CLI (`dsl/cli.js`) provides three commands.

### Render

Convert a `.pdsl` file to an SVG diagram:

```bash
node dsl/cli.js render <file.pdsl> [options]
```

Options:
- `--output <file.svg>` - write SVG to file (default: stdout)
- `--theme <file.json>` - load a custom JSON theme

### Validate

Check a `.pdsl` file for parse and semantic errors:

```bash
node dsl/cli.js validate <file.pdsl>
```

Exits 0 on success, 1 if errors are found. Prints diagnostics to stderr.

### Format

Serialize a `.pdsl` file back to canonical form:

```bash
node dsl/cli.js format <file.pdsl> [options]
```

Options:
- `--output <file.pdsl>` - write formatted output to file (default: stdout)
- `--check` - exit 1 if the file is not already formatted (useful in CI)

## Viewer Usage

Open `dsl/viewer.html` in a browser to use the interactive PDSL editor and viewer.

The viewer provides a split-pane interface:
- **Left pane**: code editor with PDSL syntax highlighting
- **Right pane**: live SVG diagram that updates as you type

Features:
- Real-time parse and render on every keystroke
- Error messages displayed below the editor
- SVG pan and zoom via mouse wheel and drag
- Theme selector for switching between built-in color themes

To start the viewer, open the file directly:

```bash
# On Windows
start dsl/viewer.html

# On macOS
open dsl/viewer.html

# On Linux
xdg-open dsl/viewer.html
```

No server is required -- the viewer loads all dependencies locally.

## API Reference

All functions are exported from `dsl/index.js`:

```js
const { parse, tokenize, serialize, validate, layout, render, defaultTheme, createTheme } = require('./dsl/index');
```

| Function | Signature | Returns | Description |
|----------|-----------|---------|-------------|
| `parse` | `parse(source)` | `{ ast, program, errors }` | Tokenize and parse a PDSL source string. `ast` and `program` are aliases for the same root `Program` node. `errors` is an array of parse error objects with `message`, `line`, `column`. |
| `tokenize` | `tokenize(source)` | `Token[]` | Lex a PDSL source string into an array of tokens. Each token has `type`, `value`, `line`, `column`. Use `TokenType` to compare token types. |
| `validate` | `validate(ast)` | `ValidationError[]` | Validate a parsed AST for semantic errors (unknown types, invalid cardinality, cycles, etc.). Returns an array of diagnostics; empty array means the file is valid. Each entry has `message`, `severity` (`'error'` or `'warning'`), `rule`, and `node`. |
| `serialize` | `serialize(ast)` | `string` | Serialize an AST back to a canonical PDSL source string. Useful for formatting or round-trip testing. |
| `layout` | `layout(ast, options?)` | `LayoutGraph` | Convert a parsed AST into a positioned graph. `LayoutGraph` has `nodes` (array of `LayoutNode` with `x`, `y`, `width`, `height`, `id`, `label`, `meta`) and `edges` (array of `LayoutEdge` with `source`, `target`, `label`, `waypoints`, `meta`). |
| `render` | `render(graph, theme?)` | `string` | Convert a `LayoutGraph` to an SVG string. If `theme` is omitted the default theme is used. |
| `defaultTheme` | `defaultTheme()` | `Theme` | Return the built-in pipeline theme with stage colors, font settings, and node styles. |
| `createTheme` | `createTheme(overrides)` | `Theme` | Create a custom theme by deep-merging `overrides` onto the defaults. Only the specified properties are changed; all other defaults are preserved. |

### Layout options

`layout(ast, options)` accepts an optional options object:

| Option | Default | Description |
|--------|---------|-------------|
| `nodeWidth` | `120` | Default node width in SVG user units |
| `nodeHeight` | `40` | Default node height in SVG user units |
| `layerSpacing` | `80` | Vertical gap between graph layers |
| `nodeSpacing` | `40` | Horizontal gap between nodes in the same layer |

### Theme structure

```js
const theme = defaultTheme();
// theme.stages.planning.fill   -- stage background color
// theme.stages.planning.stroke -- stage border color
// theme.stages.planning.text   -- stage text color
// theme.entity.fill            -- entity node background
// theme.entity.stroke          -- entity node border
// theme.generic.fill           -- fallback background
// theme.font.family            -- font family string
// theme.font.size              -- base font size in px
```

## Running Tests

Run the full test suite from the `projects/team-pipeline` directory:

```bash
node --test dsl/test/*.test.js
```

Run only a specific test file:

```bash
node --test dsl/test/integration.test.js
node --test dsl/test/parser.test.js
node --test dsl/test/validator.test.js
node --test dsl/test/layout.test.js
node --test dsl/test/renderer.test.js
node --test dsl/test/serializer.test.js
```

Or run from the workspace root:

```bash
node --test projects/team-pipeline/dsl/test/*.test.js
```
