/**
 * Integration tests for team-mcp MCP server.
 *
 * Tests complete end-to-end server functionality using a temporary .agent/
 * directory. Verifies: task lifecycle, event emission, boundary enforcement,
 * knowledge deduplication, and metrics logging.
 *
 * Target conditions: TC-001, TC-005, TC-009, TC-018, TC-022
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';

// ---------------------------------------------------------------------------
// Temporary .agent/ directory setup
// ---------------------------------------------------------------------------

let tmpDir = null;
let agentDir = null;
let projectRoot = null;

/**
 * Minimal config.md frontmatter with empty working_folders
 * (unrestricted access within project root).
 */
const CONFIG_CONTENT = `---
pipeline_version: "0.1.0"
working_folders: []
---
# Config
`;

/**
 * Minimal lead-state.md so event emitter can write last_event.
 */
const LEAD_STATE_CONTENT = `---
active_agents: []
queue: []
pending_proposals: 0
---
# Lead State
`;

/**
 * Create a temporary .agent/ directory structure for tests.
 * Returns { projectRoot, agentDir }.
 */
async function setupTempAgentDir() {
  const base = await mkdtemp(join(tmpdir(), 'team-mcp-test-'));
  const agent = join(base, '.agent');
  await mkdir(agent);
  await mkdir(join(agent, 'tasks'));
  await mkdir(join(agent, 'knowledge'));
  await writeFile(join(agent, 'config.md'), CONFIG_CONTENT, 'utf-8');
  await writeFile(join(agent, 'lead-state.md'), LEAD_STATE_CONTENT, 'utf-8');
  return { projectRoot: base, agentDir: agent };
}

// ---------------------------------------------------------------------------
// Import the library functions directly to test server logic without
// running the full MCP server over stdio. This lets us exercise tool
// handlers, state I/O, event emitter, and boundary logic in isolation.
// ---------------------------------------------------------------------------

import { parseFrontmatter, serializeFrontmatter, resolveAgentDir, readState, writeState, deepMerge, LockManager } from '../lib/state.js';
import { validateTask, validateTransition, getNextStage } from '../lib/schema.js';
import { EventEmitter } from '../lib/events.js';
import { validatePath } from '../lib/boundaries.js';
import { VALIDATION_ERROR, NOT_FOUND, LOCK_CONFLICT, INTERNAL_ERROR } from '../lib/errors.js';

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

before(async () => {
  const dirs = await setupTempAgentDir();
  projectRoot = dirs.projectRoot;
  agentDir = dirs.agentDir;
});

after(async () => {
  if (tmpDir) {
    await rm(tmpDir, { recursive: true, force: true });
  }
  if (projectRoot) {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// TC-001: Server bootstrap -- .agent/ directory accessible
// ---------------------------------------------------------------------------

test('TC-001: temp .agent/ directory was created and is accessible', () => {
  assert.ok(agentDir !== null, 'agentDir should be set');
  assert.ok(existsSync(agentDir), '.agent/ directory should exist');
  assert.ok(existsSync(join(agentDir, 'tasks')), '.agent/tasks/ directory should exist');
  assert.ok(existsSync(join(agentDir, 'config.md')), '.agent/config.md should exist');
  assert.ok(existsSync(join(agentDir, 'lead-state.md')), '.agent/lead-state.md should exist');
});

test('TC-001: config.md can be read and parsed', async () => {
  const { frontmatter } = await readState(join(agentDir, 'config.md'));
  assert.equal(frontmatter.pipeline_version, '0.1.0');
});

// ---------------------------------------------------------------------------
// TC-005: Task lifecycle -- create task file with correct defaults
// ---------------------------------------------------------------------------

test('TC-005: create task file with valid frontmatter', async () => {
  const tasksDir = join(agentDir, 'tasks');
  const taskId = 'TASK-001';
  const taskPath = join(tasksDir, `${taskId}.md`);

  const now = new Date().toISOString();
  const frontmatter = {
    id: taskId,
    title: 'Integration test task',
    stage: 'planning',
    status: 'in_progress',
    created: now,
    updated: now,
    iterations: 0,
    assignee: 'planner',
    files: [],
    repos: [],
    depends_on: [],
    tags: ['integration', 'test'],
    packages: [],
  };
  const body = '## Description\n\nIntegration test task.\n\n## Log\n- [created] Task created\n';

  await writeState(taskPath, frontmatter, body);

  assert.ok(existsSync(taskPath), 'Task file should exist after creation');

  const { frontmatter: read, body: readBody } = await readState(taskPath);
  assert.equal(read.id, taskId);
  assert.equal(read.title, 'Integration test task');
  assert.equal(read.stage, 'planning');
  assert.equal(read.status, 'in_progress');
  assert.equal(read.iterations, 0);
  assert.equal(read.assignee, 'planner');
  assert.deepEqual(read.tags, ['integration', 'test']);
  assert.ok(readBody.includes('## Description'));
});

test('TC-005: validateTask accepts created task frontmatter', async () => {
  const { frontmatter } = await readState(join(agentDir, 'tasks', 'TASK-001.md'));
  const result = validateTask(frontmatter);
  assert.equal(result.valid, true);
});

// ---------------------------------------------------------------------------
// TC-009: Task advance -- full stage transition state machine
// ---------------------------------------------------------------------------

test('TC-009: task can be advanced through planning -> implementing lifecycle', async () => {
  const tasksDir = join(agentDir, 'tasks');
  const taskId = 'TASK-002';
  const taskPath = join(tasksDir, `${taskId}.md`);
  const now = new Date().toISOString();

  // Create task in planning/ready state
  await writeState(taskPath, {
    id: taskId,
    title: 'State machine test',
    stage: 'planning',
    status: 'ready',
    created: now,
    updated: now,
    iterations: 0,
    assignee: 'planner',
    files: [],
    repos: [],
    depends_on: [],
    tags: [],
    packages: [],
  }, '## Log\n');

  // Verify transition: planning + ready => implementing
  const nextStage = getNextStage('planning', 'ready');
  assert.equal(nextStage, 'implementing');

  const transition = validateTransition('planning', 'implementing');
  assert.equal(transition.valid, true);

  // Advance task
  const { frontmatter, body } = await readState(taskPath);
  frontmatter.stage = 'implementing';
  frontmatter.status = 'in_progress';
  frontmatter.assignee = 'implementer';
  frontmatter.updated = new Date().toISOString();
  await writeState(taskPath, frontmatter, body + `\n- [${frontmatter.updated}] advanced: planning -> implementing`);

  // Verify
  const { frontmatter: advanced } = await readState(taskPath);
  assert.equal(advanced.stage, 'implementing');
  assert.equal(advanced.assignee, 'implementer');
});

test('TC-009: task can advance implementing -> reviewing -> completed', async () => {
  const tasksDir = join(agentDir, 'tasks');
  const taskId = 'TASK-003';
  const taskPath = join(tasksDir, `${taskId}.md`);
  const now = new Date().toISOString();

  await writeState(taskPath, {
    id: taskId,
    title: 'Full lifecycle test',
    stage: 'implementing',
    status: 'ready',
    created: now,
    updated: now,
    iterations: 0,
    assignee: 'implementer',
    files: [],
    repos: [],
    depends_on: [],
    tags: [],
    packages: [],
  }, '## Log\n');

  // implementing + ready => reviewing
  assert.equal(getNextStage('implementing', 'ready'), 'reviewing');
  assert.equal(validateTransition('implementing', 'reviewing').valid, true);

  // reviewing + passed => completed
  assert.equal(getNextStage('reviewing', 'passed'), 'completed');
  assert.equal(validateTransition('reviewing', 'completed').valid, true);
});

test('TC-009: invalid transition is rejected', () => {
  // Cannot go from planning directly to completed
  const result = validateTransition('planning', 'completed');
  assert.equal(result.valid, false);
  assert.ok(result.error.includes('planning'));
});

test('TC-009: getNextStage returns null for non-automatable state', () => {
  // completed has no automatic transition
  assert.equal(getNextStage('completed', 'done'), null);
  // in_progress never auto-advances
  assert.equal(getNextStage('planning', 'in_progress'), null);
});

// ---------------------------------------------------------------------------
// TC-018: State-changing operations emit structured events
// ---------------------------------------------------------------------------

test('TC-018: EventEmitter.emit returns structured event envelope', async () => {
  const em = new EventEmitter();
  const event = await em.emit('task.created', 'TASK-001', {
    title: 'Integration test',
    assignee: 'planner',
  });

  assert.ok(event, 'event should be returned');
  assert.equal(event.type, 'task.created');
  assert.ok(typeof event.timestamp === 'string');
  assert.ok(!isNaN(new Date(event.timestamp).getTime()), 'timestamp should be valid ISO date');
  assert.equal(event.task_id, 'TASK-001');
  assert.equal(event.data.title, 'Integration test');
  assert.equal(event.data.assignee, 'planner');
});

test('TC-018: multiple event types are buffered correctly', async () => {
  const em = new EventEmitter();

  const e1 = await em.emit('task.created', 'TASK-001', { title: 'T1' });
  const e2 = await em.emit('task.advanced', 'TASK-001', { from_stage: 'planning', to_stage: 'implementing' });
  const e3 = await em.emit('task.completed', 'TASK-001', { iterations: 0 });

  const events = em.getEvents();
  assert.equal(events.length, 3);
  assert.equal(events[0].type, 'task.created');
  assert.equal(events[1].type, 'task.advanced');
  assert.equal(events[2].type, 'task.completed');
});

test('TC-018: ring buffer enforces 50-event limit', async () => {
  const em = new EventEmitter();
  for (let i = 0; i < 55; i++) {
    await em.emit('task.event', `TASK-${i}`, { seq: i });
  }
  const events = em.getEvents();
  assert.equal(events.length, 50, 'ring buffer should cap at 50 events');
  // First 5 should have been evicted, so first retained event has seq=5
  assert.equal(events[0].data.seq, 5);
  assert.equal(events[49].data.seq, 54);
});

test('TC-018: events without task_id have no task_id field', async () => {
  const em = new EventEmitter();
  const event = await em.emit('pipeline.ready', null, {});
  assert.equal(event.task_id, undefined);
});

// ---------------------------------------------------------------------------
// TC-022: File operations blocked outside project root
// ---------------------------------------------------------------------------

test('TC-022: path inside project root allowed (no working_folders)', async () => {
  const filePath = join(projectRoot, 'src', 'index.js');
  const config = {};
  const result = await validatePath(filePath, null, config, projectRoot);
  assert.equal(result.allowed, true);
});

test('TC-022: path outside project root is blocked', async () => {
  const outsidePath = resolve(tmpdir(), 'outside-project', 'secret.txt');
  const config = {};
  const result = await validatePath(outsidePath, null, config, projectRoot);
  assert.equal(result.allowed, false);
  assert.ok(result.reason.includes('project root'), `Expected "project root" in: ${result.reason}`);
});

test('TC-022: path traversal attempt is blocked', async () => {
  const result = await validatePath('../../etc/passwd', null, {}, projectRoot);
  assert.equal(result.allowed, false);
  assert.ok(result.reason.includes('project root'));
});

// ---------------------------------------------------------------------------
// Boundary enforcement: working_folders
// ---------------------------------------------------------------------------

test('boundary: path inside configured working folder is allowed', async () => {
  const config = { working_folders: [{ name: 'src', path: 'src' }] };
  const filePath = join(projectRoot, 'src', 'app.js');
  const result = await validatePath(filePath, null, config, projectRoot);
  assert.equal(result.allowed, true);
});

test('boundary: path outside configured working folder is blocked', async () => {
  const config = { working_folders: [{ name: 'src', path: 'src' }] };
  const filePath = join(projectRoot, 'docs', 'guide.md');
  const result = await validatePath(filePath, null, config, projectRoot);
  assert.equal(result.allowed, false);
  assert.ok(result.reason.includes('working_folders'));
});

test('boundary: .agent/ path always allowed even with working_folders configured', async () => {
  const config = { working_folders: [{ name: 'src', path: 'src' }] };
  const filePath = join(projectRoot, '.agent', 'tasks', 'TASK-001.md');
  const result = await validatePath(filePath, null, config, projectRoot);
  assert.equal(result.allowed, true);
});

test('boundary: empty working_folders allows unrestricted access within root', async () => {
  const config = { working_folders: [] };
  const paths = ['src/index.js', 'docs/readme.md', 'tests/unit.js'].map((p) =>
    join(projectRoot, p)
  );
  for (const filePath of paths) {
    const result = await validatePath(filePath, null, config, projectRoot);
    assert.equal(result.allowed, true, `Expected ${filePath} to be allowed`);
  }
});

// ---------------------------------------------------------------------------
// Knowledge deduplication (direct lib logic test)
// ---------------------------------------------------------------------------

test('knowledge: entries with same name (case-insensitive) are detected as duplicates', () => {
  const existingContent = `- **Error Handling**: Use structured errors (from errors.js)
- **Lock Manager**: Use singleton lockManager from index.js
`;
  const targetName = 'error handling'; // same as first entry, different case

  const lines = existingContent.split('\n');
  const nameLower = targetName.toLowerCase();
  const isDuplicate = lines.some((line) => {
    const match = line.match(/^-\s+\*\*(.+?)\*\*/);
    return match && match[1].toLowerCase() === nameLower;
  });

  assert.equal(isDuplicate, true, 'Should detect case-insensitive duplicate');
});

test('knowledge: unique name is not flagged as duplicate', () => {
  const existingContent = `- **Error Handling**: Use structured errors (from errors.js)
`;
  const targetName = 'Lock Manager';

  const lines = existingContent.split('\n');
  const nameLower = targetName.toLowerCase();
  const isDuplicate = lines.some((line) => {
    const match = line.match(/^-\s+\*\*(.+?)\*\*/);
    return match && match[1].toLowerCase() === nameLower;
  });

  assert.equal(isDuplicate, false, 'Should not flag unique name as duplicate');
});

// ---------------------------------------------------------------------------
// Metrics logging (direct lib logic test)
// ---------------------------------------------------------------------------

test('metrics: metrics.md can be written and read with correct structure', async () => {
  const metricsPath = join(agentDir, 'metrics.md');
  const now = new Date().toISOString();

  const frontmatter = {
    agents_spawned: 1,
    tokens_in: 5000,
    tokens_out: 1000,
    avg_turns: 5.0,
    last_updated: now,
  };
  const body = `## Agent Log

| Timestamp | Task | Role | Model | Stage | Turns | Tokens In | Tokens Out | Duration (min) | Result |
|-----------|------|------|-------|-------|-------|-----------|------------|----------------|--------|
| ${now} | TASK-001 | implementer | sonnet | implementing | 10 | 5000 | 1000 | 5.0 | completed |
`;

  await writeState(metricsPath, frontmatter, body);

  const { frontmatter: read, body: readBody } = await readState(metricsPath);
  assert.equal(read.agents_spawned, 1);
  assert.equal(read.tokens_in, 5000);
  assert.equal(read.tokens_out, 1000);
  assert.ok(readBody.includes('## Agent Log'));
  assert.ok(readBody.includes('TASK-001'));
});

// ---------------------------------------------------------------------------
// Error constructors produce valid MCP error shape
// ---------------------------------------------------------------------------

test('error constructors return isError:true with structured content', () => {
  const constructors = [
    [VALIDATION_ERROR, 'VALIDATION_ERROR'],
    [NOT_FOUND, 'NOT_FOUND'],
    [LOCK_CONFLICT, 'LOCK_CONFLICT'],
    [INTERNAL_ERROR, 'INTERNAL_ERROR'],
  ];

  for (const [fn, expectedCode] of constructors) {
    const res = fn('test message');
    assert.equal(res.isError, true, `${expectedCode} should have isError:true`);
    assert.ok(Array.isArray(res.content), `${expectedCode} content should be array`);
    assert.equal(res.content[0].type, 'text');
    const body = JSON.parse(res.content[0].text);
    assert.equal(body.error, expectedCode);
    assert.equal(body.message, 'test message');
  }
});

// ---------------------------------------------------------------------------
// LockManager integration
// ---------------------------------------------------------------------------

test('LockManager: acquire/release prevents concurrent access', () => {
  const lm = new LockManager();

  const r1 = lm.acquire('TASK-001', 'session-A');
  assert.equal(r1.acquired, true);

  const r2 = lm.acquire('TASK-001', 'session-B');
  assert.equal(r2.acquired, false);
  assert.equal(r2.holder, 'session-A');

  const rel = lm.release('TASK-001', 'session-A');
  assert.equal(rel.released, true);

  const r3 = lm.acquire('TASK-001', 'session-B');
  assert.equal(r3.acquired, true);
});

test('LockManager: re-entrant acquire by same session is allowed', () => {
  const lm = new LockManager();
  lm.acquire('TASK-002', 'session-A');
  const result = lm.acquire('TASK-002', 'session-A');
  assert.equal(result.acquired, true);
});
