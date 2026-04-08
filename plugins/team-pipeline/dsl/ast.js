'use strict';

// ---------------------------------------------------------------------------
// TokenType enum -- frozen object with all ~50 token type constants
// ---------------------------------------------------------------------------

const TokenType = Object.freeze({
  // Keywords (24) -- each gets its own type matching the keyword string
  LIFECYCLE:   'lifecycle',
  STRUCTURE:   'structure',
  ENTITY:      'entity',
  RELATION:    'relation',
  INPUT:       'input',
  EXECUTE:     'execute',
  TRANSITIONS: 'transitions',
  COMPLETION:  'completion',
  CONTAINS:    'contains',
  SPAWNS:      'spawns',
  DELEGATES:   'delegates',
  CHECKPOINTS: 'checkpoints',
  ON:          'on',
  FROM:        'from',
  TYPE:        'type',
  VIA:         'via',
  CARDINALITY: 'cardinality',
  CONSTRAINT:  'constraint',
  VALUES:      'values',
  ROLE:        'role',
  MODEL:       'model',
  TRIGGER:     'trigger',
  STATE:       'state',
  ID:          'id',

  // Literals (4)
  IDENTIFIER: 'IDENTIFIER',
  STRING:     'STRING',
  NUMBER:     'NUMBER',
  PATTERN:    'PATTERN',

  // Operators -- multi-char before single-char (16)
  ARROW:     'ARROW',     // ->
  DOT_DOT:   'DOT_DOT',   // ..
  COMP_EQ:   'COMP_EQ',   // ==
  COMP_NE:   'COMP_NE',   // !=
  COMP_LE:   'COMP_LE',   // <=
  COMP_GE:   'COMP_GE',   // >=
  COMP_LT:   'COMP_LT',   // <
  COMP_GT:   'COMP_GT',   // >
  LOGIC_AND: 'LOGIC_AND', // &&
  LOGIC_OR:  'LOGIC_OR',  // ||
  EQUALS:    'EQUALS',    // =
  COLON:     'COLON',     // :
  PIPE:      'PIPE',      // |
  QUESTION:  'QUESTION',  // ?
  DOT:       'DOT',       // .
  STAR:      'STAR',      // *

  // Punctuation (7)
  LBRACE:   'LBRACE',   // {
  RBRACE:   'RBRACE',   // }
  LBRACKET: 'LBRACKET', // [
  RBRACKET: 'RBRACKET', // ]
  LPAREN:   'LPAREN',   // (
  RPAREN:   'RPAREN',   // )
  COMMA:    'COMMA',    // ,

  // Path separator -- disambiguates '/' from pattern literals
  SLASH: 'SLASH',       // /

  // Special
  EOF:   'EOF',
  ERROR: 'ERROR',
});

// ---------------------------------------------------------------------------
// KEYWORDS set -- O(1) lookup during lexing
// ---------------------------------------------------------------------------

const KEYWORDS = new Set([
  'lifecycle', 'structure', 'entity', 'relation',
  'input', 'execute', 'transitions', 'completion',
  'contains', 'spawns', 'delegates', 'checkpoints',
  'on', 'from', 'type', 'via', 'cardinality',
  'constraint', 'values', 'role', 'model', 'trigger',
  'state', 'id',
]);

// ---------------------------------------------------------------------------
// Token factory
// ---------------------------------------------------------------------------

function createToken(type, value, line, column) {
  return { type, value, line, column };
}

// ---------------------------------------------------------------------------
// Location helper -- spans from start token to end token (inclusive)
// ---------------------------------------------------------------------------

function loc(startToken, endToken) {
  const endValue = endToken.value != null ? String(endToken.value) : '';
  return {
    line:      startToken.line,
    column:    startToken.column,
    endLine:   endToken.line,
    endColumn: endToken.column + endValue.length,
  };
}

// ---------------------------------------------------------------------------
// AST node factories
// Each returns a plain object with a `type` discriminator and `loc` property.
// Field names match the entity schema from entities.md.
// ---------------------------------------------------------------------------

function Program(body, comments, srcLoc) {
  return { type: 'Program', body, comments, loc: srcLoc };
}

function LifecycleDecl(name, { role, model, trigger, input, execute, transitions, completion } = {}, srcLoc) {
  return { type: 'Lifecycle', name, role, model, trigger, input, execute, transitions, completion, loc: srcLoc };
}

function StructureDecl(name, { id, state, contains, spawns, delegates, checkpoints } = {}, srcLoc) {
  return { type: 'Structure', name, id, state, contains, spawns, delegates, checkpoints, loc: srcLoc };
}

function EntityDecl(name, fields, srcLoc) {
  return { type: 'Entity', name, fields, loc: srcLoc };
}

function RelationDecl(source, target, { relationType, via, cardinality, constraints } = {}, srcLoc) {
  return { type: 'Relation', source, target, relationType, via, cardinality, constraints, loc: srcLoc };
}

function FieldDecl(name, { fieldType, optional = false, defaultValue, pattern, cardinality } = {}, srcLoc) {
  return { type: 'Field', name, fieldType, optional, default: defaultValue, pattern, cardinality, loc: srcLoc };
}

function TransitionRule(on, target, srcLoc) {
  return { type: 'Transition', on, target, loc: srcLoc };
}

function ActionStep(verb, operands, srcLoc) {
  return { type: 'Action', verb, operands, loc: srcLoc };
}

function ContainmentEntry(path, targetType, cardinality, srcLoc) {
  return { type: 'Containment', path, targetType, cardinality, loc: srcLoc };
}

function SpawnEntry(targetType, cardinality, source, srcLoc) {
  return { type: 'Spawn', targetType, cardinality, source, loc: srcLoc };
}

function DelegationEntry(stage, role, srcLoc) {
  return { type: 'Delegation', stage, role, loc: srcLoc };
}

function CheckpointEntry(fromState, toState, condition, srcLoc) {
  return { type: 'Checkpoint', fromState, toState, condition, loc: srcLoc };
}

function PatternLiteral(regex, srcLoc) {
  return { type: 'Pattern', regex, loc: srcLoc };
}

function EnumType(values, srcLoc) {
  return { type: 'Enum', values, loc: srcLoc };
}

function TypeExpression(kind, name, enumValues, srcLoc) {
  return { type: 'TypeExpression', kind, name, enumValues, loc: srcLoc };
}

function Cardinality(min, max, notation, srcLoc) {
  return { type: 'Cardinality', min, max, notation, loc: srcLoc };
}

function CommentNode(style, text, srcLoc) {
  return { type: 'Comment', style, text, loc: srcLoc };
}

function BinaryExpression(operator, left, right, srcLoc) {
  return { type: 'BinaryExpression', operator, left, right, loc: srcLoc };
}

function LogicalExpression(operator, left, right, srcLoc) {
  return { type: 'LogicalExpression', operator, left, right, loc: srcLoc };
}

function FieldRef(segments, srcLoc) {
  return { type: 'FieldRef', segments, loc: srcLoc };
}

function Literal(kind, value, srcLoc) {
  return { type: 'Literal', kind, value, loc: srcLoc };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  TokenType,
  KEYWORDS,
  createToken,
  // AST node factories
  Program,
  LifecycleDecl,
  StructureDecl,
  EntityDecl,
  RelationDecl,
  FieldDecl,
  TransitionRule,
  ActionStep,
  ContainmentEntry,
  SpawnEntry,
  DelegationEntry,
  CheckpointEntry,
  PatternLiteral,
  EnumType,
  TypeExpression,
  Cardinality,
  CommentNode,
  BinaryExpression,
  LogicalExpression,
  FieldRef,
  Literal,
  // Utilities
  loc,
};
