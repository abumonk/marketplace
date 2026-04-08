'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { parse } = require('../parser');
const { serialize } = require('../serializer');
const {
  EditCommand,
  addFieldCommand,
  removeFieldCommand,
  renameEntityCommand,
  applyEdit,
} = require('../editor');

// ---------------------------------------------------------------------------
// Test 1: addField appends a field to the entity
// ---------------------------------------------------------------------------
test('addField appends a field to the entity', () => {
  const src = `entity Foo {\n  id: string\n}`;
  const { ast } = parse(src);

  const cmd = addFieldCommand('Foo', 'title', 'string');
  const newAst = applyEdit(ast, cmd);

  const foo = newAst.body.find(n => n.type === 'Entity' && n.name === 'Foo');
  assert.ok(foo, 'Entity Foo should exist in new AST');
  assert.equal(foo.fields.length, 2, 'Entity should have 2 fields after addField');
  assert.equal(foo.fields[1].name, 'title', 'New field should be named "title"');
  assert.equal(foo.fields[1].fieldType.name, 'string', 'New field type should be "string"');
});

// ---------------------------------------------------------------------------
// Test 2: removeField removes the named field
// ---------------------------------------------------------------------------
test('removeField removes the named field from entity', () => {
  const src = `entity Foo {\n  id: string\n  title: string\n}`;
  const { ast } = parse(src);

  const cmd = removeFieldCommand('Foo', 'id');
  const newAst = applyEdit(ast, cmd);

  const foo = newAst.body.find(n => n.type === 'Entity' && n.name === 'Foo');
  assert.ok(foo, 'Entity Foo should exist in new AST');
  assert.equal(foo.fields.length, 1, 'Entity should have 1 field after removeField');
  assert.equal(foo.fields[0].name, 'title', 'Remaining field should be "title"');

  // Ensure original AST is not mutated
  const origFoo = ast.body.find(n => n.type === 'Entity' && n.name === 'Foo');
  assert.equal(origFoo.fields.length, 2, 'Original entity should still have 2 fields (immutability)');
});

// ---------------------------------------------------------------------------
// Test 3: renameEntity updates the entity name
// ---------------------------------------------------------------------------
test('renameEntity updates entity name', () => {
  const src = `entity Foo {\n  id: string\n}`;
  const { ast } = parse(src);

  const cmd = renameEntityCommand('Foo', 'Bar');
  const newAst = applyEdit(ast, cmd);

  const bar = newAst.body.find(n => n.type === 'Entity' && n.name === 'Bar');
  const foo = newAst.body.find(n => n.type === 'Entity' && n.name === 'Foo');
  assert.ok(bar, 'Entity Bar should exist after rename');
  assert.equal(foo, undefined, 'Entity Foo should no longer exist after rename');

  // Ensure original is not mutated
  const origFoo = ast.body.find(n => n.type === 'Entity' && n.name === 'Foo');
  assert.ok(origFoo, 'Original entity Foo should still exist (immutability)');
});

// ---------------------------------------------------------------------------
// Test 4: renameEntity updates relation source and target references
// ---------------------------------------------------------------------------
test('renameEntity updates relation source and target references', () => {
  const src = [
    'entity Foo {',
    '  id: string',
    '}',
    '',
    'entity Bar {',
    '  id: string',
    '}',
    '',
    'relation Foo -> Bar {',
    '  type: owns',
    '}',
  ].join('\n');

  const { ast } = parse(src);

  const cmd = renameEntityCommand('Foo', 'Baz');
  const newAst = applyEdit(ast, cmd);

  const relations = newAst.body.filter(n => n.type === 'Relation');
  assert.equal(relations.length, 1, 'Should still have one relation');
  assert.equal(relations[0].source, 'Baz', 'Relation source should be updated to Baz');
  assert.equal(relations[0].target, 'Bar', 'Relation target should remain Bar');
});

// ---------------------------------------------------------------------------
// Test 5: addField then serialize round-trips correctly
// ---------------------------------------------------------------------------
test('addField then serialize round-trips to valid PDSL', () => {
  const src = `entity Task {\n  id: string\n}`;
  const { ast } = parse(src);

  const cmd = addFieldCommand('Task', 'status', 'string');
  const newAst = applyEdit(ast, cmd);
  const serialized = serialize(newAst);

  // Re-parse the serialized output
  const { ast: reparsedAst, errors } = parse(serialized);

  assert.equal(errors.length, 0, 'Serialized PDSL should parse without errors');

  const taskEntity = reparsedAst.body.find(n => n.type === 'Entity' && n.name === 'Task');
  assert.ok(taskEntity, 'Task entity should exist in re-parsed AST');
  assert.equal(taskEntity.fields.length, 2, 'Task should have 2 fields after round-trip');

  const statusField = taskEntity.fields.find(f => f.name === 'status');
  assert.ok(statusField, 'status field should exist after round-trip');
  assert.equal(statusField.fieldType.name, 'string', 'status field type should be "string"');
});

// ---------------------------------------------------------------------------
// Test 6: applyEdit throws error when entity is not found
// ---------------------------------------------------------------------------
test('applyEdit throws when entity not found', () => {
  const src = `entity Foo {\n  id: string\n}`;
  const { ast } = parse(src);

  const cmd = addFieldCommand('NonExistent', 'title', 'string');
  assert.throws(
    () => applyEdit(ast, cmd),
    /entity 'NonExistent' not found/,
    'Should throw with descriptive error message'
  );
});

// ---------------------------------------------------------------------------
// Test 7: EditCommand constants have expected values
// ---------------------------------------------------------------------------
test('EditCommand constants have expected values', () => {
  assert.equal(EditCommand.ADD_FIELD,     'addField',     'ADD_FIELD constant');
  assert.equal(EditCommand.REMOVE_FIELD,  'removeField',  'REMOVE_FIELD constant');
  assert.equal(EditCommand.RENAME_ENTITY, 'renameEntity', 'RENAME_ENTITY constant');
});

// ---------------------------------------------------------------------------
// Test 8: applyEdit does not mutate the original AST
// ---------------------------------------------------------------------------
test('applyEdit does not mutate the original AST', () => {
  const src = `entity Foo {\n  id: string\n}`;
  const { ast } = parse(src);

  const origBodyLength = ast.body.length;
  const origFooFieldCount = ast.body.find(n => n.name === 'Foo').fields.length;

  const cmd = addFieldCommand('Foo', 'createdAt', 'string');
  applyEdit(ast, cmd);

  // Original AST should be unchanged
  assert.equal(ast.body.length, origBodyLength, 'Original body length unchanged');
  assert.equal(
    ast.body.find(n => n.name === 'Foo').fields.length,
    origFooFieldCount,
    'Original entity field count unchanged'
  );
});
