/**
 * Unit tests for agent-related state helpers in lib/state.js.
 *
 * Covers:
 *   - readAgents: empty array when no agents key
 *   - writeAgent: appends agent record, updates active_count
 *   - writeAgent: multiple agents tracked correctly
 *   - updateAgent: modifies existing agent fields
 *   - updateAgent: throws for non-existent agent id
 *   - cleanupStaleAgents: marks old running agents as stale
 *   - cleanupStaleAgents: leaves recent running agents alone
 *   - active_count: decremented when agent status changes from running
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtemp, rm } from 'fs/promises';
import {
  readAgents,
  writeAgent,
  updateAgent,
  cleanupStaleAgents,
  writeState,
  readState,
  ensureDir,
} from '../lib/state.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create an initial lead-state.md in the given agentDir.
 */
async function createLeadState(agentDir, extraFrontmatter = {}) {
  const frontmatter = {
    active_count: 0,
    agents: [],
    ...extraFrontmatter,
  };
  await writeState(join(agentDir, 'lead-state.md'), frontmatter, '');
}

// ---------------------------------------------------------------------------
// readAgents
// ---------------------------------------------------------------------------

test('readAgents: returns empty array when agents key is missing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-test-'));
  try {
    // Write lead-state.md with no agents key
    await writeState(join(dir, 'lead-state.md'), { active_count: 0 }, '');
    const agents = await readAgents(dir);
    assert.deepEqual(agents, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('readAgents: returns empty array when agents key is empty array', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-test-'));
  try {
    await createLeadState(dir);
    const agents = await readAgents(dir);
    assert.deepEqual(agents, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// writeAgent
// ---------------------------------------------------------------------------

test('writeAgent: appends agent record to lead-state.md', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-test-'));
  try {
    await createLeadState(dir);
    const record = { id: 'agent-1', role: 'implementer', status: 'running', started_at: new Date().toISOString() };
    await writeAgent(dir, record);

    const agents = await readAgents(dir);
    assert.equal(agents.length, 1);
    assert.equal(agents[0].id, 'agent-1');
    assert.equal(agents[0].role, 'implementer');
    assert.equal(agents[0].status, 'running');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('writeAgent: updates active_count when agent is running', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-test-'));
  try {
    await createLeadState(dir);
    const record = { id: 'agent-2', role: 'planner', status: 'running', started_at: new Date().toISOString() };
    await writeAgent(dir, record);

    const { frontmatter } = await readState(join(dir, 'lead-state.md'));
    assert.equal(frontmatter.active_count, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('writeAgent: multiple agents tracked correctly', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-test-'));
  try {
    await createLeadState(dir);

    const now = new Date().toISOString();
    await writeAgent(dir, { id: 'agent-a', role: 'planner', status: 'running', started_at: now });
    await writeAgent(dir, { id: 'agent-b', role: 'implementer', status: 'running', started_at: now });
    await writeAgent(dir, { id: 'agent-c', role: 'reviewer', status: 'done', started_at: now });

    const agents = await readAgents(dir);
    assert.equal(agents.length, 3);

    const { frontmatter } = await readState(join(dir, 'lead-state.md'));
    // Only 2 agents have status 'running'
    assert.equal(frontmatter.active_count, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('writeAgent: non-running agent does not increment active_count', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-test-'));
  try {
    await createLeadState(dir);
    const now = new Date().toISOString();
    await writeAgent(dir, { id: 'agent-done', role: 'reviewer', status: 'done', started_at: now });

    const { frontmatter } = await readState(join(dir, 'lead-state.md'));
    assert.equal(frontmatter.active_count, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// updateAgent
// ---------------------------------------------------------------------------

test('updateAgent: modifies existing agent fields', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-test-'));
  try {
    await createLeadState(dir);
    const now = new Date().toISOString();
    await writeAgent(dir, { id: 'agent-x', role: 'implementer', status: 'running', started_at: now });

    await updateAgent(dir, 'agent-x', { status: 'done', finished_at: now });

    const agents = await readAgents(dir);
    const agent = agents.find((a) => a.id === 'agent-x');
    assert.ok(agent, 'agent should still exist');
    assert.equal(agent.status, 'done');
    assert.equal(agent.finished_at, now);
    assert.equal(agent.role, 'implementer'); // unchanged field preserved
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('updateAgent: throws for non-existent agent id', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-test-'));
  try {
    await createLeadState(dir);
    await assert.rejects(
      () => updateAgent(dir, 'nonexistent-id', { status: 'done' }),
      (err) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes('nonexistent-id'));
        return true;
      }
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// active_count decrement when status changes from running
// ---------------------------------------------------------------------------

test('active_count: decremented when agent status changes from running', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-test-'));
  try {
    await createLeadState(dir);
    const now = new Date().toISOString();
    await writeAgent(dir, { id: 'agent-running', role: 'implementer', status: 'running', started_at: now });

    // Confirm count is 1 initially
    const { frontmatter: before } = await readState(join(dir, 'lead-state.md'));
    assert.equal(before.active_count, 1);

    // Update agent to done
    await updateAgent(dir, 'agent-running', { status: 'done' });

    const { frontmatter: after } = await readState(join(dir, 'lead-state.md'));
    assert.equal(after.active_count, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// cleanupStaleAgents
// ---------------------------------------------------------------------------

test('cleanupStaleAgents: marks old running agents as stale', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-test-'));
  try {
    await createLeadState(dir);

    // Use a started_at time far in the past (1 hour ago)
    const oldTime = new Date(Date.now() - 3_600_000).toISOString();
    await writeAgent(dir, { id: 'stale-agent', role: 'planner', status: 'running', started_at: oldTime });

    // Run cleanup with default 5-minute timeout -- old agent should be stale
    const staleIds = await cleanupStaleAgents(dir);
    assert.ok(staleIds.includes('stale-agent'));

    const agents = await readAgents(dir);
    const agent = agents.find((a) => a.id === 'stale-agent');
    assert.equal(agent.status, 'stale');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('cleanupStaleAgents: leaves recent running agents alone', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-test-'));
  try {
    await createLeadState(dir);

    // Started just now -- should NOT be stale
    const recentTime = new Date().toISOString();
    await writeAgent(dir, { id: 'fresh-agent', role: 'implementer', status: 'running', started_at: recentTime });

    const staleIds = await cleanupStaleAgents(dir);
    assert.ok(!staleIds.includes('fresh-agent'));

    const agents = await readAgents(dir);
    const agent = agents.find((a) => a.id === 'fresh-agent');
    assert.equal(agent.status, 'running');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('cleanupStaleAgents: respects custom timeoutMs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-test-'));
  try {
    await createLeadState(dir);

    // Started 2 seconds ago
    const oldTime = new Date(Date.now() - 2_000).toISOString();
    await writeAgent(dir, { id: 'borderline-agent', role: 'reviewer', status: 'running', started_at: oldTime });

    // With a 1-second timeout, the agent should be stale
    const staleIds = await cleanupStaleAgents(dir, 1_000);
    assert.ok(staleIds.includes('borderline-agent'));

    // With a 1-hour timeout, the agent should NOT be stale (run on fresh state)
    const dir2 = await mkdtemp(join(tmpdir(), 'agent-test-'));
    try {
      await createLeadState(dir2);
      await writeAgent(dir2, { id: 'borderline-agent', role: 'reviewer', status: 'running', started_at: oldTime });
      const staleIds2 = await cleanupStaleAgents(dir2, 3_600_000);
      assert.ok(!staleIds2.includes('borderline-agent'));
    } finally {
      await rm(dir2, { recursive: true, force: true });
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('cleanupStaleAgents: leaves done agents unchanged', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-test-'));
  try {
    await createLeadState(dir);

    const oldTime = new Date(Date.now() - 3_600_000).toISOString();
    await writeAgent(dir, { id: 'done-agent', role: 'reviewer', status: 'done', started_at: oldTime });

    // Only 'running' agents can become stale
    const staleIds = await cleanupStaleAgents(dir);
    assert.ok(!staleIds.includes('done-agent'));

    const agents = await readAgents(dir);
    const agent = agents.find((a) => a.id === 'done-agent');
    assert.equal(agent.status, 'done');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('cleanupStaleAgents: updates active_count after marking stale', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-test-'));
  try {
    await createLeadState(dir);

    const oldTime = new Date(Date.now() - 3_600_000).toISOString();
    const recentTime = new Date().toISOString();
    await writeAgent(dir, { id: 'stale-1', role: 'planner', status: 'running', started_at: oldTime });
    await writeAgent(dir, { id: 'fresh-1', role: 'implementer', status: 'running', started_at: recentTime });

    // Before cleanup: 2 running agents
    const { frontmatter: before } = await readState(join(dir, 'lead-state.md'));
    assert.equal(before.active_count, 2);

    await cleanupStaleAgents(dir);

    // After cleanup: only 1 running (fresh-1)
    const { frontmatter: after } = await readState(join(dir, 'lead-state.md'));
    assert.equal(after.active_count, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// ensureDir
// ---------------------------------------------------------------------------

test('ensureDir: creates directory if it does not exist', async () => {
  const base = await mkdtemp(join(tmpdir(), 'agent-test-'));
  try {
    const subDir = join(base, 'sub', 'nested');
    await ensureDir(subDir);
    // Verify the directory exists by trying to write a file in it
    await writeState(join(subDir, 'lead-state.md'), { active_count: 0, agents: [] }, '');
    const { frontmatter } = await readState(join(subDir, 'lead-state.md'));
    assert.equal(frontmatter.active_count, 0);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
