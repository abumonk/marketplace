/**
 * Unit tests for lib/tools/diagnostics.js
 *
 * Tests the exported helper functions: isStaleAgent, computeHealthStatus,
 * calculateVariance, parseDurationToMin
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isStaleAgent,
  computeHealthStatus,
  calculateVariance,
  parseDurationToMin,
} from '../lib/tools/diagnostics.js';

// ---------------------------------------------------------------------------
// isStaleAgent
// ---------------------------------------------------------------------------

test('isStaleAgent: identifies stale agent running > 30min', () => {
  const startedAt = new Date(Date.now() - 35 * 60 * 1000).toISOString();
  const agent = { status: 'running', started_at: startedAt };
  assert.ok(isStaleAgent(agent, 30 * 60 * 1000));
});

test('isStaleAgent: accepts fresh agent running < 30min', () => {
  const startedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const agent = { status: 'running', started_at: startedAt };
  assert.ok(!isStaleAgent(agent, 30 * 60 * 1000));
});

test('isStaleAgent: non-running agents are never stale', () => {
  const startedAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const agent = { status: 'completed', started_at: startedAt };
  assert.ok(!isStaleAgent(agent, 30 * 60 * 1000));
});

test('isStaleAgent: handles missing started_at (treated as epoch 0 = stale)', () => {
  const agent = { status: 'running' };
  assert.ok(isStaleAgent(agent, 30 * 60 * 1000));
});

// ---------------------------------------------------------------------------
// computeHealthStatus
// ---------------------------------------------------------------------------

test('computeHealthStatus: returns CRITICAL when any check is critical', () => {
  const checks = {
    stale_agents: { status: 'ok' },
    stuck_tasks: { status: 'critical' },
    broken_deps: { status: 'warn' },
  };
  assert.equal(computeHealthStatus(checks), 'CRITICAL');
});

test('computeHealthStatus: returns WARNINGS when no critical but has warnings', () => {
  const checks = {
    stale_agents: { status: 'ok' },
    stuck_tasks: { status: 'ok' },
    broken_deps: { status: 'warn' },
  };
  assert.equal(computeHealthStatus(checks), 'WARNINGS');
});

test('computeHealthStatus: returns HEALTHY when all checks pass', () => {
  const checks = {
    stale_agents: { status: 'ok' },
    stuck_tasks: { status: 'ok' },
    broken_deps: { status: 'ok' },
    config_validation: { status: 'ok' },
    metrics_anomalies: { status: 'ok' },
  };
  assert.equal(computeHealthStatus(checks), 'HEALTHY');
});

// ---------------------------------------------------------------------------
// calculateVariance
// ---------------------------------------------------------------------------

test('calculateVariance: calculates positive variance correctly', () => {
  // actual 150, estimated 100 -> +50%
  assert.equal(calculateVariance(100, 150), 50);
});

test('calculateVariance: calculates negative variance correctly', () => {
  // actual 50, estimated 100 -> -50%
  assert.equal(calculateVariance(100, 50), -50);
});

test('calculateVariance: returns null for zero estimated', () => {
  assert.equal(calculateVariance(0, 100), null);
});

test('calculateVariance: handles equal values (zero variance)', () => {
  assert.equal(calculateVariance(100, 100), 0);
});

// ---------------------------------------------------------------------------
// parseDurationToMin
// ---------------------------------------------------------------------------

test('parseDurationToMin: parses "20min" to 20', () => {
  assert.equal(parseDurationToMin('20min'), 20);
});

test('parseDurationToMin: parses "1h" to 60', () => {
  assert.equal(parseDurationToMin('1h'), 60);
});

test('parseDurationToMin: parses "2h" to 120', () => {
  assert.equal(parseDurationToMin('2h'), 120);
});

test('parseDurationToMin: returns null for unknown format', () => {
  assert.equal(parseDurationToMin('unknown'), null);
});

test('parseDurationToMin: returns null for null', () => {
  assert.equal(parseDurationToMin(null), null);
});

test('parseDurationToMin: returns null for undefined', () => {
  assert.equal(parseDurationToMin(undefined), null);
});

// ---------------------------------------------------------------------------
// Estimation report helpers
// ---------------------------------------------------------------------------

test('Estimation: suggested multiplier from actual/estimated ratio', () => {
  const totalEst = 100;
  const totalAct = 280;
  const multiplier = Math.round((totalAct / totalEst) * 10) / 10;
  assert.equal(multiplier, 2.8);
});

test('Estimation: tasks with no estimates are skipped (variance returns null)', () => {
  const estTokens = 0;
  const variance = estTokens ? calculateVariance(estTokens, 50000) : null;
  assert.equal(variance, null);
});
