/**
 * Unit tests for lib/events.js
 *
 * Covers:
 *   - Ring buffer: stores up to 50 events, evicts oldest on overflow
 *   - emit: constructs correct event envelope (type, timestamp, task_id, data)
 *   - getEvents: returns events in chronological order (oldest first)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from '../lib/events.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a fresh EventEmitter with no server reference.
 * The emit() method gracefully skips lead-state.md writing and MCP
 * notifications when no server / no .agent/ dir is available, so tests
 * that only inspect the in-memory buffer work without any filesystem setup.
 */
function makeEmitter() {
  return new EventEmitter();
}

// ---------------------------------------------------------------------------
// emit: envelope structure
// ---------------------------------------------------------------------------

test('emit: returns event with correct type', async () => {
  const em = makeEmitter();
  const event = await em.emit('task.created', 'TASK-001', { title: 'Test' });
  assert.equal(event.type, 'task.created');
});

test('emit: returns event with ISO timestamp', async () => {
  const em = makeEmitter();
  const event = await em.emit('task.created', 'TASK-001', {});
  assert.ok(typeof event.timestamp === 'string');
  // Should parse as a valid date
  assert.ok(!isNaN(new Date(event.timestamp).getTime()));
});

test('emit: returns event with task_id when provided', async () => {
  const em = makeEmitter();
  const event = await em.emit('task.advanced', 'TASK-042', { from_stage: 'planning' });
  assert.equal(event.task_id, 'TASK-042');
});

test('emit: omits task_id when null', async () => {
  const em = makeEmitter();
  const event = await em.emit('pipeline.started', null, {});
  assert.equal(event.task_id, undefined);
});

test('emit: includes data payload in event', async () => {
  const em = makeEmitter();
  const event = await em.emit('task.created', 'TASK-001', {
    title: 'Hello',
    assignee: 'planner',
  });
  assert.equal(event.data.title, 'Hello');
  assert.equal(event.data.assignee, 'planner');
});

test('emit: defaults to empty data object when data is not provided', async () => {
  const em = makeEmitter();
  // Call with only type and taskId (no data arg)
  const event = await em.emit('task.completed', 'TASK-001');
  assert.deepEqual(event.data, {});
});

// ---------------------------------------------------------------------------
// Ring buffer: capacity and eviction
// ---------------------------------------------------------------------------

test('ring buffer: stores single event', async () => {
  const em = makeEmitter();
  await em.emit('task.created', 'TASK-001', {});
  const events = em.getEvents();
  assert.equal(events.length, 1);
});

test('ring buffer: stores multiple events in order', async () => {
  const em = makeEmitter();
  await em.emit('task.created', 'TASK-001', { seq: 1 });
  await em.emit('task.advanced', 'TASK-001', { seq: 2 });
  await em.emit('task.completed', 'TASK-001', { seq: 3 });

  const events = em.getEvents();
  assert.equal(events.length, 3);
  assert.equal(events[0].type, 'task.created');
  assert.equal(events[2].type, 'task.completed');
});

test('ring buffer: stores up to 50 events without eviction', async () => {
  const em = makeEmitter();
  for (let i = 0; i < 50; i++) {
    await em.emit('task.created', `TASK-${i}`, { index: i });
  }
  const events = em.getEvents();
  assert.equal(events.length, 50);
});

test('ring buffer: evicts oldest event when 51st is added', async () => {
  const em = makeEmitter();
  // Emit 50 events, first one is type 'marker.first'
  await em.emit('marker.first', 'TASK-000', { index: 0 });
  for (let i = 1; i < 50; i++) {
    await em.emit('task.created', `TASK-${i}`, { index: i });
  }
  // Buffer is now at capacity (50). Add one more.
  await em.emit('marker.last', 'TASK-050', { index: 50 });

  const events = em.getEvents();
  assert.equal(events.length, 50); // still 50
  // The first event (marker.first) should have been evicted
  assert.equal(events[0].type, 'task.created');
  // The last event should be the new one
  assert.equal(events[events.length - 1].type, 'marker.last');
});

test('ring buffer: continues evicting oldest on further overflow', async () => {
  const em = makeEmitter();
  for (let i = 0; i < 60; i++) {
    await em.emit('task.event', `TASK-${i}`, { index: i });
  }
  const events = em.getEvents();
  assert.equal(events.length, 50);
  // First retained event should have index 10
  assert.equal(events[0].data.index, 10);
  // Last retained event should have index 59
  assert.equal(events[49].data.index, 59);
});

// ---------------------------------------------------------------------------
// getEvents: ordering and limit
// ---------------------------------------------------------------------------

test('getEvents: returns events oldest first (chronological order)', async () => {
  const em = makeEmitter();
  const types = ['a', 'b', 'c', 'd'];
  for (const type of types) {
    await em.emit(type, null, {});
  }
  const events = em.getEvents();
  const returnedTypes = events.map((e) => e.type);
  assert.deepEqual(returnedTypes, types);
});

test('getEvents: respects limit parameter', async () => {
  const em = makeEmitter();
  for (let i = 0; i < 10; i++) {
    await em.emit('task.event', `TASK-${i}`, { index: i });
  }
  // Request only 3
  const events = em.getEvents(3);
  assert.equal(events.length, 3);
  // Should be the last 3 (most recent)
  assert.equal(events[0].data.index, 7);
  assert.equal(events[2].data.index, 9);
});

test('getEvents: returns all events when limit exceeds buffer size', async () => {
  const em = makeEmitter();
  for (let i = 0; i < 5; i++) {
    await em.emit('task.event', `TASK-${i}`, {});
  }
  const events = em.getEvents(100);
  assert.equal(events.length, 5);
});

test('getEvents: returns empty array when no events', () => {
  const em = makeEmitter();
  const events = em.getEvents();
  assert.deepEqual(events, []);
});

// ---------------------------------------------------------------------------
// Multiple emitters are independent
// ---------------------------------------------------------------------------

test('independent EventEmitter instances have separate ring buffers', async () => {
  const em1 = makeEmitter();
  const em2 = makeEmitter();

  await em1.emit('event.a', null, {});
  await em2.emit('event.b', null, {});

  const events1 = em1.getEvents();
  const events2 = em2.getEvents();

  assert.equal(events1.length, 1);
  assert.equal(events1[0].type, 'event.a');
  assert.equal(events2.length, 1);
  assert.equal(events2[0].type, 'event.b');
});

// ---------------------------------------------------------------------------
// Subscription lifecycle
// ---------------------------------------------------------------------------

test('subscribe: adds URI to subscriptions set', () => {
  const em = makeEmitter();
  em.subscribe('pipeline://events');
  assert.ok(em.getSubscriptions().has('pipeline://events'));
});

test('subscribe: is idempotent (adding same URI twice keeps one entry)', () => {
  const em = makeEmitter();
  em.subscribe('pipeline://events');
  em.subscribe('pipeline://events');
  assert.equal(em.getSubscriptions().size, 1);
});

test('unsubscribe: removes URI from subscriptions set', () => {
  const em = makeEmitter();
  em.subscribe('pipeline://events');
  em.unsubscribe('pipeline://events');
  assert.ok(!em.getSubscriptions().has('pipeline://events'));
});

test('unsubscribe: on non-subscribed URI is a no-op (no error)', () => {
  const em = makeEmitter();
  // Should not throw
  assert.doesNotThrow(() => em.unsubscribe('pipeline://events'));
  assert.equal(em.getSubscriptions().size, 0);
});

test('getSubscriptions: returns empty set initially', () => {
  const em = makeEmitter();
  assert.equal(em.getSubscriptions().size, 0);
});

// ---------------------------------------------------------------------------
// Subscription + emit integration (mocked server)
// ---------------------------------------------------------------------------

/**
 * Create a mock MCP server with a tracked sendResourceUpdated spy.
 * Returns { mockServer, calls } where calls is an array of URIs passed
 * to sendResourceUpdated.
 */
function makeMockServer() {
  const calls = [];
  const mockServer = {
    server: {
      notification: async () => {},
      sendResourceUpdated: async ({ uri }) => {
        calls.push(uri);
      },
    },
  };
  return { mockServer, calls };
}

test('emit: calls sendResourceUpdated when pipeline://events is subscribed', async () => {
  const em = makeEmitter();
  const { mockServer, calls } = makeMockServer();
  em.setServer(mockServer);
  em.subscribe('pipeline://events');

  await em.emit('task.created', 'TASK-001', {});

  assert.equal(calls.length, 1);
  assert.equal(calls[0], 'pipeline://events');
});

test('emit: does not call sendResourceUpdated when no subscriptions exist', async () => {
  const em = makeEmitter();
  const { mockServer, calls } = makeMockServer();
  em.setServer(mockServer);
  // No subscribe() call

  await em.emit('task.created', 'TASK-001', {});

  assert.equal(calls.length, 0);
});

test('emit: does not call sendResourceUpdated after unsubscribe', async () => {
  const em = makeEmitter();
  const { mockServer, calls } = makeMockServer();
  em.setServer(mockServer);
  em.subscribe('pipeline://events');
  em.unsubscribe('pipeline://events');

  await em.emit('task.created', 'TASK-001', {});

  assert.equal(calls.length, 0);
});

test('emit: calls sendResourceUpdated once per emit when subscribed', async () => {
  const em = makeEmitter();
  const { mockServer, calls } = makeMockServer();
  em.setServer(mockServer);
  em.subscribe('pipeline://events');

  await em.emit('task.created', 'TASK-001', {});
  await em.emit('task.advanced', 'TASK-001', {});
  await em.emit('task.completed', 'TASK-001', {});

  assert.equal(calls.length, 3);
});
