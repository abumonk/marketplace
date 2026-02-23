/**
 * Unit tests for lib/schema.js
 *
 * Covers:
 *   - validateTask: valid/invalid frontmatter
 *   - validateTransition: all valid and invalid stage transitions
 *   - getNextStage: all stage/status combos
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateTask,
  validateTransition,
  getNextStage,
  STAGES,
  VALID_TRANSITIONS,
} from '../lib/schema.js';

// ---------------------------------------------------------------------------
// validateTask
// ---------------------------------------------------------------------------

test('validateTask: accepts valid minimal frontmatter', () => {
  const result = validateTask({
    id: 'TASK-001',
    title: 'Test task',
    stage: 'planning',
    status: 'in_progress',
    created: '2026-01-01T00:00:00Z',
    updated: '2026-01-01T00:00:00Z',
  });
  assert.equal(result.valid, true);
});

test('validateTask: rejects missing required field id', () => {
  const result = validateTask({
    title: 'No ID',
    stage: 'planning',
    status: 'in_progress',
    created: '2026-01-01T00:00:00Z',
    updated: '2026-01-01T00:00:00Z',
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('id')));
});

test('validateTask: rejects missing required field title', () => {
  const result = validateTask({
    id: 'TASK-001',
    stage: 'planning',
    status: 'in_progress',
    created: '2026-01-01T00:00:00Z',
    updated: '2026-01-01T00:00:00Z',
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('title')));
});

test('validateTask: rejects invalid stage', () => {
  const result = validateTask({
    id: 'TASK-001',
    title: 'Test',
    stage: 'unknown_stage',
    status: 'in_progress',
    created: '2026-01-01T00:00:00Z',
    updated: '2026-01-01T00:00:00Z',
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('stage')));
});

test('validateTask: rejects invalid status for stage', () => {
  const result = validateTask({
    id: 'TASK-001',
    title: 'Test',
    stage: 'completed',
    status: 'in_progress', // completed only allows 'done'
    created: '2026-01-01T00:00:00Z',
    updated: '2026-01-01T00:00:00Z',
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('status')));
});

test('validateTask: accepts completed/done status', () => {
  const result = validateTask({
    id: 'TASK-001',
    title: 'Test',
    stage: 'completed',
    status: 'done',
    created: '2026-01-01T00:00:00Z',
    updated: '2026-01-01T00:00:00Z',
  });
  assert.equal(result.valid, true);
});

test('validateTask: rejects non-array files field', () => {
  const result = validateTask({
    id: 'TASK-001',
    title: 'Test',
    stage: 'planning',
    status: 'in_progress',
    created: '2026-01-01T00:00:00Z',
    updated: '2026-01-01T00:00:00Z',
    files: 'not-an-array',
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('files')));
});

test('validateTask: rejects non-number iterations', () => {
  const result = validateTask({
    id: 'TASK-001',
    title: 'Test',
    stage: 'planning',
    status: 'in_progress',
    created: '2026-01-01T00:00:00Z',
    updated: '2026-01-01T00:00:00Z',
    iterations: 'three',
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('iterations')));
});

test('validateTask: accepts reviewing/passed status', () => {
  const result = validateTask({
    id: 'TASK-001',
    title: 'Test',
    stage: 'reviewing',
    status: 'passed',
    created: '2026-01-01T00:00:00Z',
    updated: '2026-01-01T00:00:00Z',
  });
  assert.equal(result.valid, true);
});

// ---------------------------------------------------------------------------
// validateTransition
// ---------------------------------------------------------------------------

test('validateTransition: planning -> implementing is valid', () => {
  const result = validateTransition('planning', 'implementing');
  assert.equal(result.valid, true);
});

test('validateTransition: implementing -> reviewing is valid', () => {
  const result = validateTransition('implementing', 'reviewing');
  assert.equal(result.valid, true);
});

test('validateTransition: reviewing -> fixing is valid', () => {
  const result = validateTransition('reviewing', 'fixing');
  assert.equal(result.valid, true);
});

test('validateTransition: reviewing -> completed is valid', () => {
  const result = validateTransition('reviewing', 'completed');
  assert.equal(result.valid, true);
});

test('validateTransition: fixing -> reviewing is valid', () => {
  const result = validateTransition('fixing', 'reviewing');
  assert.equal(result.valid, true);
});

test('validateTransition: completed -> researching is valid', () => {
  const result = validateTransition('completed', 'researching');
  assert.equal(result.valid, true);
});

test('validateTransition: planning -> completed is invalid', () => {
  const result = validateTransition('planning', 'completed');
  assert.equal(result.valid, false);
  assert.ok(result.error.includes('planning'));
});

test('validateTransition: implementing -> planning is invalid (backward)', () => {
  const result = validateTransition('implementing', 'planning');
  assert.equal(result.valid, false);
});

test('validateTransition: researching -> any is invalid (terminal)', () => {
  for (const stage of STAGES.filter((s) => s !== 'researching')) {
    const result = validateTransition('researching', stage);
    assert.equal(result.valid, false, `researching -> ${stage} should be invalid`);
  }
});

test('validateTransition: invalid source stage returns error', () => {
  const result = validateTransition('nonexistent', 'implementing');
  assert.equal(result.valid, false);
  assert.ok(result.error.includes('nonexistent'));
});

test('validateTransition: invalid target stage returns error', () => {
  const result = validateTransition('planning', 'nonexistent');
  assert.equal(result.valid, false);
  assert.ok(result.error.includes('nonexistent'));
});

test('validateTransition: all VALID_TRANSITIONS entries are accepted', () => {
  for (const [from, targets] of Object.entries(VALID_TRANSITIONS)) {
    for (const to of targets) {
      const result = validateTransition(from, to);
      assert.equal(result.valid, true, `${from} -> ${to} should be valid`);
    }
  }
});

// ---------------------------------------------------------------------------
// getNextStage
// ---------------------------------------------------------------------------

test('getNextStage: planning + ready => implementing', () => {
  assert.equal(getNextStage('planning', 'ready'), 'implementing');
});

test('getNextStage: planning + in_progress => null', () => {
  assert.equal(getNextStage('planning', 'in_progress'), null);
});

test('getNextStage: implementing + ready => reviewing', () => {
  assert.equal(getNextStage('implementing', 'ready'), 'reviewing');
});

test('getNextStage: implementing + in_progress => null', () => {
  assert.equal(getNextStage('implementing', 'in_progress'), null);
});

test('getNextStage: reviewing + passed => completed', () => {
  assert.equal(getNextStage('reviewing', 'passed'), 'completed');
});

test('getNextStage: reviewing + failed => fixing', () => {
  assert.equal(getNextStage('reviewing', 'failed'), 'fixing');
});

test('getNextStage: reviewing + in_progress => null', () => {
  assert.equal(getNextStage('reviewing', 'in_progress'), null);
});

test('getNextStage: fixing + ready => reviewing', () => {
  assert.equal(getNextStage('fixing', 'ready'), 'reviewing');
});

test('getNextStage: fixing + in_progress => null', () => {
  assert.equal(getNextStage('fixing', 'in_progress'), null);
});

test('getNextStage: completed + any => null (no auto-transition)', () => {
  assert.equal(getNextStage('completed', 'done'), null);
  assert.equal(getNextStage('completed', 'in_progress'), null);
});

test('getNextStage: researching + any => null (terminal)', () => {
  assert.equal(getNextStage('researching', 'done'), null);
  assert.equal(getNextStage('researching', 'in_progress'), null);
});
