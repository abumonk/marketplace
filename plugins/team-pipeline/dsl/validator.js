'use strict';

// ---------------------------------------------------------------------------
// PDSL Validator
//
// validate(ast) -- takes a Program AST node and returns an array of
// ValidationError objects.  Implements a two-pass approach:
//   Pass 1: symbol collection (entities, structures, lifecycles, field maps)
//   Pass 2: constraint checking (9 validation rules)
// ---------------------------------------------------------------------------

// Known primitive types accepted in field TypeExpressions
const KNOWN_PRIMITIVES = new Set([
  'string', 'number', 'boolean', 'date', 'markdown', 'yaml', 'json', 'path',
]);

// Well-known lifecycle stage names (for transition target warnings)
const WELL_KNOWN_STAGES = new Set([
  'planning', 'implementing', 'reviewing', 'fixing',
  'completed', 'researching', 'wait',
]);

// ---------------------------------------------------------------------------
// ValidationError factory
// ---------------------------------------------------------------------------

function ValidationError(message, severity, node, rule) {
  return { message, severity, node, rule };
}

// ---------------------------------------------------------------------------
// validate(ast) -- main entry point
// ---------------------------------------------------------------------------

function validate(ast) {
  if (!ast || !Array.isArray(ast.body)) {
    return [];
  }

  const errors = [];

  // -------------------------------------------------------------------------
  // Pass 1: Symbol Collection
  // -------------------------------------------------------------------------

  const declaredEntities   = new Set();   // entity names
  const entityFieldMap     = new Map();   // entityName -> Set<fieldName>
  const declaredStructures = new Set();   // structure names
  const structureStateMap  = new Map();   // structureName -> string[]
  const declaredLifecycles = new Set();   // lifecycle names
  const lifecycleStageMap  = new Map();   // lifecycleName -> Set<stageName>

  for (const node of ast.body) {
    if (node.type === 'Entity') {
      declaredEntities.add(node.name);
      const fields = new Set();
      if (Array.isArray(node.fields)) {
        for (const f of node.fields) {
          if (f && f.name) fields.add(f.name);
        }
      }
      entityFieldMap.set(node.name, fields);

    } else if (node.type === 'Structure') {
      declaredStructures.add(node.name);
      // Collect state enum values if present
      if (node.state && node.state.type === 'TypeExpression' && node.state.kind === 'enum') {
        structureStateMap.set(node.name, node.state.enumValues || []);
      } else if (node.state && node.state.type === 'Enum') {
        structureStateMap.set(node.name, node.state.values || []);
      } else {
        structureStateMap.set(node.name, []);
      }

    } else if (node.type === 'Lifecycle') {
      declaredLifecycles.add(node.name);
      // Collect stage names from transitions
      const stages = new Set();
      if (Array.isArray(node.transitions)) {
        for (const t of node.transitions) {
          if (t && t.target) stages.add(t.target);
        }
      }
      lifecycleStageMap.set(node.name, stages);
    }
  }

  // -------------------------------------------------------------------------
  // Pass 2: Validation Rules
  // -------------------------------------------------------------------------

  // --- Rule: cycle_in_relations (builds graph across all relations) ----------
  // Build adjacency list only for relations with "no_cycles" in constraints
  const noCyclesRelations = [];
  for (const node of ast.body) {
    if (node.type === 'Relation') {
      const constraints = node.constraints;
      if (Array.isArray(constraints) && constraints.includes('no_cycles')) {
        noCyclesRelations.push(node);
      }
    }
  }

  if (noCyclesRelations.length > 0) {
    const cycleErrors = detectCycles(noCyclesRelations);
    errors.push(...cycleErrors);
  }

  // --- Per-node rules --------------------------------------------------------
  for (const node of ast.body) {

    if (node.type === 'Entity') {
      validateEntity(node, declaredEntities, errors);

    } else if (node.type === 'Relation') {
      validateRelation(node, declaredEntities, entityFieldMap, errors);

    } else if (node.type === 'Lifecycle') {
      validateLifecycle(node, declaredLifecycles, errors);

    } else if (node.type === 'Structure') {
      validateStructure(node, declaredEntities, structureStateMap, errors);
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Entity validation
// ---------------------------------------------------------------------------

function validateEntity(entityNode, declaredEntities, errors) {
  if (!Array.isArray(entityNode.fields)) return;

  for (const field of entityNode.fields) {
    if (!field) continue;

    // Rule: unknown_field_type
    if (field.fieldType) {
      validateFieldType(field.fieldType, field, declaredEntities, errors);
    }

    // Rule: invalid_cardinality (on field)
    if (field.cardinality) {
      validateCardinality(field.cardinality, errors);
    }
  }
}

function validateFieldType(typeExpr, fieldNode, declaredEntities, errors) {
  if (!typeExpr) return;

  if (typeExpr.type === 'TypeExpression') {
    if (typeExpr.kind === 'reference') {
      const name = typeExpr.name;
      if (!KNOWN_PRIMITIVES.has(name) && !declaredEntities.has(name)) {
        errors.push(ValidationError(
          `Unknown field type '${name}': not a known primitive or declared entity`,
          'error',
          fieldNode,
          'unknown_field_type',
        ));
      }
    }
    // 'enum' kind: no reference check needed
  }
}

// ---------------------------------------------------------------------------
// Relation validation
// ---------------------------------------------------------------------------

function validateRelation(relationNode, declaredEntities, entityFieldMap, errors) {

  // Rule: unknown_relation_source
  if (relationNode.source && !declaredEntities.has(relationNode.source)) {
    errors.push(ValidationError(
      `Unknown relation source '${relationNode.source}': not a declared entity`,
      'error',
      relationNode,
      'unknown_relation_source',
    ));
  }

  // Rule: unknown_relation_target
  if (relationNode.target && !declaredEntities.has(relationNode.target)) {
    errors.push(ValidationError(
      `Unknown relation target '${relationNode.target}': not a declared entity`,
      'error',
      relationNode,
      'unknown_relation_target',
    ));
  }

  // Rule: missing_via_field
  if (relationNode.via) {
    const viaName = typeof relationNode.via === 'string'
      ? relationNode.via
      : relationNode.via.name;
    const source = relationNode.source;
    if (source && declaredEntities.has(source)) {
      const fields = entityFieldMap.get(source);
      if (fields && !fields.has(viaName)) {
        errors.push(ValidationError(
          `Relation via field '${viaName}' does not exist on source entity '${source}'`,
          'error',
          relationNode,
          'missing_via_field',
        ));
      }
    }
  }

  // Rule: invalid_cardinality (on relation)
  if (relationNode.cardinality) {
    validateCardinality(relationNode.cardinality, errors);
  }
}

// ---------------------------------------------------------------------------
// Lifecycle validation
// ---------------------------------------------------------------------------

function validateLifecycle(lifecycleNode, declaredLifecycles, errors) {
  if (!Array.isArray(lifecycleNode.transitions)) return;

  for (const transition of lifecycleNode.transitions) {
    if (!transition || !transition.target) continue;

    const target = transition.target;
    // Rule: unknown_transition_target (warning, not error)
    if (!declaredLifecycles.has(target) && !WELL_KNOWN_STAGES.has(target)) {
      errors.push(ValidationError(
        `Unknown transition target '${target}': not a declared lifecycle or well-known stage`,
        'warning',
        transition,
        'unknown_transition_target',
      ));
    }
  }
}

// ---------------------------------------------------------------------------
// Structure validation
// ---------------------------------------------------------------------------

function validateStructure(structureNode, declaredEntities, structureStateMap, errors) {

  // Rule: invalid_checkpoint_state
  const stateValues = structureStateMap.get(structureNode.name) || [];
  if (Array.isArray(structureNode.checkpoints)) {
    for (const checkpoint of structureNode.checkpoints) {
      if (!checkpoint) continue;

      if (checkpoint.fromState && !stateValues.includes(checkpoint.fromState)) {
        errors.push(ValidationError(
          `Checkpoint fromState '${checkpoint.fromState}' is not in structure '${structureNode.name}' state enum`,
          'error',
          checkpoint,
          'invalid_checkpoint_state',
        ));
      }

      if (checkpoint.toState && !stateValues.includes(checkpoint.toState)) {
        errors.push(ValidationError(
          `Checkpoint toState '${checkpoint.toState}' is not in structure '${structureNode.name}' state enum`,
          'error',
          checkpoint,
          'invalid_checkpoint_state',
        ));
      }
    }
  }

  // Rule: unknown_containment_type
  if (Array.isArray(structureNode.contains)) {
    for (const entry of structureNode.contains) {
      if (!entry) continue;
      if (entry.targetType && !declaredEntities.has(entry.targetType)) {
        errors.push(ValidationError(
          `Structure containment targetType '${entry.targetType}' is not a declared entity`,
          'error',
          entry,
          'unknown_containment_type',
        ));
      }
    }
  }

  // Rule: unknown_spawn_type
  if (Array.isArray(structureNode.spawns)) {
    for (const entry of structureNode.spawns) {
      if (!entry) continue;
      if (entry.targetType && !declaredEntities.has(entry.targetType)) {
        errors.push(ValidationError(
          `Structure spawn targetType '${entry.targetType}' is not a declared entity`,
          'error',
          entry,
          'unknown_spawn_type',
        ));
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Cardinality validation
// ---------------------------------------------------------------------------

function validateCardinality(cardNode, errors) {
  if (!cardNode || cardNode.type !== 'Cardinality') return;

  const min = cardNode.min;
  const max = cardNode.max;

  if (typeof min === 'number' && min < 0) {
    errors.push(ValidationError(
      `Cardinality min (${min}) must be >= 0`,
      'error',
      cardNode,
      'invalid_cardinality',
    ));
    return;
  }

  if (typeof min === 'number' && typeof max === 'number' && min > max) {
    errors.push(ValidationError(
      `Cardinality min (${min}) must be <= max (${max})`,
      'error',
      cardNode,
      'invalid_cardinality',
    ));
  }
}

// ---------------------------------------------------------------------------
// Cycle detection (DFS with white/gray/black coloring)
// ---------------------------------------------------------------------------

function detectCycles(relations) {
  const errors = [];

  // Build adjacency list
  const adj = new Map(); // source -> [{ target, relation }]
  for (const rel of relations) {
    if (!rel.source || !rel.target) continue;
    if (!adj.has(rel.source)) adj.set(rel.source, []);
    adj.get(rel.source).push({ target: rel.target, relation: rel });
  }

  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color  = new Map();
  const parent = new Map(); // for path reconstruction

  // Initialize all nodes white
  for (const node of adj.keys()) {
    color.set(node, WHITE);
  }
  // Also init target nodes
  for (const edges of adj.values()) {
    for (const { target } of edges) {
      if (!color.has(target)) color.set(target, WHITE);
    }
  }

  function dfs(node, cycleRelation) {
    color.set(node, GRAY);

    const edges = adj.get(node) || [];
    for (const { target, relation } of edges) {
      if (color.get(target) === GRAY) {
        // Found a cycle
        errors.push(ValidationError(
          `Cycle detected in relations with no_cycles constraint: '${node}' -> '${target}'`,
          'error',
          relation,
          'cycle_in_relations',
        ));
        return true;
      }
      if (color.get(target) === WHITE) {
        if (dfs(target, relation)) return true;
      }
    }

    color.set(node, BLACK);
    return false;
  }

  for (const node of color.keys()) {
    if (color.get(node) === WHITE) {
      dfs(node, null);
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { validate, ValidationError };
