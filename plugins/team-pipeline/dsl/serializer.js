'use strict';

// ---------------------------------------------------------------------------
// PDSL Serializer
//
// serialize(ast) -- accepts a Program AST node, returns canonical PDSL source.
//
// Rules:
//  - 2-space indentation
//  - Only emit non-null / non-empty fields
//  - Declarations separated by blank lines (\n\n)
//  - Round-trip safe: parse(serialize(ast)) produces equivalent AST
// ---------------------------------------------------------------------------

/**
 * Serialize a Program AST node to canonical PDSL source text.
 * @param {object} ast - Program node from parse()
 * @returns {string}
 */
function serialize(ast) {
  if (!ast || !ast.body || ast.body.length === 0) {
    return '';
  }
  return ast.body.map(node => serializeNode(node, '')).join('\n\n');
}

// ---------------------------------------------------------------------------
// Top-level dispatcher
// ---------------------------------------------------------------------------

function serializeNode(node, indent) {
  switch (node.type) {
    case 'Lifecycle':  return serializeLifecycle(node, indent);
    case 'Structure':  return serializeStructure(node, indent);
    case 'Entity':     return serializeEntity(node, indent);
    case 'Relation':   return serializeRelation(node, indent);
    default:
      throw new Error(`serialize: unknown node type '${node.type}'`);
  }
}

// ---------------------------------------------------------------------------
// Lifecycle declaration
//
// lifecycle {name} {
//   role: {role}
//   model: {model}
//   trigger: {expr}
//
//   input { ... }
//   execute { ... }
//   transitions { ... }
//   completion { ... }
// }
// ---------------------------------------------------------------------------

function serializeLifecycle(node, indent) {
  const i1 = indent + '  ';
  const lines = [];
  lines.push(`${indent}lifecycle ${node.name} {`);

  // Simple scalar fields
  if (node.role)    lines.push(`${i1}role: ${node.role}`);
  if (node.model)   lines.push(`${i1}model: ${node.model}`);
  if (node.trigger) lines.push(`${i1}trigger: ${serializeExpression(node.trigger)}`);

  // Blank line between scalar fields and block sections (if any blocks exist)
  const hasBlocks = (node.input    && node.input.length > 0) ||
                    (node.execute  && node.execute.length > 0) ||
                    (node.transitions && node.transitions.length > 0) ||
                    (node.completion && node.completion.length > 0);
  if (hasBlocks && (node.role || node.model || node.trigger)) {
    lines.push('');
  }

  if (node.input && node.input.length > 0) {
    lines.push(...serializeActionBlock('input', node.input, indent));
  }
  if (node.execute && node.execute.length > 0) {
    lines.push(...serializeActionBlock('execute', node.execute, indent));
  }
  if (node.transitions && node.transitions.length > 0) {
    lines.push(...serializeTransitionsBlock(node.transitions, indent));
  }
  if (node.completion && node.completion.length > 0) {
    lines.push(...serializeActionBlock('completion', node.completion, indent));
  }

  lines.push(`${indent}}`);
  return lines.join('\n');
}

// Emit an action block (input/execute/completion):
//   keyword {
//     verb operand...
//   }
function serializeActionBlock(keyword, steps, indent) {
  const i1 = indent + '  ';
  const i2 = indent + '    ';
  const lines = [`${i1}${keyword} {`];
  for (const step of steps) {
    lines.push(serializeActionStep(step, i2));
  }
  lines.push(`${i1}}`);
  return lines;
}

// Emit a transitions block:
//   transitions {
//     on event -> target
//   }
function serializeTransitionsBlock(rules, indent) {
  const i1 = indent + '  ';
  const i2 = indent + '    ';
  const lines = [`${i1}transitions {`];
  for (const rule of rules) {
    lines.push(`${i2}on ${rule.on} -> ${rule.target}`);
  }
  lines.push(`${i1}}`);
  return lines;
}

// Serialize one action step: "verb operand1 operand2 ..."
function serializeActionStep(step, indent) {
  const parts = [step.verb];
  for (const op of step.operands) {
    parts.push(serializeOperand(op));
  }
  return `${indent}${parts.join(' ')}`;
}

// ---------------------------------------------------------------------------
// Structure declaration
// ---------------------------------------------------------------------------

function serializeStructure(node, indent) {
  const i1 = indent + '  ';
  const lines = [];
  lines.push(`${indent}structure ${node.name} {`);

  // Simple fields
  if (node.id !== null && node.id !== undefined) {
    lines.push(`${i1}id: ${serializeId(node.id)}`);
  }
  if (node.state) {
    lines.push(`${i1}state: ${serializeEnumValues(node.state.values)}`);
  }

  // Blank line before blocks (if any blocks and any simple fields)
  const hasBlocks = (node.contains    && node.contains.length > 0)    ||
                    (node.spawns      && node.spawns.length > 0)       ||
                    (node.delegates   && node.delegates.length > 0)    ||
                    (node.checkpoints && node.checkpoints.length > 0);
  if (hasBlocks && (node.id !== null && node.id !== undefined || node.state)) {
    lines.push('');
  }

  if (node.contains && node.contains.length > 0) {
    lines.push(...serializeContainsBlock(node.contains, indent));
  }
  if (node.spawns && node.spawns.length > 0) {
    lines.push(...serializeSpawnsBlock(node.spawns, indent));
  }
  if (node.delegates && node.delegates.length > 0) {
    lines.push(...serializeDelegatesBlock(node.delegates, indent));
  }
  if (node.checkpoints && node.checkpoints.length > 0) {
    lines.push(...serializeCheckpointsBlock(node.checkpoints, indent));
  }

  lines.push(`${indent}}`);
  return lines.join('\n');
}

function serializeId(id) {
  if (id === null || id === undefined) return '';
  // PatternLiteral node
  if (typeof id === 'object' && id.type === 'Pattern') {
    return `/${id.regex}/`;
  }
  // String value (e.g. "ADV-{NNN}" or a plain string from STRING token)
  return id;
}

function serializeEnumValues(values) {
  return values.join(' | ');
}

function serializeContainsBlock(entries, indent) {
  const i1 = indent + '  ';
  const i2 = indent + '    ';
  const lines = [`${i1}contains {`];
  for (const e of entries) {
    const card = e.cardinality ? `[${e.cardinality.notation}]` : '';
    lines.push(`${i2}${e.path} -> ${e.targetType}${card}`);
  }
  lines.push(`${i1}}`);
  return lines;
}

function serializeSpawnsBlock(entries, indent) {
  const i1 = indent + '  ';
  const i2 = indent + '    ';
  const lines = [`${i1}spawns {`];
  for (const e of entries) {
    const card = e.cardinality ? `[${e.cardinality.notation}]` : '';
    lines.push(`${i2}${e.targetType}${card} from ${e.source}`);
  }
  lines.push(`${i1}}`);
  return lines;
}

function serializeDelegatesBlock(entries, indent) {
  const i1 = indent + '  ';
  const i2 = indent + '    ';
  const lines = [`${i1}delegates {`];
  for (const e of entries) {
    lines.push(`${i2}${e.stage} -> ${e.role}`);
  }
  lines.push(`${i1}}`);
  return lines;
}

function serializeCheckpointsBlock(entries, indent) {
  const i1 = indent + '  ';
  const i2 = indent + '    ';
  const lines = [`${i1}checkpoints {`];
  for (const e of entries) {
    lines.push(`${i2}${e.fromState} -> ${e.toState}: "${e.condition}"`);
  }
  lines.push(`${i1}}`);
  return lines;
}

// ---------------------------------------------------------------------------
// Entity declaration
// ---------------------------------------------------------------------------

function serializeEntity(node, indent) {
  const i1 = indent + '  ';
  const lines = [];
  lines.push(`${indent}entity ${node.name} {`);
  for (const field of node.fields) {
    lines.push(serializeField(field, i1));
  }
  lines.push(`${indent}}`);
  return lines.join('\n');
}

function serializeField(field, indent) {
  // Special case: 'values' field with EnumType fieldType
  if (field.name === 'values' && field.fieldType && field.fieldType.type === 'Enum') {
    return `${indent}values: ${serializeEnumValues(field.fieldType.values)}`;
  }

  // Normal field: name: TypeExpr [/pattern/] [?] [= default] [[cardinality]]
  const parts = [`${indent}${field.name}: `];
  parts.push(serializeTypeExpression(field.fieldType));

  if (field.pattern) {
    parts.push(` /${field.pattern.regex}/`);
  }
  if (field.optional) {
    parts.push(' ?');
  }
  if (field.default !== null && field.default !== undefined) {
    parts.push(` = ${serializeLiteralValue(field.default)}`);
  }
  if (field.cardinality) {
    parts.push(` [${field.cardinality.notation}]`);
  }

  return parts.join('');
}

function serializeTypeExpression(typeExpr) {
  if (!typeExpr) return '';
  if (typeExpr.type === 'TypeExpression') {
    if (typeExpr.kind === 'reference') {
      return typeExpr.name;
    }
    if (typeExpr.kind === 'enum') {
      return serializeEnumValues(typeExpr.enumValues);
    }
  }
  if (typeExpr.type === 'Enum') {
    return serializeEnumValues(typeExpr.values);
  }
  return '';
}

// ---------------------------------------------------------------------------
// Relation declaration
// ---------------------------------------------------------------------------

function serializeRelation(node, indent) {
  const i1 = indent + '  ';
  const lines = [];
  lines.push(`${indent}relation ${node.source} -> ${node.target} {`);

  if (node.relationType) {
    lines.push(`${i1}type: ${node.relationType}`);
  }
  if (node.via) {
    const arr = node.via.array ? '[]' : '';
    lines.push(`${i1}via: ${node.via.name}${arr}`);
  }
  if (node.cardinality) {
    lines.push(`${i1}cardinality: ${node.cardinality.notation}`);
  }
  if (node.constraints && node.constraints.length > 0) {
    for (const c of node.constraints) {
      lines.push(`${i1}constraint: ${c}`);
    }
  }
  if (node.lifecycle) {
    lines.push(`${i1}lifecycle: ${node.lifecycle}`);
  }

  lines.push(`${indent}}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Expression serialization (for trigger:)
// ---------------------------------------------------------------------------

function serializeExpression(node) {
  if (!node) return '';
  switch (node.type) {
    case 'BinaryExpression':
      return `${serializeExpression(node.left)} ${node.operator} ${serializeExpression(node.right)}`;
    case 'LogicalExpression':
      return `${serializeExpression(node.left)} ${node.operator} ${serializeExpression(node.right)}`;
    case 'FieldRef':
      return node.segments.join('.');
    case 'Literal':
      return serializeLiteralValue(node);
    default:
      return '';
  }
}

// ---------------------------------------------------------------------------
// Operand serialization (for action steps)
// ---------------------------------------------------------------------------

function serializeOperand(node) {
  if (!node) return '';
  switch (node.type) {
    case 'Literal': {
      const lit = serializeLiteralValue(node);
      return lit;
    }
    case 'FieldRef': {
      let s = node.segments.join('.');
      if (node.assignment !== undefined && node.assignment !== null) {
        s += ` -> "${node.assignment}"`;
      }
      return s;
    }
    default:
      return '';
  }
}

// ---------------------------------------------------------------------------
// Literal value serialization
// ---------------------------------------------------------------------------

function serializeLiteralValue(node) {
  if (!node) return '';
  switch (node.kind) {
    case 'string':     return `"${node.value}"`;
    case 'number':     return String(node.value);
    case 'identifier': return String(node.value);
    case 'path':       return String(node.value);
    default:           return String(node.value);
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { serialize };
