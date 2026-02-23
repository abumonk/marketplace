/**
 * Unit tests for lib/state.js
 *
 * Covers:
 *   - parseFrontmatter / serializeFrontmatter roundtrip
 *   - deepMerge behavior
 *   - LockManager: acquire, release, re-entrant, TTL expiry, concurrent rejection
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontmatter, serializeFrontmatter, deepMerge, LockManager } from '../lib/state.js';

// ---------------------------------------------------------------------------
// parseFrontmatter
// ---------------------------------------------------------------------------

test('parseFrontmatter: parses valid YAML frontmatter', () => {
  const content = `---
id: TASK-001
title: Test task
stage: planning
---
## Body

Some content here.
`;
  const { frontmatter, body } = parseFrontmatter(content);
  assert.equal(frontmatter.id, 'TASK-001');
  assert.equal(frontmatter.title, 'Test task');
  assert.equal(frontmatter.stage, 'planning');
  assert.ok(body.includes('## Body'));
});

test('parseFrontmatter: returns empty frontmatter when no YAML block', () => {
  const content = 'Just plain text content';
  const { frontmatter, body } = parseFrontmatter(content);
  assert.deepEqual(frontmatter, {});
  assert.equal(body, 'Just plain text content');
});

test('parseFrontmatter: handles empty body after frontmatter', () => {
  const content = `---
id: TASK-001
---
`;
  const { frontmatter, body } = parseFrontmatter(content);
  assert.equal(frontmatter.id, 'TASK-001');
  // body may be empty or just a newline
  assert.ok(typeof body === 'string');
});

test('parseFrontmatter: handles arrays in frontmatter', () => {
  const content = `---
tags:
  - alpha
  - beta
---
body
`;
  const { frontmatter } = parseFrontmatter(content);
  assert.deepEqual(frontmatter.tags, ['alpha', 'beta']);
});

// ---------------------------------------------------------------------------
// serializeFrontmatter
// ---------------------------------------------------------------------------

test('serializeFrontmatter: produces valid YAML block', () => {
  const frontmatter = { id: 'TASK-001', title: 'Test', stage: 'planning' };
  const body = '## Body\n\nContent\n';
  const result = serializeFrontmatter(frontmatter, body);
  assert.ok(result.startsWith('---\n'));
  assert.ok(result.includes('id: TASK-001'));
  assert.ok(result.includes('## Body'));
});

// ---------------------------------------------------------------------------
// parseFrontmatter / serializeFrontmatter roundtrip
// ---------------------------------------------------------------------------

test('parseFrontmatter/serializeFrontmatter: roundtrip preserves data', () => {
  const originalFrontmatter = {
    id: 'TASK-001',
    title: 'Roundtrip test',
    stage: 'implementing',
    status: 'in_progress',
    iterations: 2,
    tags: ['alpha', 'beta'],
    files: ['src/foo.js'],
  };
  const originalBody = '## Description\n\nSome content.\n';

  const serialized = serializeFrontmatter(originalFrontmatter, originalBody);
  const { frontmatter, body } = parseFrontmatter(serialized);

  assert.equal(frontmatter.id, originalFrontmatter.id);
  assert.equal(frontmatter.title, originalFrontmatter.title);
  assert.equal(frontmatter.stage, originalFrontmatter.stage);
  assert.equal(frontmatter.status, originalFrontmatter.status);
  assert.equal(frontmatter.iterations, originalFrontmatter.iterations);
  assert.deepEqual(frontmatter.tags, originalFrontmatter.tags);
  assert.deepEqual(frontmatter.files, originalFrontmatter.files);
  assert.ok(body.includes('## Description'));
});

// ---------------------------------------------------------------------------
// deepMerge
// ---------------------------------------------------------------------------

test('deepMerge: merges flat objects', () => {
  const target = { a: 1, b: 2 };
  const source = { b: 3, c: 4 };
  const result = deepMerge(target, source);
  assert.equal(result.a, 1);
  assert.equal(result.b, 3); // overwritten
  assert.equal(result.c, 4); // added
});

test('deepMerge: deep-merges nested objects', () => {
  const target = { a: { x: 1, y: 2 }, b: 'hello' };
  const source = { a: { y: 99, z: 3 } };
  const result = deepMerge(target, source);
  assert.equal(result.a.x, 1);  // preserved
  assert.equal(result.a.y, 99); // overwritten
  assert.equal(result.a.z, 3);  // added
  assert.equal(result.b, 'hello'); // unchanged
});

test('deepMerge: replaces arrays rather than merging', () => {
  const target = { tags: ['a', 'b'] };
  const source = { tags: ['c'] };
  const result = deepMerge(target, source);
  assert.deepEqual(result.tags, ['c']); // replaced, not concatenated
});

test('deepMerge: does not mutate target', () => {
  const target = { a: 1, nested: { x: 1 } };
  const source = { nested: { y: 2 } };
  deepMerge(target, source);
  assert.equal(target.nested.y, undefined); // original not modified
});

test('deepMerge: handles null source values', () => {
  const target = { a: 1 };
  const source = { a: null };
  const result = deepMerge(target, source);
  assert.equal(result.a, null);
});

test('deepMerge: source object wins over target primitive for same key', () => {
  const target = { a: 'string' };
  const source = { a: { nested: true } };
  const result = deepMerge(target, source);
  assert.deepEqual(result.a, { nested: true });
});

// ---------------------------------------------------------------------------
// LockManager
// ---------------------------------------------------------------------------

test('LockManager: acquire returns acquired:true on first call', () => {
  const lm = new LockManager();
  const result = lm.acquire('TASK-001', 'session-A');
  assert.equal(result.acquired, true);
});

test('LockManager: re-entrant acquire by same session returns acquired:true', () => {
  const lm = new LockManager();
  lm.acquire('TASK-001', 'session-A');
  const result = lm.acquire('TASK-001', 'session-A');
  assert.equal(result.acquired, true);
});

test('LockManager: concurrent acquire by different session returns acquired:false', () => {
  const lm = new LockManager();
  lm.acquire('TASK-001', 'session-A');
  const result = lm.acquire('TASK-001', 'session-B');
  assert.equal(result.acquired, false);
  assert.equal(result.holder, 'session-A');
  assert.ok(typeof result.expiresIn === 'number');
  assert.ok(result.expiresIn > 0);
});

test('LockManager: release removes lock, allows re-acquire by other session', () => {
  const lm = new LockManager();
  lm.acquire('TASK-001', 'session-A');
  const rel = lm.release('TASK-001', 'session-A');
  assert.equal(rel.released, true);

  const reAcquire = lm.acquire('TASK-001', 'session-B');
  assert.equal(reAcquire.acquired, true);
});

test('LockManager: release by wrong session returns released:false', () => {
  const lm = new LockManager();
  lm.acquire('TASK-001', 'session-A');
  const result = lm.release('TASK-001', 'session-B');
  assert.equal(result.released, false);
  assert.ok(result.reason.includes('session-A'));
});

test('LockManager: release of non-existent lock returns released:true', () => {
  const lm = new LockManager();
  const result = lm.release('TASK-999', 'session-A');
  assert.equal(result.released, true);
});

test('LockManager: isLocked returns false before acquire', () => {
  const lm = new LockManager();
  assert.equal(lm.isLocked('TASK-001'), false);
});

test('LockManager: isLocked returns true after acquire', () => {
  const lm = new LockManager();
  lm.acquire('TASK-001', 'session-A');
  assert.equal(lm.isLocked('TASK-001'), true);
});

test('LockManager: isLocked returns false after release', () => {
  const lm = new LockManager();
  lm.acquire('TASK-001', 'session-A');
  lm.release('TASK-001', 'session-A');
  assert.equal(lm.isLocked('TASK-001'), false);
});

test('LockManager: expired lock allows new acquire (TTL)', async () => {
  // Use very short TTL to test expiry without long waits
  const lm = new LockManager({ ttlMs: 10 });
  lm.acquire('TASK-001', 'session-A');

  // Wait for TTL to expire
  await new Promise((resolve) => setTimeout(resolve, 20));

  // session-B should now be able to acquire
  const result = lm.acquire('TASK-001', 'session-B');
  assert.equal(result.acquired, true);
});

test('LockManager: locks are independent per resource', () => {
  const lm = new LockManager();
  lm.acquire('TASK-001', 'session-A');
  lm.acquire('TASK-002', 'session-B');

  // session-B blocked from TASK-001
  const r1 = lm.acquire('TASK-001', 'session-B');
  assert.equal(r1.acquired, false);

  // session-A blocked from TASK-002
  const r2 = lm.acquire('TASK-002', 'session-A');
  assert.equal(r2.acquired, false);

  // Each session can access their own resource
  const r3 = lm.acquire('TASK-001', 'session-A');
  assert.equal(r3.acquired, true);

  const r4 = lm.acquire('TASK-002', 'session-B');
  assert.equal(r4.acquired, true);
});
