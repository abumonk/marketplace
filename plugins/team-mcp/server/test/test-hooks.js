/**
 * Unit tests for lib/tools/hooks.js
 *
 * Tests the matchHook() and validateHookRule() exported helper functions
 * and the hooks merge logic.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchHook, validateHookRule } from '../lib/tools/hooks.js';

// ---------------------------------------------------------------------------
// matchHook
// ---------------------------------------------------------------------------

test('matchHook: matches when event type matches and no matcher fields', () => {
  const hook = { event: 'PreToolUse', enabled: true, action: 'log', mode: 'always', matcher: {} };
  assert.ok(matchHook(hook, 'PreToolUse', { tool: 'Write' }));
});

test('matchHook: does not match when event type differs', () => {
  const hook = { event: 'SubagentStop', enabled: true, action: 'log', mode: 'always', matcher: {} };
  assert.ok(!matchHook(hook, 'PreToolUse', { tool: 'Write' }));
});

test('matchHook: missing matcher field matches all (wildcard behavior)', () => {
  const hook = { event: 'PreToolUse', enabled: true, action: 'block', mode: 'enforce', matcher: {} };
  assert.ok(matchHook(hook, 'PreToolUse', { tool: 'Bash', role: 'coder', stage: 'implementing' }));
});

test('matchHook: ["*"] in matcher field matches all roles', () => {
  const hook = { event: 'SubagentStop', enabled: true, action: 'log', mode: 'always', matcher: { roles: ['*'] } };
  assert.ok(matchHook(hook, 'SubagentStop', { role: 'planner' }));
  assert.ok(matchHook(hook, 'SubagentStop', { role: 'coder' }));
});

test('matchHook: matcher.tools filters correctly', () => {
  const hook = { event: 'PreToolUse', enabled: true, action: 'block', mode: 'enforce', matcher: { tools: ['Write', 'Edit'] } };
  assert.ok(matchHook(hook, 'PreToolUse', { tool: 'Write' }));
  assert.ok(matchHook(hook, 'PreToolUse', { tool: 'Edit' }));
  assert.ok(!matchHook(hook, 'PreToolUse', { tool: 'Bash' }));
});

test('matchHook: matcher.roles filters correctly', () => {
  const hook = { event: 'SubagentStop', enabled: true, action: 'notify', mode: 'advisory', matcher: { roles: ['coder', 'reviewer'] } };
  assert.ok(matchHook(hook, 'SubagentStop', { role: 'coder' }));
  assert.ok(!matchHook(hook, 'SubagentStop', { role: 'planner' }));
});

test('matchHook: matcher.from and .to for StageTransition', () => {
  const hook = { event: 'StageTransition', enabled: true, action: 'check', mode: 'enforce', matcher: { from: 'implementing', to: 'reviewing' } };
  assert.ok(matchHook(hook, 'StageTransition', { from: 'implementing', to: 'reviewing' }));
  assert.ok(!matchHook(hook, 'StageTransition', { from: 'reviewing', to: 'fixing' }));
});

test('matchHook: disabled hooks are skipped', () => {
  const hook = { event: 'PreToolUse', enabled: false, action: 'log', mode: 'always', matcher: {} };
  assert.ok(!matchHook(hook, 'PreToolUse', { tool: 'Write' }));
});

test('matchHook: hook with undefined enabled is treated as enabled', () => {
  const hook = { event: 'PreToolUse', action: 'log', mode: 'always', matcher: {} };
  assert.ok(matchHook(hook, 'PreToolUse', { tool: 'Write' }));
});

test('matchHook: matcher.tags filters by tag inclusion', () => {
  const hook = { event: 'TaskCompleted', enabled: true, action: 'notify', mode: 'advisory', matcher: { tags: ['adventure'] } };
  assert.ok(matchHook(hook, 'TaskCompleted', { tags: ['adventure', 'backend'] }));
  assert.ok(!matchHook(hook, 'TaskCompleted', { tags: ['backend'] }));
});

// ---------------------------------------------------------------------------
// validateHookRule
// ---------------------------------------------------------------------------

test('validateHookRule: rejects invalid event type', () => {
  const err = validateHookRule({ id: 'test', event: 'InvalidEvent', action: 'log', mode: 'always' });
  assert.ok(err !== null);
  assert.ok(err.includes('event'));
});

test('validateHookRule: rejects invalid action type', () => {
  const err = validateHookRule({ id: 'test', event: 'PreToolUse', action: 'explode', mode: 'always' });
  assert.ok(err !== null);
  assert.ok(err.includes('action'));
});

test('validateHookRule: rejects invalid mode', () => {
  const err = validateHookRule({ id: 'test', event: 'PreToolUse', action: 'log', mode: 'mandatory' });
  assert.ok(err !== null);
  assert.ok(err.includes('mode'));
});

test('validateHookRule: rejects missing id', () => {
  const err = validateHookRule({ event: 'PreToolUse', action: 'log', mode: 'always' });
  assert.ok(err !== null);
  assert.ok(err.includes('id'));
});

test('validateHookRule: accepts valid rule', () => {
  const err = validateHookRule({ id: 'my-hook', event: 'SubagentStop', action: 'log', mode: 'always' });
  assert.equal(err, null);
});

// ---------------------------------------------------------------------------
// hooks_set merge logic (pure, no file I/O)
// ---------------------------------------------------------------------------

test('hooks merge: replaces hook with matching id', () => {
  const existing = [
    { id: 'hook-a', event: 'PreToolUse', action: 'log', mode: 'always', enabled: true },
    { id: 'hook-b', event: 'SubagentStop', action: 'log', mode: 'always', enabled: true },
  ];
  const incoming = [{ id: 'hook-a', event: 'PreToolUse', action: 'block', mode: 'enforce', enabled: true }];

  for (const rule of incoming) {
    const idx = existing.findIndex((h) => h.id === rule.id);
    if (idx >= 0) existing[idx] = rule;
    else existing.push(rule);
  }

  assert.equal(existing.length, 2);
  assert.equal(existing[0].action, 'block');
  assert.equal(existing[0].mode, 'enforce');
});

test('hooks merge: appends hook with new id', () => {
  const existing = [{ id: 'hook-a', event: 'PreToolUse', action: 'log', mode: 'always', enabled: true }];
  const incoming = [{ id: 'hook-c', event: 'TaskCompleted', action: 'notify', mode: 'advisory', enabled: true }];

  for (const rule of incoming) {
    const idx = existing.findIndex((h) => h.id === rule.id);
    if (idx >= 0) existing[idx] = rule;
    else existing.push(rule);
  }

  assert.equal(existing.length, 2);
  assert.equal(existing[1].id, 'hook-c');
});
