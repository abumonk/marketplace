/**
 * Unit tests for lib/errors.js
 *
 * Verifies each error constructor returns a properly structured MCP error
 * response: { isError: true, content: [{ type: 'text', text: <JSON> }] }
 * where the JSON body contains { error: <code>, message: <string> }.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  VALIDATION_ERROR,
  NOT_FOUND,
  LOCK_CONFLICT,
  INTERNAL_ERROR,
} from '../lib/errors.js';

// ---------------------------------------------------------------------------
// Shared structural checks
// ---------------------------------------------------------------------------

/**
 * Assert that `response` has the canonical MCP error shape.
 * Returns the parsed body { error, message }.
 */
function assertErrorShape(response) {
  assert.equal(response.isError, true, 'isError must be true');
  assert.ok(Array.isArray(response.content), 'content must be an array');
  assert.equal(response.content.length, 1, 'content must have one entry');

  const item = response.content[0];
  assert.equal(item.type, 'text', 'content item type must be "text"');
  assert.ok(typeof item.text === 'string', 'content item text must be a string');

  const body = JSON.parse(item.text);
  assert.ok(typeof body.error === 'string', 'body.error must be a string');
  assert.ok(typeof body.message === 'string', 'body.message must be a string');

  return body;
}

// ---------------------------------------------------------------------------
// VALIDATION_ERROR
// ---------------------------------------------------------------------------

test('VALIDATION_ERROR: has isError: true', () => {
  const res = VALIDATION_ERROR('field is required');
  assert.equal(res.isError, true);
});

test('VALIDATION_ERROR: has correct content structure', () => {
  const res = VALIDATION_ERROR('field is required');
  const body = assertErrorShape(res);
  assert.equal(body.error, 'VALIDATION_ERROR');
  assert.equal(body.message, 'field is required');
});

test('VALIDATION_ERROR: message is preserved verbatim', () => {
  const msg = 'Missing required field: id; Invalid stage: unknown';
  const res = VALIDATION_ERROR(msg);
  const body = JSON.parse(res.content[0].text);
  assert.equal(body.message, msg);
});

// ---------------------------------------------------------------------------
// NOT_FOUND
// ---------------------------------------------------------------------------

test('NOT_FOUND: has isError: true', () => {
  const res = NOT_FOUND('Task TASK-999 not found');
  assert.equal(res.isError, true);
});

test('NOT_FOUND: has correct content structure', () => {
  const res = NOT_FOUND('Task TASK-999 not found');
  const body = assertErrorShape(res);
  assert.equal(body.error, 'NOT_FOUND');
  assert.equal(body.message, 'Task TASK-999 not found');
});

test('NOT_FOUND: error code is NOT_FOUND', () => {
  const res = NOT_FOUND('something missing');
  const body = JSON.parse(res.content[0].text);
  assert.equal(body.error, 'NOT_FOUND');
});

// ---------------------------------------------------------------------------
// LOCK_CONFLICT
// ---------------------------------------------------------------------------

test('LOCK_CONFLICT: has isError: true', () => {
  const res = LOCK_CONFLICT('Resource locked by session-A');
  assert.equal(res.isError, true);
});

test('LOCK_CONFLICT: has correct content structure', () => {
  const res = LOCK_CONFLICT('Resource locked by session-A');
  const body = assertErrorShape(res);
  assert.equal(body.error, 'LOCK_CONFLICT');
  assert.equal(body.message, 'Resource locked by session-A');
});

test('LOCK_CONFLICT: error code is LOCK_CONFLICT', () => {
  const res = LOCK_CONFLICT('locked');
  const body = JSON.parse(res.content[0].text);
  assert.equal(body.error, 'LOCK_CONFLICT');
});

// ---------------------------------------------------------------------------
// INTERNAL_ERROR
// ---------------------------------------------------------------------------

test('INTERNAL_ERROR: has isError: true', () => {
  const res = INTERNAL_ERROR('Unexpected failure');
  assert.equal(res.isError, true);
});

test('INTERNAL_ERROR: has correct content structure', () => {
  const res = INTERNAL_ERROR('Unexpected failure');
  const body = assertErrorShape(res);
  assert.equal(body.error, 'INTERNAL_ERROR');
  assert.equal(body.message, 'Unexpected failure');
});

test('INTERNAL_ERROR: error code is INTERNAL_ERROR', () => {
  const res = INTERNAL_ERROR('boom');
  const body = JSON.parse(res.content[0].text);
  assert.equal(body.error, 'INTERNAL_ERROR');
});

// ---------------------------------------------------------------------------
// General: all constructors produce independent objects
// ---------------------------------------------------------------------------

test('each error constructor returns a new object each call', () => {
  const r1 = VALIDATION_ERROR('msg');
  const r2 = VALIDATION_ERROR('msg');
  assert.notEqual(r1, r2); // different object references
  assert.notEqual(r1.content, r2.content);
});

test('errors with different codes have different error field values', () => {
  const codes = [
    JSON.parse(VALIDATION_ERROR('x').content[0].text).error,
    JSON.parse(NOT_FOUND('x').content[0].text).error,
    JSON.parse(LOCK_CONFLICT('x').content[0].text).error,
    JSON.parse(INTERNAL_ERROR('x').content[0].text).error,
  ];
  const unique = new Set(codes);
  assert.equal(unique.size, 4, 'all error codes should be distinct');
});
