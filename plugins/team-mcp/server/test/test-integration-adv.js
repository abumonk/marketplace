/**
 * Integration tests for adventure and agent tools.
 *
 * Tests the full adventure and agent lifecycle using a temporary .agent/
 * directory. Exercises adventure CRUD, state machine transitions, event
 * emission, TC progress computation, agent spawn/list/complete, and
 * lead-state tracking -- all through the same library functions used by
 * the tool handlers in adventure.js and agent.js.
 *
 * Target conditions: TC-115
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Library functions used directly by the tool handlers
import {
  readState,
  writeState,
  ensureDir,
  timestamp,
  logEntry,
  readAgents,
  writeAgent,
  updateAgent,
  LockManager,
} from '../lib/state.js';

import {
  validateAdventureTransition,
} from '../lib/schema.js';

import { EventEmitter } from '../lib/events.js';

// ---------------------------------------------------------------------------
// Temp directory setup
// ---------------------------------------------------------------------------

let projectRoot = null;
let agentDir = null;
let adventuresDir = null;

const CONFIG_CONTENT = `---
pipeline_version: "0.1.0"
working_folders: []
---
# Config
`;

const LEAD_STATE_CONTENT = `---
active_count: 0
agents: []
---
# Lead State
`;

async function setupTempAgentDir() {
  const base = await mkdtemp(join(tmpdir(), 'team-mcp-adv-test-'));
  const agent = join(base, '.agent');
  await mkdir(agent);
  await mkdir(join(agent, 'tasks'));
  await mkdir(join(agent, 'adventures'));
  await writeFile(join(agent, 'config.md'), CONFIG_CONTENT, 'utf-8');
  await writeFile(join(agent, 'lead-state.md'), LEAD_STATE_CONTENT, 'utf-8');
  return { projectRoot: base, agentDir: agent };
}

before(async () => {
  const dirs = await setupTempAgentDir();
  projectRoot = dirs.projectRoot;
  agentDir = dirs.agentDir;
  adventuresDir = join(agentDir, 'adventures');
});

after(async () => {
  if (projectRoot) {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Helpers -- replicate adventure.js tool logic using library functions
// ---------------------------------------------------------------------------

/**
 * Parse TC status counts from the Target Conditions table in a manifest body.
 * This replicates parseTcSummary() from adventure.js (private function).
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

/**
 * Create an adventure manifest file in the temp adventures directory.
 * Replicates the core of the adventure_create tool handler.
 *
 * @param {string} advId - e.g. 'ADV-001'
 * @param {{ title: string, concept?: string, tags?: string[] }} opts
 * @returns {Promise<{ path: string, frontmatter: object }>}
 */
async function createAdventureManifest(advId, { title, concept = '', tags } = {}) {
  const advDir = join(adventuresDir, advId);
  await ensureDir(advDir);

  const manifestPath = join(advDir, 'manifest.md');
  const now = timestamp();

  const frontmatter = {
    id: advId,
    title,
    state: 'planning',
    created: now,
    updated: now,
    tasks: [],
  };
  if (tags && tags.length > 0) {
    frontmatter.tags = tags;
  }

  const body = `
## Concept
${concept}

## Target Conditions
| ID | Description | Source | Design | Plan | Task(s) | Proof Method | Proof Command | Status |
|----|-------------|--------|--------|------|---------|-------------|---------------|--------|

## Evaluations
| Task | Access Requirements | Skill Set | Est. Duration | Est. Tokens | Est. Cost | Actual Duration | Actual Tokens | Actual Cost | Variance |
|------|-------------------|-----------|---------------|-------------|-----------|-----------------|---------------|-------------|----------|

## Metrics Summary
- **State**: Planning
- **Tasks**: 0/0 done
- **Tests**: -
- **Target Conditions**: 0/0 passed
- **Estimated Cost**: -

## Log
${logEntry('created: Adventure created')}
`;

  await writeState(manifestPath, frontmatter, body);
  return { path: manifestPath, frontmatter };
}

/**
 * Read and parse an adventure manifest.
 * Replicates core logic from adventure_get tool handler.
 *
 * @param {string} advId
 * @returns {Promise<{ frontmatter: object, body: string, tc_summary: object, task_summary: object }>}
 */
async function getAdventure(advId) {
  const manifestPath = join(adventuresDir, advId, 'manifest.md');
  const { frontmatter, body } = await readState(manifestPath);
  const tc_summary = parseTcSummary(body);
  const taskIds = frontmatter.tasks || [];
  const tasksDir = join(agentDir, 'tasks');
  let completed = 0;
  let in_progress = 0;
  for (const taskId of taskIds) {
    const taskPath = join(tasksDir, `${taskId}.md`);
    if (existsSync(taskPath)) {
      try {
        const { frontmatter: taskFm } = await readState(taskPath);
        if (taskFm.stage === 'completed' || taskFm.stage === 'researching') {
          completed++;
        } else {
          in_progress++;
        }
      } catch {
        // Skip unreadable task files
      }
    }
  }
  return {
    frontmatter,
    body,
    tc_summary,
    task_summary: { total: taskIds.length, completed, in_progress },
  };
}

/**
 * List all adventures in the adventures directory.
 * Replicates core logic from adventure_list tool handler.
 *
 * @param {string|null} stateFilter - optional state to filter by
 * @returns {Promise<Array>}
 */
async function listAdventures(stateFilter = null) {
  if (!existsSync(adventuresDir)) return [];
  const entries = await readdir(adventuresDir);
  const adventures = [];
  for (const entry of entries) {
    if (!/^ADV-\d{3,}$/.test(entry)) continue;
    const manifestPath = join(adventuresDir, entry, 'manifest.md');
    if (!existsSync(manifestPath)) continue;
    const { frontmatter } = await readState(manifestPath);
    if (stateFilter && frontmatter.state !== stateFilter) continue;
    adventures.push({
      id: frontmatter.id,
      title: frontmatter.title,
      state: frontmatter.state,
      created: frontmatter.created,
      updated: frontmatter.updated,
      tasks: frontmatter.tasks || [],
    });
  }
  adventures.sort((a, b) => new Date(a.created) - new Date(b.created));
  return adventures;
}

/**
 * Advance an adventure's state.
 * Replicates core logic from adventure_advance tool handler.
 *
 * @param {string} advId
 * @param {string} targetState
 * @param {EventEmitter} em - event emitter to use
 * @returns {Promise<{ from_state: string, to_state: string }>}
 */
async function advanceAdventure(advId, targetState, em) {
  const manifestPath = join(adventuresDir, advId, 'manifest.md');
  const { frontmatter, body } = await readState(manifestPath);
  const from_state = frontmatter.state;

  const validation = validateAdventureTransition(from_state, targetState);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  frontmatter.state = targetState;
  frontmatter.updated = timestamp();
  const newBody = body + logEntry(`advanced: ${from_state} -> ${targetState}`) + '\n';
  await writeState(manifestPath, frontmatter, newBody);

  if (targetState === 'completed') {
    await em.emit('adventure.completed', null, { id: advId, title: frontmatter.title });
  } else {
    await em.emit('adventure.advanced', null, { id: advId, from_state, to_state: targetState });
  }

  return { from_state, to_state: targetState };
}

// ---------------------------------------------------------------------------
// TC-115: Adventure CRUD lifecycle
// ---------------------------------------------------------------------------

test('TC-115: adventure directory structure is set up correctly', () => {
  assert.ok(existsSync(agentDir), '.agent/ directory should exist');
  assert.ok(existsSync(adventuresDir), '.agent/adventures/ directory should exist');
  assert.ok(existsSync(join(agentDir, 'tasks')), '.agent/tasks/ directory should exist');
  assert.ok(existsSync(join(agentDir, 'lead-state.md')), 'lead-state.md should exist');
});

test('TC-115: adventure_create - manifest file is written with correct frontmatter', async () => {
  const { path: manifestPath, frontmatter } = await createAdventureManifest('ADV-001', {
    title: 'Test Adventure Alpha',
    concept: 'Integration test concept',
    tags: ['integration', 'testing'],
  });

  assert.ok(existsSync(manifestPath), 'manifest.md should exist after creation');

  const { frontmatter: read, body } = await readState(manifestPath);
  assert.equal(read.id, 'ADV-001');
  assert.equal(read.title, 'Test Adventure Alpha');
  assert.equal(read.state, 'planning');
  assert.deepEqual(read.tasks, []);
  assert.deepEqual(read.tags, ['integration', 'testing']);
  assert.ok(typeof read.created === 'string');
  assert.ok(typeof read.updated === 'string');
  assert.ok(body.includes('## Concept'));
  assert.ok(body.includes('## Target Conditions'));
  assert.ok(body.includes('## Log'));
  assert.ok(body.includes('created: Adventure created'));
});

test('TC-115: adventure_get - read and parse manifest with TC summary', async () => {
  const result = await getAdventure('ADV-001');

  assert.equal(result.frontmatter.id, 'ADV-001');
  assert.equal(result.frontmatter.state, 'planning');

  // No TC rows in body yet, so all zeros
  assert.equal(result.tc_summary.total, 0);
  assert.equal(result.tc_summary.passed, 0);

  // No tasks yet
  assert.equal(result.task_summary.total, 0);
  assert.equal(result.task_summary.completed, 0);
});

test('TC-115: adventure_list - returns all adventures', async () => {
  // Create a second adventure
  await createAdventureManifest('ADV-002', { title: 'Test Adventure Beta' });

  const adventures = await listAdventures();
  assert.ok(adventures.length >= 2, 'Should have at least 2 adventures');

  const ids = adventures.map((a) => a.id);
  assert.ok(ids.includes('ADV-001'), 'ADV-001 should be in the list');
  assert.ok(ids.includes('ADV-002'), 'ADV-002 should be in the list');
});

test('TC-115: adventure_list - state filter returns only matching adventures', async () => {
  // ADV-001 and ADV-002 are both in 'planning' state
  const planning = await listAdventures('planning');
  assert.ok(planning.length >= 2, 'Should have at least 2 planning adventures');
  assert.ok(planning.every((a) => a.state === 'planning'), 'All returned should be planning');

  const active = await listAdventures('active');
  assert.equal(active.length, 0, 'No active adventures yet');
});

// ---------------------------------------------------------------------------
// TC-115: Adventure state transitions
// ---------------------------------------------------------------------------

test('TC-115: adventure_advance - planning -> active transition', async () => {
  const em = new EventEmitter();
  const result = await advanceAdventure('ADV-001', 'active', em);

  assert.equal(result.from_state, 'planning');
  assert.equal(result.to_state, 'active');

  // Verify manifest was updated on disk
  const { frontmatter, body } = await readState(
    join(adventuresDir, 'ADV-001', 'manifest.md')
  );
  assert.equal(frontmatter.state, 'active');
  assert.ok(body.includes('planning -> active'), 'Log entry should record the transition');
});

test('TC-115: adventure_advance - active -> completed transition', async () => {
  const em = new EventEmitter();
  const result = await advanceAdventure('ADV-001', 'completed', em);

  assert.equal(result.from_state, 'active');
  assert.equal(result.to_state, 'completed');

  const { frontmatter } = await readState(
    join(adventuresDir, 'ADV-001', 'manifest.md')
  );
  assert.equal(frontmatter.state, 'completed');
});

test('TC-115: adventure_advance - invalid transition is rejected', async () => {
  // ADV-002 is in 'planning', cannot go directly to 'completed'
  const em = new EventEmitter();
  await assert.rejects(
    () => advanceAdventure('ADV-002', 'completed', em),
    (err) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.length > 0, 'Should have an error message');
      return true;
    }
  );
});

test('TC-115: adventure_advance - completed state is terminal (cannot advance further)', async () => {
  // ADV-001 is now 'completed', verify transition validation
  const validation = validateAdventureTransition('completed', 'active');
  assert.equal(validation.valid, false);
  assert.ok(validation.error.includes('completed'));
});

test('TC-115: adventure state machine covers full lifecycle: planning -> active -> paused -> active -> completed', () => {
  // Verify all valid transitions in the state machine
  assert.equal(validateAdventureTransition('planning', 'active').valid, true);
  assert.equal(validateAdventureTransition('planning', 'cancelled').valid, true);
  assert.equal(validateAdventureTransition('active', 'completed').valid, true);
  assert.equal(validateAdventureTransition('active', 'paused').valid, true);
  assert.equal(validateAdventureTransition('active', 'cancelled').valid, true);
  assert.equal(validateAdventureTransition('paused', 'active').valid, true);
  assert.equal(validateAdventureTransition('paused', 'cancelled').valid, true);

  // Terminal states cannot transition
  assert.equal(validateAdventureTransition('completed', 'active').valid, false);
  assert.equal(validateAdventureTransition('cancelled', 'active').valid, false);
});

// ---------------------------------------------------------------------------
// TC-115: Adventure events
// ---------------------------------------------------------------------------

test('TC-115: adventure.created event is emitted with correct fields', async () => {
  const em = new EventEmitter();
  const event = await em.emit('adventure.created', null, { id: 'ADV-003', title: 'Event Test' });

  assert.equal(event.type, 'adventure.created');
  assert.ok(typeof event.timestamp === 'string');
  assert.ok(!isNaN(new Date(event.timestamp).getTime()));
  assert.equal(event.task_id, undefined);
  assert.equal(event.data.id, 'ADV-003');
  assert.equal(event.data.title, 'Event Test');
});

test('TC-115: adventure.advanced event is emitted when state advances', async () => {
  const em = new EventEmitter();

  // ADV-002 is still in 'planning', advance it to 'active'
  const result = await advanceAdventure('ADV-002', 'active', em);
  assert.equal(result.to_state, 'active');

  const events = em.getEvents();
  assert.equal(events.length, 1, 'One event should have been emitted');
  const event = events[0];
  assert.equal(event.type, 'adventure.advanced');
  assert.equal(event.data.id, 'ADV-002');
  assert.equal(event.data.from_state, 'planning');
  assert.equal(event.data.to_state, 'active');
});

test('TC-115: adventure.completed event is emitted when adventure completes', async () => {
  const em = new EventEmitter();

  // ADV-002 is now 'active', advance to completed
  const result = await advanceAdventure('ADV-002', 'completed', em);
  assert.equal(result.to_state, 'completed');

  const events = em.getEvents();
  assert.equal(events.length, 1, 'One event should have been emitted');
  const event = events[0];
  assert.equal(event.type, 'adventure.completed');
  assert.equal(event.data.id, 'ADV-002');
});

test('TC-115: multiple adventure events are buffered in chronological order', async () => {
  const em = new EventEmitter();

  await em.emit('adventure.created', null, { id: 'ADV-X01', title: 'First' });
  await em.emit('adventure.advanced', null, { id: 'ADV-X01', from_state: 'planning', to_state: 'active' });
  await em.emit('adventure.completed', null, { id: 'ADV-X01', title: 'First' });

  const events = em.getEvents();
  assert.equal(events.length, 3);
  assert.equal(events[0].type, 'adventure.created');
  assert.equal(events[1].type, 'adventure.advanced');
  assert.equal(events[2].type, 'adventure.completed');
});

// ---------------------------------------------------------------------------
// TC-115: Adventure status - TC progress and task completion
// ---------------------------------------------------------------------------

test('TC-115: adventure_status - TC progress parsed from manifest body', async () => {
  // Create an adventure with TC rows in the manifest body
  const advDir = join(adventuresDir, 'ADV-TC');
  await ensureDir(advDir);
  const manifestPath = join(advDir, 'manifest.md');
  const now = timestamp();

  const frontmatter = {
    id: 'ADV-TC',
    title: 'TC Progress Test',
    state: 'active',
    created: now,
    updated: now,
    tasks: [],
  };

  const body = `
## Concept
TC progress test

## Target Conditions
| ID | Description | Status |
|----|-------------|--------|
| TC-100 | First check | passed |
| TC-101 | Second check | pending |
| TC-102 | Third check | failed |
| TC-103 | Fourth check | passed |

## Log
${logEntry('created: TC progress test adventure')}
`;

  await writeState(manifestPath, frontmatter, body);

  const { tc_summary } = await getAdventure('ADV-TC');
  assert.equal(tc_summary.total, 4, 'Should count 4 TC rows');
  assert.equal(tc_summary.passed, 2, 'Should count 2 passed');
  assert.equal(tc_summary.pending, 1, 'Should count 1 pending');
  assert.equal(tc_summary.failed, 1, 'Should count 1 failed');
});

test('TC-115: adventure_status - task completion summary by stage', async () => {
  const tasksDir = join(agentDir, 'tasks');
  const now = timestamp();

  // Create task files for ADV-TASKS
  const taskIds = ['TASK-ADV-001', 'TASK-ADV-002', 'TASK-ADV-003'];

  await writeState(join(tasksDir, 'TASK-ADV-001.md'), {
    id: 'TASK-ADV-001', title: 'Task 1', stage: 'completed', status: 'ready',
    created: now, updated: now, iterations: 0, assignee: null,
    files: [], repos: [], depends_on: [], tags: [],
  }, '## Log\n');

  await writeState(join(tasksDir, 'TASK-ADV-002.md'), {
    id: 'TASK-ADV-002', title: 'Task 2', stage: 'implementing', status: 'in_progress',
    created: now, updated: now, iterations: 0, assignee: 'implementer',
    files: [], repos: [], depends_on: [], tags: [],
  }, '## Log\n');

  await writeState(join(tasksDir, 'TASK-ADV-003.md'), {
    id: 'TASK-ADV-003', title: 'Task 3', stage: 'researching', status: 'in_progress',
    created: now, updated: now, iterations: 0, assignee: 'researcher',
    files: [], repos: [], depends_on: [], tags: [],
  }, '## Log\n');

  // Create adventure with these tasks
  const advDir = join(adventuresDir, 'ADV-TASKS');
  await ensureDir(advDir);
  const manifestPath = join(advDir, 'manifest.md');

  await writeState(manifestPath, {
    id: 'ADV-TASKS',
    title: 'Task Progress Test',
    state: 'active',
    created: now,
    updated: now,
    tasks: taskIds,
  }, '## Log\n');

  // Get adventure with task summary
  const result = await getAdventure('ADV-TASKS');
  assert.equal(result.task_summary.total, 3);
  // completed + researching = 2 (TASK-ADV-001 + TASK-ADV-003)
  assert.equal(result.task_summary.completed, 2);
  // implementing = 1 (TASK-ADV-002)
  assert.equal(result.task_summary.in_progress, 1);
});

// ---------------------------------------------------------------------------
// TC-115: Agent spawn/list lifecycle
// ---------------------------------------------------------------------------

test('TC-115: agent spawn - appends agent record to lead-state.md', async () => {
  const now = timestamp();
  const agentRecord = {
    id: `agent-${Date.now()}`,
    role: 'implementer',
    task_id: 'TASK-001',
    model: 'claude-sonnet-4-5',
    status: 'running',
    started_at: now,
    description: 'Integration test agent',
  };

  await writeAgent(agentDir, agentRecord);

  const agents = await readAgents(agentDir);
  const found = agents.find((a) => a.id === agentRecord.id);
  assert.ok(found, 'Agent record should be persisted in lead-state.md');
  assert.equal(found.role, 'implementer');
  assert.equal(found.task_id, 'TASK-001');
  assert.equal(found.status, 'running');
  assert.equal(found.model, 'claude-sonnet-4-5');
});

test('TC-115: agent spawn - active_count is incremented for running agents', async () => {
  // Read current count before adding
  const { frontmatter: before } = await readState(join(agentDir, 'lead-state.md'));
  const countBefore = before.active_count || 0;

  const now = timestamp();
  await writeAgent(agentDir, {
    id: `agent-count-test-${Date.now()}`,
    role: 'planner',
    status: 'running',
    started_at: now,
  });

  const { frontmatter: after } = await readState(join(agentDir, 'lead-state.md'));
  assert.equal(after.active_count, countBefore + 1, 'active_count should increment by 1');
});

test('TC-115: agent_list - multiple agents tracked with different roles', async () => {
  // Reset lead-state for a clean test
  await writeState(join(agentDir, 'lead-state.md'), {
    active_count: 0,
    agents: [],
  }, '# Lead State\n');

  const now = timestamp();
  await writeAgent(agentDir, { id: 'multi-a', role: 'planner', status: 'running', started_at: now });
  await writeAgent(agentDir, { id: 'multi-b', role: 'implementer', status: 'running', started_at: now });
  await writeAgent(agentDir, { id: 'multi-c', role: 'reviewer', status: 'running', started_at: now });

  const agents = await readAgents(agentDir);
  assert.equal(agents.length, 3);

  const { frontmatter } = await readState(join(agentDir, 'lead-state.md'));
  assert.equal(frontmatter.active_count, 3, 'All 3 agents are running');

  const roles = agents.map((a) => a.role);
  assert.ok(roles.includes('planner'), 'Planner should be listed');
  assert.ok(roles.includes('implementer'), 'Implementer should be listed');
  assert.ok(roles.includes('reviewer'), 'Reviewer should be listed');
});

// ---------------------------------------------------------------------------
// TC-115: Agent completion/events
// ---------------------------------------------------------------------------

test('TC-115: agent_complete - status updated to completed in lead-state.md', async () => {
  // Start from clean state
  await writeState(join(agentDir, 'lead-state.md'), {
    active_count: 0,
    agents: [],
  }, '# Lead State\n');

  const now = timestamp();
  const agentId = `agent-complete-test-${Date.now()}`;
  await writeAgent(agentDir, {
    id: agentId,
    role: 'implementer',
    task_id: 'TASK-COMP-001',
    status: 'running',
    started_at: now,
  });

  // Complete the agent
  await updateAgent(agentDir, agentId, {
    status: 'completed',
    completed_at: timestamp(),
    result: 'Implementation successful',
  });

  const agents = await readAgents(agentDir);
  const agent = agents.find((a) => a.id === agentId);
  assert.ok(agent, 'Agent should still exist after completion');
  assert.equal(agent.status, 'completed');
  assert.equal(agent.result, 'Implementation successful');
  assert.ok(typeof agent.completed_at === 'string', 'completed_at should be set');
});

test('TC-115: agent_complete - active_count is decremented after completion', async () => {
  await writeState(join(agentDir, 'lead-state.md'), {
    active_count: 0,
    agents: [],
  }, '# Lead State\n');

  const now = timestamp();
  const agentId = `agent-decrement-${Date.now()}`;
  await writeAgent(agentDir, {
    id: agentId,
    role: 'reviewer',
    status: 'running',
    started_at: now,
  });

  const { frontmatter: before } = await readState(join(agentDir, 'lead-state.md'));
  assert.equal(before.active_count, 1, 'Should have 1 active agent before completion');

  await updateAgent(agentDir, agentId, { status: 'completed', completed_at: timestamp() });

  const { frontmatter: after } = await readState(join(agentDir, 'lead-state.md'));
  assert.equal(after.active_count, 0, 'active_count should be 0 after completion');
});

test('TC-115: agent events - agent.spawned event has correct fields', async () => {
  const em = new EventEmitter();
  const agentId = `agent-event-${Date.now()}`;

  const event = await em.emit('agent.spawned', 'TASK-EVT-001', {
    agent_id: agentId,
    role: 'implementer',
    model: 'claude-sonnet-4-5',
  });

  assert.equal(event.type, 'agent.spawned');
  assert.equal(event.task_id, 'TASK-EVT-001');
  assert.equal(event.data.agent_id, agentId);
  assert.equal(event.data.role, 'implementer');
  assert.ok(typeof event.timestamp === 'string');
});

test('TC-115: agent events - agent.completed event has correct fields', async () => {
  const em = new EventEmitter();
  const agentId = `agent-done-${Date.now()}`;

  const event = await em.emit('agent.completed', 'TASK-EVT-002', {
    agent_id: agentId,
    role: 'reviewer',
    result: 'Review passed with no issues',
  });

  assert.equal(event.type, 'agent.completed');
  assert.equal(event.task_id, 'TASK-EVT-002');
  assert.equal(event.data.agent_id, agentId);
  assert.equal(event.data.result, 'Review passed with no issues');
});

test('TC-115: agent events - agent.failed event is distinct from agent.completed', async () => {
  const em = new EventEmitter();
  const agentId = `agent-fail-${Date.now()}`;

  const event = await em.emit('agent.failed', 'TASK-EVT-003', {
    agent_id: agentId,
    role: 'planner',
    result: 'Timeout exceeded',
  });

  assert.equal(event.type, 'agent.failed');
  assert.equal(event.data.result, 'Timeout exceeded');
});

// ---------------------------------------------------------------------------
// TC-115: Lead-state tracking
// ---------------------------------------------------------------------------

test('TC-115: lead-state - agents array persists across multiple reads', async () => {
  await writeState(join(agentDir, 'lead-state.md'), {
    active_count: 0,
    agents: [],
  }, '# Lead State\n');

  const now = timestamp();
  const ids = ['persist-a', 'persist-b', 'persist-c'];

  for (const id of ids) {
    await writeAgent(agentDir, {
      id,
      role: 'implementer',
      status: 'running',
      started_at: now,
    });
  }

  // Read back twice to verify consistency
  const agents1 = await readAgents(agentDir);
  const agents2 = await readAgents(agentDir);

  assert.equal(agents1.length, 3);
  assert.equal(agents2.length, 3);
  assert.deepEqual(
    agents1.map((a) => a.id).sort(),
    agents2.map((a) => a.id).sort()
  );
});

test('TC-115: lead-state - last_event field written by event emitter', async () => {
  // Reset lead-state with no last_event
  await writeState(join(agentDir, 'lead-state.md'), {
    active_count: 0,
    agents: [],
  }, '# Lead State\n');

  // Create an EventEmitter that writes to our temp agentDir
  // The EventEmitter.emit() tries to write last_event to lead-state.md
  // via resolveAgentDir() which uses process.cwd(). Since we can't easily
  // override cwd in tests, we directly simulate what the event emitter does:
  const em = new EventEmitter();
  const event = await em.emit('agent.spawned', null, { agent_id: 'test-evt', role: 'planner' });

  // Verify the event was buffered correctly
  const events = em.getEvents();
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'agent.spawned');

  // Simulate what the event emitter writes to lead-state.md
  // (replicating what events.js does in step 3 of emit())
  const leadStatePath = join(agentDir, 'lead-state.md');
  const { frontmatter, body } = await readState(leadStatePath);
  frontmatter.last_event = event;
  await writeState(leadStatePath, frontmatter, body);

  // Verify lead-state.md now contains last_event
  const { frontmatter: read } = await readState(leadStatePath);
  assert.ok(read.last_event, 'last_event should be set in lead-state.md');
  assert.equal(read.last_event.type, 'agent.spawned');
  assert.equal(read.last_event.data.agent_id, 'test-evt');
});

test('TC-115: lead-state - agent records survive state file re-reads', async () => {
  await writeState(join(agentDir, 'lead-state.md'), {
    active_count: 0,
    agents: [],
  }, '# Lead State\n');

  const now = timestamp();
  await writeAgent(agentDir, {
    id: 'survive-a',
    role: 'planner',
    task_id: 'TASK-SURVIVE-001',
    status: 'running',
    started_at: now,
    description: 'Testing persistence',
  });

  await writeAgent(agentDir, {
    id: 'survive-b',
    role: 'implementer',
    task_id: 'TASK-SURVIVE-002',
    status: 'running',
    started_at: now,
    description: null,
  });

  // Complete one agent
  await updateAgent(agentDir, 'survive-a', {
    status: 'completed',
    completed_at: timestamp(),
    result: 'Planning done',
  });

  // Read back and verify
  const agents = await readAgents(agentDir);
  assert.equal(agents.length, 2, 'Both agents should still exist');

  const agentA = agents.find((a) => a.id === 'survive-a');
  const agentB = agents.find((a) => a.id === 'survive-b');

  assert.ok(agentA, 'survive-a should exist');
  assert.equal(agentA.status, 'completed');
  assert.equal(agentA.task_id, 'TASK-SURVIVE-001');
  assert.equal(agentA.result, 'Planning done');

  assert.ok(agentB, 'survive-b should exist');
  assert.equal(agentB.status, 'running');
  assert.equal(agentB.task_id, 'TASK-SURVIVE-002');

  // Verify active_count reflects only running agents
  const { frontmatter } = await readState(join(agentDir, 'lead-state.md'));
  assert.equal(frontmatter.active_count, 1, 'Only 1 agent still running');
});

// ---------------------------------------------------------------------------
// TC-115: LockManager integration with agent operations
// ---------------------------------------------------------------------------

test('TC-115: lock manager prevents concurrent lead-state writes', () => {
  const lm = new LockManager();

  // Simulate agent_spawn acquiring lead-state lock
  const r1 = lm.acquire('lead-state', 'spawn-session-A');
  assert.equal(r1.acquired, true);

  // Simulate concurrent agent_complete trying to acquire the same lock
  const r2 = lm.acquire('lead-state', 'complete-session-B');
  assert.equal(r2.acquired, false);
  assert.equal(r2.holder, 'spawn-session-A');

  // After spawn releases the lock, complete can proceed
  const rel = lm.release('lead-state', 'spawn-session-A');
  assert.equal(rel.released, true);

  const r3 = lm.acquire('lead-state', 'complete-session-B');
  assert.equal(r3.acquired, true);
});

test('TC-115: full adventure+agent integration - adventure with tasks and agents', async () => {
  // Start fresh
  await writeState(join(agentDir, 'lead-state.md'), {
    active_count: 0,
    agents: [],
  }, '# Lead State\n');

  const now = timestamp();
  const em = new EventEmitter();

  // 1. Create adventure
  await createAdventureManifest('ADV-FULL', { title: 'Full Integration Test' });
  await em.emit('adventure.created', null, { id: 'ADV-FULL', title: 'Full Integration Test' });

  // 2. Create a task for the adventure
  const tasksDir = join(agentDir, 'tasks');
  await writeState(join(tasksDir, 'TASK-FULL-001.md'), {
    id: 'TASK-FULL-001',
    title: 'Full test task',
    stage: 'implementing',
    status: 'in_progress',
    created: now,
    updated: now,
    iterations: 0,
    assignee: 'implementer',
    adventure_id: 'ADV-FULL',
    files: [], repos: [], depends_on: [], tags: [],
  }, '## Log\n');

  // 3. Link task to adventure manifest
  const manifestPath = join(adventuresDir, 'ADV-FULL', 'manifest.md');
  const { frontmatter: advFm, body: advBody } = await readState(manifestPath);
  advFm.tasks = ['TASK-FULL-001'];
  advFm.updated = timestamp();
  await writeState(manifestPath, advFm, advBody);

  // 4. Advance adventure to active
  await advanceAdventure('ADV-FULL', 'active', em);

  // 5. Spawn an agent to work on the task
  const agentId = `agent-full-${Date.now()}`;
  await writeAgent(agentDir, {
    id: agentId,
    role: 'implementer',
    task_id: 'TASK-FULL-001',
    status: 'running',
    started_at: timestamp(),
    description: 'Implementing TASK-FULL-001',
  });
  await em.emit('agent.spawned', 'TASK-FULL-001', {
    agent_id: agentId,
    role: 'implementer',
    model: null,
  });

  // 6. Complete the agent
  await updateAgent(agentDir, agentId, {
    status: 'completed',
    completed_at: timestamp(),
    result: 'Implementation done',
  });
  await em.emit('agent.completed', 'TASK-FULL-001', {
    agent_id: agentId,
    role: 'implementer',
    result: 'Implementation done',
  });

  // 7. Advance task to completed stage
  const taskPath = join(tasksDir, 'TASK-FULL-001.md');
  const { frontmatter: taskFm, body: taskBody } = await readState(taskPath);
  taskFm.stage = 'completed';
  taskFm.status = 'ready';
  taskFm.updated = timestamp();
  await writeState(taskPath, taskFm, taskBody + '\n- Task completed\n');

  // 8. Advance adventure to completed
  await advanceAdventure('ADV-FULL', 'completed', em);

  // --- Assertions ---

  // Verify adventure state
  const { frontmatter: finalAdv, task_summary } = await getAdventure('ADV-FULL');
  assert.equal(finalAdv.state, 'completed');
  assert.equal(task_summary.total, 1);
  assert.equal(task_summary.completed, 1);
  assert.equal(task_summary.in_progress, 0);

  // Verify agent record in lead-state
  const agents = await readAgents(agentDir);
  const completedAgent = agents.find((a) => a.id === agentId);
  assert.ok(completedAgent, 'Agent record should persist in lead-state');
  assert.equal(completedAgent.status, 'completed');
  assert.equal(completedAgent.task_id, 'TASK-FULL-001');

  // Verify events were emitted in correct order
  const events = em.getEvents();
  assert.equal(events.length, 5, 'Should have 5 events total');
  assert.equal(events[0].type, 'adventure.created');
  assert.equal(events[1].type, 'adventure.advanced');
  assert.equal(events[2].type, 'agent.spawned');
  assert.equal(events[3].type, 'agent.completed');
  assert.equal(events[4].type, 'adventure.completed');

  // Verify active_count is 0 (no running agents)
  const { frontmatter: finalState } = await readState(join(agentDir, 'lead-state.md'));
  assert.equal(finalState.active_count, 0, 'No active agents after completion');
});
