'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
  Program,
  EntityDecl,
  RelationDecl,
  FieldDecl,
  TypeExpression,
  Cardinality,
  LifecycleDecl,
  TransitionRule,
  StructureDecl,
  CheckpointEntry,
  ContainmentEntry,
  SpawnEntry,
} = require('../ast');
const { validate } = require('../validator');

// ---------------------------------------------------------------------------
// Helpers: synthetic loc object used when constructing test nodes
// ---------------------------------------------------------------------------

const LOC = { line: 1, column: 0, endLine: 1, endColumn: 10 };

function mkLoc() { return LOC; }

// ---------------------------------------------------------------------------
// Test 1: Valid AST returns zero errors
// ---------------------------------------------------------------------------

describe('validator', () => {
  it('valid AST with entities and relations returns zero errors', () => {
    const task = EntityDecl('Task', [
      FieldDecl('title', { fieldType: TypeExpression('reference', 'string', null, mkLoc()) }, mkLoc()),
    ], mkLoc());

    const user = EntityDecl('User', [
      FieldDecl('name', { fieldType: TypeExpression('reference', 'string', null, mkLoc()) }, mkLoc()),
    ], mkLoc());

    const rel = RelationDecl('Task', 'User', {}, mkLoc());

    const ast = Program([task, user, rel], [], mkLoc());
    const errors = validate(ast);
    assert.strictEqual(errors.length, 0);
  });

  // -------------------------------------------------------------------------
  // Test 2: Unknown field type produces error
  // -------------------------------------------------------------------------

  it('unknown field type reference produces unknown_field_type error', () => {
    const task = EntityDecl('Task', [
      FieldDecl('owner', { fieldType: TypeExpression('reference', 'NonExistentEntity', null, mkLoc()) }, mkLoc()),
    ], mkLoc());

    const ast = Program([task], [], mkLoc());
    const errors = validate(ast);
    assert.strictEqual(errors.length, 1);
    assert.strictEqual(errors[0].rule, 'unknown_field_type');
    assert.strictEqual(errors[0].severity, 'error');
    assert.ok(errors[0].message.includes('NonExistentEntity'));
  });

  // -------------------------------------------------------------------------
  // Test 3: Known primitive types pass validation
  // -------------------------------------------------------------------------

  it('known primitive types pass validation', () => {
    const fields = ['string', 'number', 'boolean', 'date', 'markdown', 'yaml', 'json', 'path'].map(
      prim => FieldDecl(prim + '_field', { fieldType: TypeExpression('reference', prim, null, mkLoc()) }, mkLoc())
    );

    const entity = EntityDecl('AllPrimitives', fields, mkLoc());
    const ast = Program([entity], [], mkLoc());
    const errors = validate(ast);
    assert.strictEqual(errors.length, 0);
  });

  // -------------------------------------------------------------------------
  // Test 4: Unknown relation source produces error
  // -------------------------------------------------------------------------

  it('unknown relation source produces unknown_relation_source error', () => {
    const user = EntityDecl('User', [], mkLoc());
    const rel = RelationDecl('GhostEntity', 'User', {}, mkLoc());
    const ast = Program([user, rel], [], mkLoc());
    const errors = validate(ast);
    const sourceErrors = errors.filter(e => e.rule === 'unknown_relation_source');
    assert.strictEqual(sourceErrors.length, 1);
    assert.ok(sourceErrors[0].message.includes('GhostEntity'));
  });

  // -------------------------------------------------------------------------
  // Test 5: Unknown relation target produces error
  // -------------------------------------------------------------------------

  it('unknown relation target produces unknown_relation_target error', () => {
    const user = EntityDecl('User', [], mkLoc());
    const rel = RelationDecl('User', 'GhostTarget', {}, mkLoc());
    const ast = Program([user, rel], [], mkLoc());
    const errors = validate(ast);
    const targetErrors = errors.filter(e => e.rule === 'unknown_relation_target');
    assert.strictEqual(targetErrors.length, 1);
    assert.ok(targetErrors[0].message.includes('GhostTarget'));
  });

  // -------------------------------------------------------------------------
  // Test 6: Missing via field produces error
  // -------------------------------------------------------------------------

  it('missing via field produces missing_via_field error', () => {
    const task = EntityDecl('Task', [
      FieldDecl('title', { fieldType: TypeExpression('reference', 'string', null, mkLoc()) }, mkLoc()),
    ], mkLoc());
    const user = EntityDecl('User', [], mkLoc());
    // via references 'assignee' which does not exist on Task
    const rel = RelationDecl('Task', 'User', { via: { name: 'assignee' } }, mkLoc());
    const ast = Program([task, user, rel], [], mkLoc());
    const errors = validate(ast);
    const viaErrors = errors.filter(e => e.rule === 'missing_via_field');
    assert.strictEqual(viaErrors.length, 1);
    assert.ok(viaErrors[0].message.includes('assignee'));
  });

  // -------------------------------------------------------------------------
  // Test 7: Valid via field passes
  // -------------------------------------------------------------------------

  it('valid via field passes validation', () => {
    const task = EntityDecl('Task', [
      FieldDecl('assignee', { fieldType: TypeExpression('reference', 'string', null, mkLoc()) }, mkLoc()),
    ], mkLoc());
    const user = EntityDecl('User', [], mkLoc());
    const rel = RelationDecl('Task', 'User', { via: { name: 'assignee' } }, mkLoc());
    const ast = Program([task, user, rel], [], mkLoc());
    const errors = validate(ast);
    const viaErrors = errors.filter(e => e.rule === 'missing_via_field');
    assert.strictEqual(viaErrors.length, 0);
  });

  // -------------------------------------------------------------------------
  // Test 8: Invalid cardinality (min > max) produces error
  // -------------------------------------------------------------------------

  it('invalid cardinality min > max produces invalid_cardinality error', () => {
    const user = EntityDecl('User', [], mkLoc());
    const task = EntityDecl('Task', [], mkLoc());
    const card = Cardinality(5, 2, '5..2', mkLoc());
    const rel = RelationDecl('Task', 'User', { cardinality: card }, mkLoc());
    const ast = Program([task, user, rel], [], mkLoc());
    const errors = validate(ast);
    const cardErrors = errors.filter(e => e.rule === 'invalid_cardinality');
    assert.strictEqual(cardErrors.length, 1);
    assert.ok(cardErrors[0].message.includes('min'));
  });

  // -------------------------------------------------------------------------
  // Test 9: Valid cardinality passes
  // -------------------------------------------------------------------------

  it('valid cardinality passes validation', () => {
    const user = EntityDecl('User', [], mkLoc());
    const task = EntityDecl('Task', [], mkLoc());
    const card = Cardinality(0, 10, '0..10', mkLoc());
    const rel = RelationDecl('Task', 'User', { cardinality: card }, mkLoc());
    const ast = Program([task, user, rel], [], mkLoc());
    const errors = validate(ast);
    const cardErrors = errors.filter(e => e.rule === 'invalid_cardinality');
    assert.strictEqual(cardErrors.length, 0);
  });

  // -------------------------------------------------------------------------
  // Test 10: Checkpoint with invalid state produces error
  // -------------------------------------------------------------------------

  it('checkpoint with invalid fromState produces invalid_checkpoint_state error', () => {
    // State enum has 'open' and 'closed'
    const stateType = TypeExpression('enum', null, ['open', 'closed'], mkLoc());
    const cp = CheckpointEntry('pending', 'closed', null, mkLoc()); // 'pending' not in enum
    const structure = StructureDecl('Project', {
      state: stateType,
      checkpoints: [cp],
    }, mkLoc());
    const ast = Program([structure], [], mkLoc());
    const errors = validate(ast);
    const cpErrors = errors.filter(e => e.rule === 'invalid_checkpoint_state');
    assert.strictEqual(cpErrors.length, 1);
    assert.ok(cpErrors[0].message.includes('pending'));
  });

  // -------------------------------------------------------------------------
  // Test 11: Valid checkpoint passes
  // -------------------------------------------------------------------------

  it('valid checkpoint with correct states passes validation', () => {
    const stateType = TypeExpression('enum', null, ['open', 'closed'], mkLoc());
    const cp = CheckpointEntry('open', 'closed', null, mkLoc());
    const structure = StructureDecl('Project', {
      state: stateType,
      checkpoints: [cp],
    }, mkLoc());
    const ast = Program([structure], [], mkLoc());
    const errors = validate(ast);
    const cpErrors = errors.filter(e => e.rule === 'invalid_checkpoint_state');
    assert.strictEqual(cpErrors.length, 0);
  });

  // -------------------------------------------------------------------------
  // Test 12: Cycle detection -- circular relations with no_cycles constraint
  // -------------------------------------------------------------------------

  it('cycle in relations with no_cycles constraint produces cycle_in_relations error', () => {
    const a = EntityDecl('A', [], mkLoc());
    const b = EntityDecl('B', [], mkLoc());
    const c = EntityDecl('C', [], mkLoc());
    // A -> B -> C -> A (cycle)
    const r1 = RelationDecl('A', 'B', { constraints: ['no_cycles'] }, mkLoc());
    const r2 = RelationDecl('B', 'C', { constraints: ['no_cycles'] }, mkLoc());
    const r3 = RelationDecl('C', 'A', { constraints: ['no_cycles'] }, mkLoc());
    const ast = Program([a, b, c, r1, r2, r3], [], mkLoc());
    const errors = validate(ast);
    const cycleErrors = errors.filter(e => e.rule === 'cycle_in_relations');
    assert.ok(cycleErrors.length >= 1, 'Expected at least one cycle error');
  });

  // -------------------------------------------------------------------------
  // Test 13: Acyclic relations with no_cycles constraint pass
  // -------------------------------------------------------------------------

  it('acyclic relations with no_cycles constraint pass validation', () => {
    const a = EntityDecl('A', [], mkLoc());
    const b = EntityDecl('B', [], mkLoc());
    const c = EntityDecl('C', [], mkLoc());
    // A -> B -> C (no cycle)
    const r1 = RelationDecl('A', 'B', { constraints: ['no_cycles'] }, mkLoc());
    const r2 = RelationDecl('B', 'C', { constraints: ['no_cycles'] }, mkLoc());
    const ast = Program([a, b, c, r1, r2], [], mkLoc());
    const errors = validate(ast);
    const cycleErrors = errors.filter(e => e.rule === 'cycle_in_relations');
    assert.strictEqual(cycleErrors.length, 0);
  });

  // -------------------------------------------------------------------------
  // Test 14: Containment referencing unknown entity produces error
  // -------------------------------------------------------------------------

  it('containment referencing unknown entity produces unknown_containment_type error', () => {
    const structure = StructureDecl('Sprint', {
      contains: [
        ContainmentEntry('.tasks', 'GhostTask', null, mkLoc()),
      ],
    }, mkLoc());
    const ast = Program([structure], [], mkLoc());
    const errors = validate(ast);
    const containErrors = errors.filter(e => e.rule === 'unknown_containment_type');
    assert.strictEqual(containErrors.length, 1);
    assert.ok(containErrors[0].message.includes('GhostTask'));
  });

  // -------------------------------------------------------------------------
  // Test 15: Enum field types pass validation (no reference check)
  // -------------------------------------------------------------------------

  it('enum field types pass validation without reference check', () => {
    const entity = EntityDecl('Task', [
      FieldDecl('status', {
        fieldType: TypeExpression('enum', null, ['open', 'closed', 'archived'], mkLoc()),
      }, mkLoc()),
    ], mkLoc());
    const ast = Program([entity], [], mkLoc());
    const errors = validate(ast);
    assert.strictEqual(errors.length, 0);
  });
});
