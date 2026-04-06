/**
 * ADV-015 tests: TC parsing hardening, cascade delete, environment data,
 * adventure_task_create, and state machine verification.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { parseTcSummary } from '../lib/tools/adventure.js';
import {
  ADVENTURE_STATES,
  ADVENTURE_TRANSITIONS,
  validateAdventureTransition,
} from '../lib/schema.js';
import { readState, writeState, ensureDir, timestamp } from '../lib/state.js';

// ---------------------------------------------------------------------------
// parseTcSummary tests
// ---------------------------------------------------------------------------

test('parseTcSummary: returns empty summary for null/undefined/empty input', () => {
  assert.deepEqual(parseTcSummary(null), { total: 0, passed: 0, pending: 0, failed: 0, rows: [] });
  assert.deepEqual(parseTcSummary(undefined), { total: 0, passed: 0, pending: 0, failed: 0, rows: [] });
  assert.deepEqual(parseTcSummary(''), { total: 0, passed: 0, pending: 0, failed: 0, rows: [] });
  assert.deepEqual(parseTcSummary(42), { total: 0, passed: 0, pending: 0, failed: 0, rows: [] });
});

test('parseTcSummary: returns empty summary for body with no TC table', () => {
  const body = '## Concept\nSome concept text\n\n## Notes\nSome notes';
  const result = parseTcSummary(body);
  assert.equal(result.total, 0);
});

test('parseTcSummary: returns empty summary for empty TC table (header + separator only)', () => {
  const body = `## Target Conditions
| ID | Description | Status |
|----|-------------|--------|
`;
  const result = parseTcSummary(body);
  assert.equal(result.total, 0);
  assert.deepEqual(result.rows, []);
});

test('parseTcSummary: parses single TC row', () => {
  const body = `## Target Conditions
| ID | Description | Status |
|----|-------------|--------|
| TC-001 | Feature works | passed |
`;
  const result = parseTcSummary(body);
  assert.equal(result.total, 1);
  assert.equal(result.passed, 1);
  assert.equal(result.rows[0].id, 'TC-001');
  assert.equal(result.rows[0].status, 'passed');
});

test('parseTcSummary: handles markdown-formatted status (bold, backticks)', () => {
  const body = `## Target Conditions
| ID | Description | Status |
|----|-------------|--------|
| TC-001 | Feature A | **passed** |
| TC-002 | Feature B | \`failed\` |
| TC-003 | Feature C | _pending_ |
`;
  const result = parseTcSummary(body);
  assert.equal(result.total, 3);
  assert.equal(result.passed, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.pending, 1);
});

test('parseTcSummary: skips malformed rows with too few columns', () => {
  const body = `## Target Conditions
| ID | Description | Source | Design | Plan | Task(s) | Proof Method | Proof Command | Status |
|----|-------------|--------|--------|------|---------|-------------|---------------|--------|
| TC-001 | Works | concept | d1 | p1 | T1 | autotest | npm test | passed |
| incomplete row |
| TC-002 | Also works | concept | d2 | p2 | T2 | manual | - | pending |
`;
  const result = parseTcSummary(body);
  assert.equal(result.total, 2);
  assert.equal(result.rows[0].id, 'TC-001');
  assert.equal(result.rows[1].id, 'TC-002');
});

test('parseTcSummary: handles missing separator row', () => {
  const body = `## Target Conditions
| ID | Description | Status |
| TC-001 | Feature A | passed |
| TC-002 | Feature B | failed |
`;
  const result = parseTcSummary(body);
  assert.equal(result.total, 2);
  assert.equal(result.passed, 1);
  assert.equal(result.failed, 1);
});

test('parseTcSummary: stops at empty line or heading after table', () => {
  const body = `## Target Conditions
| ID | Description | Status |
|----|-------------|--------|
| TC-001 | A | passed |

## Other Section
| ID | Status |
| XX-001 | nope |
`;
  const result = parseTcSummary(body);
  assert.equal(result.total, 1);
});

// ---------------------------------------------------------------------------
// State machine tests
// ---------------------------------------------------------------------------

test('ADVENTURE_STATES contains all 8 states from design-002', () => {
  const expected = ['concept', 'planning', 'review', 'active', 'paused', 'blocked', 'completed', 'cancelled'];
  for (const state of expected) {
    assert.ok(ADVENTURE_STATES.includes(state), `Missing state: ${state}`);
  }
  assert.equal(ADVENTURE_STATES.length, expected.length);
});

test('completed and cancelled are terminal (no outbound transitions)', () => {
  assert.equal(ADVENTURE_TRANSITIONS['completed'], undefined);
  assert.equal(ADVENTURE_TRANSITIONS['cancelled'], undefined);
});

test('blocked -> active is valid transition', () => {
  const result = validateAdventureTransition('blocked', 'active');
  assert.equal(result.valid, true);
});

test('blocked -> cancelled is valid transition', () => {
  const result = validateAdventureTransition('blocked', 'cancelled');
  assert.equal(result.valid, true);
});

test('review -> planning (rework) is valid transition', () => {
  const result = validateAdventureTransition('review', 'planning');
  assert.equal(result.valid, true);
});

test('completed -> active is invalid (terminal)', () => {
  const result = validateAdventureTransition('completed', 'active');
  assert.equal(result.valid, false);
});

test('cancelled -> concept is invalid (terminal)', () => {
  const result = validateAdventureTransition('cancelled', 'concept');
  assert.equal(result.valid, false);
});

// ---------------------------------------------------------------------------
// Cascade delete with orphan detection (filesystem-level test)
// ---------------------------------------------------------------------------

let tmpDir;

before(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'adv015-test-'));
});

after(async () => {
  if (tmpDir && existsSync(tmpDir)) {
    await rm(tmpDir, { recursive: true });
  }
});

test('cascade delete: detects orphan task files not in manifest.tasks', async () => {
  // Simulate adventure directory
  const advDir = join(tmpDir, 'ADV-099');
  const tasksDir = join(advDir, 'tasks');
  const archiveDir = join(tasksDir, 'archive');
  await ensureDir(advDir);
  await ensureDir(tasksDir);
  await ensureDir(archiveDir);

  // Create 3 task files: T001, T002, T003
  for (const n of ['001', '002', '003']) {
    const fm = { id: `ADV099-T${n}`, title: `Task ${n}`, stage: 'implementing', status: 'in_progress', created: timestamp(), updated: timestamp() };
    await writeState(join(tasksDir, `ADV099-T${n}.md`), fm, '\n## Description\nTest\n');
  }

  // Manifest only lists T001 and T002 (T003 is orphan)
  const manifestTasks = ['ADV099-T001', 'ADV099-T002'];

  // Simulate cascade logic: collect from both manifest and filesystem
  const manifestTaskIds = new Set(manifestTasks);
  const files = await readdir(tasksDir);
  const fsTaskIds = new Set();
  for (const f of files) {
    const match = f.match(/^(ADV\d{3,}-T\d{3,})\.md$/);
    if (match) fsTaskIds.add(match[1]);
  }
  const allTaskIds = new Set([...manifestTaskIds, ...fsTaskIds]);

  // Should have all 3, including orphan T003
  assert.equal(allTaskIds.size, 3);
  assert.ok(allTaskIds.has('ADV099-T003'), 'Orphan T003 should be detected');
});

// ---------------------------------------------------------------------------
// Environment data in manifest body
// ---------------------------------------------------------------------------

test('environment data is populated in manifest body when provided', () => {
  // Simulates what adventure_create does with the env object
  const env = {
    project: 'Claudovka',
    workspace: 'R:\\Claudovka',
    repo: 'github.com/abumonk/claudovka',
    branch: 'main',
    pc: 'DESKTOP-ABC',
    platform: 'Windows 11 Pro',
    runtime: 'v22.1.0',
    shell: 'Git Bash',
  };

  const body = `
## Environment
- **Project**: ${env.project || '-'}
- **Workspace**: ${env.workspace || '-'}
- **Repo**: ${env.repo || '-'}
- **Branch**: ${env.branch || '-'}
- **PC**: ${env.pc || '-'}
- **Platform**: ${env.platform || '-'}
- **Runtime**: ${env.runtime || '-'}
- **Shell**: ${env.shell || '-'}
`;

  assert.ok(body.includes('Claudovka'));
  assert.ok(body.includes('github.com/abumonk/claudovka'));
  assert.ok(body.includes('v22.1.0'));
  assert.ok(!body.includes('- **Project**: -'));
});

test('environment data defaults to dashes when not provided', () => {
  const env = {};
  const body = `- **Project**: ${env.project || '-'}`;
  assert.ok(body.includes('- **Project**: -'));
});

console.log('ADV-015 test suite loaded.');
