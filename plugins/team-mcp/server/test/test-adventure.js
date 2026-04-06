/**
 * Unit tests for adventure-related functions in lib/schema.js and lib/state.js.
 *
 * Covers:
 *   - validateAdventureTransition: valid and invalid state transitions
 *   - ADVENTURE_STATES: all 5 states present
 *   - ADVENTURE_TRANSITIONS: correct transition counts
 *   - parseTcSummary (indirect): TC table row parsing via parseFrontmatter on body strings
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ADVENTURE_STATES,
  ADVENTURE_TRANSITIONS,
  validateAdventureTransition,
} from '../lib/schema.js';
import { parseFrontmatter } from '../lib/state.js';

// ---------------------------------------------------------------------------
// validateAdventureTransition
// ---------------------------------------------------------------------------

test('validateAdventureTransition: planning -> review is valid', () => {
  const result = validateAdventureTransition('planning', 'review');
  assert.equal(result.valid, true);
});

test('validateAdventureTransition: active -> completed is valid', () => {
  const result = validateAdventureTransition('active', 'completed');
  assert.equal(result.valid, true);
});

test('validateAdventureTransition: active -> paused is valid', () => {
  const result = validateAdventureTransition('active', 'paused');
  assert.equal(result.valid, true);
});

test('validateAdventureTransition: paused -> active is valid', () => {
  const result = validateAdventureTransition('paused', 'active');
  assert.equal(result.valid, true);
});

test('validateAdventureTransition: completed -> active is invalid (terminal)', () => {
  const result = validateAdventureTransition('completed', 'active');
  assert.equal(result.valid, false);
  assert.ok(typeof result.error === 'string');
  assert.ok(result.error.includes('completed'));
});

test('validateAdventureTransition: cancelled -> active is invalid (terminal)', () => {
  const result = validateAdventureTransition('cancelled', 'active');
  assert.equal(result.valid, false);
  assert.ok(typeof result.error === 'string');
  assert.ok(result.error.includes('cancelled'));
});

test('validateAdventureTransition: planning -> completed is invalid', () => {
  const result = validateAdventureTransition('planning', 'completed');
  assert.equal(result.valid, false);
  assert.ok(typeof result.error === 'string');
});

test('validateAdventureTransition: invalid from state returns error', () => {
  const result = validateAdventureTransition('nonexistent', 'active');
  assert.equal(result.valid, false);
  assert.ok(result.error.includes('nonexistent'));
});

test('validateAdventureTransition: invalid to state returns error', () => {
  const result = validateAdventureTransition('planning', 'nonexistent');
  assert.equal(result.valid, false);
  assert.ok(result.error.includes('nonexistent'));
});

// ---------------------------------------------------------------------------
// ADVENTURE_STATES
// ---------------------------------------------------------------------------

test('ADVENTURE_STATES: contains all 8 states', () => {
  assert.ok(Array.isArray(ADVENTURE_STATES));
  assert.equal(ADVENTURE_STATES.length, 8);
  assert.ok(ADVENTURE_STATES.includes('concept'));
  assert.ok(ADVENTURE_STATES.includes('planning'));
  assert.ok(ADVENTURE_STATES.includes('review'));
  assert.ok(ADVENTURE_STATES.includes('active'));
  assert.ok(ADVENTURE_STATES.includes('paused'));
  assert.ok(ADVENTURE_STATES.includes('blocked'));
  assert.ok(ADVENTURE_STATES.includes('completed'));
  assert.ok(ADVENTURE_STATES.includes('cancelled'));
});

// ---------------------------------------------------------------------------
// ADVENTURE_TRANSITIONS
// ---------------------------------------------------------------------------

test('ADVENTURE_TRANSITIONS: planning has 2 transitions', () => {
  assert.ok(Array.isArray(ADVENTURE_TRANSITIONS.planning));
  assert.equal(ADVENTURE_TRANSITIONS.planning.length, 2);
});

test('ADVENTURE_TRANSITIONS: active has 4 transitions', () => {
  assert.ok(Array.isArray(ADVENTURE_TRANSITIONS.active));
  assert.equal(ADVENTURE_TRANSITIONS.active.length, 4);
});

test('ADVENTURE_TRANSITIONS: paused has 2 transitions', () => {
  assert.ok(Array.isArray(ADVENTURE_TRANSITIONS.paused));
  assert.equal(ADVENTURE_TRANSITIONS.paused.length, 2);
});

test('ADVENTURE_TRANSITIONS: completed is not in transitions map (terminal)', () => {
  assert.equal(ADVENTURE_TRANSITIONS.completed, undefined);
});

test('ADVENTURE_TRANSITIONS: cancelled is not in transitions map (terminal)', () => {
  assert.equal(ADVENTURE_TRANSITIONS.cancelled, undefined);
});

// ---------------------------------------------------------------------------
// parseTcSummary (indirect) -- test TC table parsing logic via body strings
//
// parseTcSummary is not exported from adventure.js, so we test its behavior
// indirectly by constructing manifest body strings and verifying the regex
// pattern that parseTcSummary uses.  We replicate the regex here so the tests
// are self-contained and do not depend on internal adventure.js internals.
// ---------------------------------------------------------------------------

/**
 * Replicate the parseTcSummary logic locally so we can unit-test TC parsing
 * without importing the private function from adventure.js.
 */
function parseTcSummary(body) {
  const summary = { total: 0, passed: 0, pending: 0, failed: 0 };
  const rowPattern = /^\|[^|]*TC-\d+[^|]*\|.*\|\s*(\w+)\s*\|?\s*$/gm;
  let match;
  while ((match = rowPattern.exec(body)) !== null) {
    const status = match[1].toLowerCase().trim();
    summary.total++;
    if (status === 'passed') {
      summary.passed++;
    } else if (status === 'failed') {
      summary.failed++;
    } else {
      summary.pending++;
    }
  }
  return summary;
}

test('parseTcSummary: counts passed rows correctly', () => {
  const body = `
## Target Conditions

| ID     | Description | Status |
|--------|-------------|--------|
| TC-001 | First check | passed |
| TC-002 | Second check | passed |
`;
  const summary = parseTcSummary(body);
  assert.equal(summary.total, 2);
  assert.equal(summary.passed, 2);
  assert.equal(summary.pending, 0);
  assert.equal(summary.failed, 0);
});

test('parseTcSummary: counts pending rows correctly', () => {
  const body = `
## Target Conditions

| ID     | Description | Status  |
|--------|-------------|---------|
| TC-010 | Pending one | pending |
| TC-011 | Pending two | pending |
| TC-012 | Pending three | pending |
`;
  const summary = parseTcSummary(body);
  assert.equal(summary.total, 3);
  assert.equal(summary.passed, 0);
  assert.equal(summary.pending, 3);
  assert.equal(summary.failed, 0);
});

test('parseTcSummary: counts failed rows correctly', () => {
  const body = `
## Target Conditions

| ID     | Description | Status |
|--------|-------------|--------|
| TC-020 | Failed one  | failed |
`;
  const summary = parseTcSummary(body);
  assert.equal(summary.total, 1);
  assert.equal(summary.passed, 0);
  assert.equal(summary.pending, 0);
  assert.equal(summary.failed, 1);
});

test('parseTcSummary: handles mixed statuses', () => {
  const body = `
## Target Conditions

| ID     | Description   | Status  |
|--------|---------------|---------|
| TC-100 | Passed check  | passed  |
| TC-101 | Pending check | pending |
| TC-102 | Failed check  | failed  |
| TC-103 | Another pass  | passed  |
`;
  const summary = parseTcSummary(body);
  assert.equal(summary.total, 4);
  assert.equal(summary.passed, 2);
  assert.equal(summary.pending, 1);
  assert.equal(summary.failed, 1);
});

test('parseTcSummary: returns zero counts for empty body', () => {
  const summary = parseTcSummary('');
  assert.equal(summary.total, 0);
  assert.equal(summary.passed, 0);
  assert.equal(summary.pending, 0);
  assert.equal(summary.failed, 0);
});

test('parseTcSummary: ignores non-TC table rows', () => {
  const body = `
| Task | Description | Status |
|------|-------------|--------|
| T-01 | Not a TC row | passed |
`;
  const summary = parseTcSummary(body);
  assert.equal(summary.total, 0);
});

test('parseFrontmatter: parses manifest frontmatter with TC body intact', () => {
  const content = `---
id: ADV-001
title: Test Adventure
state: active
tasks: [TASK-001, TASK-002]
---
## Target Conditions

| ID     | Description | Status  |
|--------|-------------|---------|
| TC-001 | First check | passed  |
| TC-002 | Next check  | pending |
`;
  const { frontmatter, body } = parseFrontmatter(content);
  assert.equal(frontmatter.id, 'ADV-001');
  assert.equal(frontmatter.state, 'active');
  assert.deepEqual(frontmatter.tasks, ['TASK-001', 'TASK-002']);

  // Body should contain the TC table rows
  const summary = parseTcSummary(body);
  assert.equal(summary.total, 2);
  assert.equal(summary.passed, 1);
  assert.equal(summary.pending, 1);
});
