'use strict';

// ---------------------------------------------------------------------------
// editor.js -- PDSL AST Edit Commands
//
// Exports:
//   EditCommand           -- frozen object with command type constants
//   addFieldCommand(entityName, fieldName, fieldType)
//   removeFieldCommand(entityName, fieldName)
//   renameEntityCommand(oldName, newName)
//   applyEdit(ast, command) -- returns new Program AST with edit applied
//
// applyEdit() is immutable: it returns a new Program AST (shallow-cloned body
// array, modified entity deep-copied) and does NOT mutate the input.
// ---------------------------------------------------------------------------

const { EntityDecl, FieldDecl, TypeExpression, Program } = require('./ast');

// ---------------------------------------------------------------------------
// EditCommand type constants
// ---------------------------------------------------------------------------

const EditCommand = Object.freeze({
  ADD_FIELD:     'addField',
  REMOVE_FIELD:  'removeField',
  RENAME_ENTITY: 'renameEntity',
});

// ---------------------------------------------------------------------------
// Command factory functions
// ---------------------------------------------------------------------------

/**
 * Create an addField command.
 * @param {string} entityName  -- name of target entity
 * @param {string} fieldName   -- name of new field
 * @param {string} fieldType   -- type string (e.g. 'string', 'number', 'Task')
 * @returns {object}
 */
function addFieldCommand(entityName, fieldName, fieldType) {
  return { type: EditCommand.ADD_FIELD, entityName, fieldName, fieldType };
}

/**
 * Create a removeField command.
 * @param {string} entityName  -- name of target entity
 * @param {string} fieldName   -- name of field to remove
 * @returns {object}
 */
function removeFieldCommand(entityName, fieldName) {
  return { type: EditCommand.REMOVE_FIELD, entityName, fieldName };
}

/**
 * Create a renameEntity command.
 * @param {string} oldName  -- current entity name
 * @param {string} newName  -- desired new entity name
 * @returns {object}
 */
function renameEntityCommand(oldName, newName) {
  return { type: EditCommand.RENAME_ENTITY, oldName, newName };
}

// ---------------------------------------------------------------------------
// applyEdit(ast, command) -- main entry point
// ---------------------------------------------------------------------------

/**
 * Apply an edit command to a Program AST.
 * Returns a new Program AST with the edit applied.
 * Does NOT mutate the input ast.
 *
 * @param {object} ast      -- Program node from parse()
 * @param {object} command  -- command object from a factory function
 * @returns {object}        -- new Program AST
 * @throws {Error}          -- if entity not found
 */
function applyEdit(ast, command) {
  if (!ast || !Array.isArray(ast.body)) {
    throw new Error('applyEdit: ast must be a Program node with a body array');
  }
  if (!command || !command.type) {
    throw new Error('applyEdit: command must have a type property');
  }

  switch (command.type) {
    case EditCommand.ADD_FIELD:
      return applyAddField(ast, command);
    case EditCommand.REMOVE_FIELD:
      return applyRemoveField(ast, command);
    case EditCommand.RENAME_ENTITY:
      return applyRenameEntity(ast, command);
    default:
      throw new Error(`applyEdit: unknown command type '${command.type}'`);
  }
}

// ---------------------------------------------------------------------------
// Command implementations
// ---------------------------------------------------------------------------

function applyAddField(ast, command) {
  const { entityName, fieldName, fieldType } = command;

  // Find the target entity
  const entityIndex = ast.body.findIndex(
    node => node && node.type === 'Entity' && node.name === entityName
  );
  if (entityIndex === -1) {
    throw new Error(`applyEdit addField: entity '${entityName}' not found`);
  }

  const entity = ast.body[entityIndex];

  // Build new FieldDecl
  const newField = FieldDecl(fieldName, {
    fieldType: TypeExpression('reference', fieldType, null, null),
    optional:  false,
    defaultValue: null,
    pattern:   null,
    cardinality: null,
  }, null);

  // Deep copy entity with new field appended
  const updatedEntity = EntityDecl(
    entity.name,
    [...(Array.isArray(entity.fields) ? entity.fields : []), newField],
    entity.loc
  );

  // Shallow copy body, replacing the entity
  const newBody = ast.body.slice();
  newBody[entityIndex] = updatedEntity;

  return Program(newBody, ast.comments || [], ast.loc);
}

function applyRemoveField(ast, command) {
  const { entityName, fieldName } = command;

  // Find the target entity
  const entityIndex = ast.body.findIndex(
    node => node && node.type === 'Entity' && node.name === entityName
  );
  if (entityIndex === -1) {
    throw new Error(`applyEdit removeField: entity '${entityName}' not found`);
  }

  const entity = ast.body[entityIndex];

  // Filter out the named field
  const updatedFields = (Array.isArray(entity.fields) ? entity.fields : []).filter(
    f => f && f.name !== fieldName
  );

  // Deep copy entity with field removed
  const updatedEntity = EntityDecl(entity.name, updatedFields, entity.loc);

  // Shallow copy body, replacing the entity
  const newBody = ast.body.slice();
  newBody[entityIndex] = updatedEntity;

  return Program(newBody, ast.comments || [], ast.loc);
}

function applyRenameEntity(ast, command) {
  const { oldName, newName } = command;

  // Find the target entity
  const entityIndex = ast.body.findIndex(
    node => node && node.type === 'Entity' && node.name === oldName
  );
  if (entityIndex === -1) {
    throw new Error(`applyEdit renameEntity: entity '${oldName}' not found`);
  }

  const entity = ast.body[entityIndex];

  // Rename the entity
  const updatedEntity = EntityDecl(newName, entity.fields || [], entity.loc);

  // Update all RelationDecl nodes where source or target matches oldName
  const newBody = ast.body.slice();
  newBody[entityIndex] = updatedEntity;

  for (let i = 0; i < newBody.length; i++) {
    const node = newBody[i];
    if (!node || node.type !== 'Relation') continue;

    let needsUpdate = false;
    const updatedSource = node.source === oldName ? newName : node.source;
    const updatedTarget = node.target === oldName ? newName : node.target;

    if (updatedSource !== node.source || updatedTarget !== node.target) {
      needsUpdate = true;
    }

    if (needsUpdate) {
      // Shallow copy the relation with updated source/target
      newBody[i] = Object.assign({}, node, {
        source: updatedSource,
        target: updatedTarget,
      });
    }
  }

  return Program(newBody, ast.comments || [], ast.loc);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  EditCommand,
  addFieldCommand,
  removeFieldCommand,
  renameEntityCommand,
  applyEdit,
};
