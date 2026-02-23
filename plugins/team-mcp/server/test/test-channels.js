/**
 * Tests for messaging channel system.
 *
 * Run with: node --test server/test/test-channels.js
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { formatForTelegram, formatForDiscord, applyTemplate } from '../lib/channels/formatter.js';
import { TelegramChannel } from '../lib/channels/telegram.js';
import { DiscordChannel } from '../lib/channels/discord.js';
import { ChannelManager } from '../lib/channels/manager.js';
import { EventEmitter } from '../lib/events.js';

// Store original fetch to restore after tests
const originalFetch = global.fetch;

describe('Formatter', () => {
  test('applyTemplate substitutes variables', () => {
    const template = 'Hello {name}, you have {count} messages';
    const result = applyTemplate(template, { name: 'Alice', count: 5 });
    assert.equal(result, 'Hello Alice, you have 5 messages');
  });

  test('applyTemplate leaves unmatched placeholders', () => {
    const template = 'Hello {name}, your {missing} is here';
    const result = applyTemplate(template, { name: 'Bob' });
    assert.equal(result, 'Hello Bob, your {missing} is here');
  });

  test('formatForTelegram handles task.created', () => {
    const event = {
      type: 'task.created',
      timestamp: '2026-02-19T12:00:00Z',
      task_id: 'TASK-001',
      data: {
        title: 'Test task',
        tags: ['backend', 'api'],
        assignee: 'planner',
      },
    };

    const result = formatForTelegram(event);
    assert.match(result, /<b>TASK-001 Created<\/b>/);
    assert.match(result, /<b>Test task<\/b>/);
    assert.match(result, /Tags: backend, api/);
    assert.match(result, /Assignee: planner/);
  });

  test('formatForTelegram handles task.advanced', () => {
    const event = {
      type: 'task.advanced',
      timestamp: '2026-02-19T12:30:00Z',
      task_id: 'TASK-002',
      data: {
        title: 'Implement feature',
        from_stage: 'planning',
        to_stage: 'implementing',
        assignee: 'implementer',
        mode: 'auto',
      },
    };

    const result = formatForTelegram(event);
    assert.match(result, /<b>TASK-002 Advanced to implementing<\/b>/);
    assert.match(result, /Stage: <code>planning<\/code> → <code>implementing<\/code>/);
  });

  test('formatForTelegram handles task.completed', () => {
    const event = {
      type: 'task.completed',
      timestamp: '2026-02-19T14:00:00Z',
      task_id: 'TASK-003',
      data: {
        title: 'Completed task',
        iterations: 2,
        duration_minutes: 45,
        stages_passed: ['planning', 'implementing', 'reviewing', 'completed'],
      },
    };

    const result = formatForTelegram(event);
    assert.match(result, /✅ <b>TASK-003 Completed<\/b>/);
    assert.match(result, /Iterations: 2/);
    assert.match(result, /Duration: 45 min/);
    assert.match(result, /Stages: planning → implementing → reviewing → completed/);
  });

  test('formatForDiscord handles task.created', () => {
    const event = {
      type: 'task.created',
      timestamp: '2026-02-19T12:00:00Z',
      task_id: 'TASK-001',
      data: {
        title: 'Test task',
        tags: ['backend'],
        assignee: 'planner',
      },
    };

    const result = formatForDiscord(event);
    assert.equal(result.title, 'TASK-001 Created');
    assert.match(result.description, /Test task/);
    assert.equal(result.color, 0x3498db); // blue
    assert.equal(result.footer.text, 'team-pipeline');
  });

  test('formatForDiscord handles task.completed', () => {
    const event = {
      type: 'task.completed',
      timestamp: '2026-02-19T14:00:00Z',
      task_id: 'TASK-003',
      data: {
        title: 'Done',
        iterations: 1,
        duration_minutes: 30,
        stages_passed: ['planning', 'implementing', 'completed'],
      },
    };

    const result = formatForDiscord(event);
    assert.equal(result.title, '✅ TASK-003 Completed');
    assert.equal(result.color, 0x2ecc71); // green
  });

  test('formatForDiscord handles task.failed', () => {
    const event = {
      type: 'task.failed',
      timestamp: '2026-02-19T15:00:00Z',
      task_id: 'TASK-004',
      data: {
        title: 'Failed task',
        stage: 'reviewing',
        iteration: 2,
        issues_count: 3,
        issues_summary: 'Missing tests',
      },
    };

    const result = formatForDiscord(event);
    assert.equal(result.title, '❌ TASK-004 Failed');
    assert.equal(result.color, 0xe74c3c); // red
    assert.match(result.description, /Missing tests/);
  });

  test('formatForDiscord handles agent.started', () => {
    const event = {
      type: 'agent.started',
      timestamp: '2026-02-19T12:15:00Z',
      task_id: 'TASK-005',
      data: {
        role: 'implementer',
        stage: 'implementing',
        model: 'sonnet',
        max_turns: 50,
      },
    };

    const result = formatForDiscord(event);
    assert.equal(result.title, '🤖 Agent Started: implementer');
    assert.equal(result.color, 0xf39c12); // yellow
    assert.match(result.description, /Model: sonnet/);
  });
});

describe('TelegramChannel', () => {
  let mockFetch;
  let fetchCalls;

  beforeEach(() => {
    fetchCalls = [];
    mockFetch = async (url, options) => {
      fetchCalls.push({ url, options });
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: {} }),
        text: async () => 'OK',
      };
    };
    global.fetch = mockFetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('send() calls correct URL with HTML message', async () => {
    process.env.TEST_BOT_TOKEN = '123456:ABC';
    process.env.TEST_CHAT_ID = '-1001234567890';

    const config = {
      bot_token_env: 'TEST_BOT_TOKEN',
      chat_id_env: 'TEST_CHAT_ID',
      enabled: true,
    };

    const channel = new TelegramChannel(config);
    const event = { type: 'task.created', timestamp: '2026-02-19T12:00:00Z', task_id: 'TASK-001', data: {} };
    const message = '<b>Test message</b>';

    await channel.send(event, message);

    assert.equal(fetchCalls.length, 1);
    assert.match(fetchCalls[0].url, /https:\/\/api\.telegram\.org\/bot123456:ABC\/sendMessage/);

    const body = JSON.parse(fetchCalls[0].options.body);
    assert.equal(body.chat_id, '-1001234567890');
    assert.equal(body.text, '<b>Test message</b>');
    assert.equal(body.parse_mode, 'HTML');

    delete process.env.TEST_BOT_TOKEN;
    delete process.env.TEST_CHAT_ID;
  });

  test('send() retries on failure', async () => {
    process.env.TEST_BOT_TOKEN = '123456:ABC';
    process.env.TEST_CHAT_ID = '-1001234567890';

    let callCount = 0;
    global.fetch = async (url, options) => {
      callCount++;
      if (callCount === 1) {
        return { ok: false, status: 500, text: async () => 'Error' };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    };

    const config = {
      bot_token_env: 'TEST_BOT_TOKEN',
      chat_id_env: 'TEST_CHAT_ID',
      enabled: true,
    };

    const channel = new TelegramChannel(config);
    const event = { type: 'task.created', timestamp: '2026-02-19T12:00:00Z', task_id: 'TASK-001', data: {} };
    const message = '<b>Test</b>';

    await channel.send(event, message);

    assert.equal(callCount, 2); // Initial call + 1 retry

    delete process.env.TEST_BOT_TOKEN;
    delete process.env.TEST_CHAT_ID;
  });

  test('healthCheck() calls getMe endpoint', async () => {
    process.env.TEST_BOT_TOKEN = '123456:ABC';
    process.env.TEST_CHAT_ID = '-1001234567890';

    const config = {
      bot_token_env: 'TEST_BOT_TOKEN',
      chat_id_env: 'TEST_CHAT_ID',
      enabled: true,
    };

    const channel = new TelegramChannel(config);

    global.fetch = async (url) => {
      return {
        ok: true,
        json: async () => ({ ok: true, result: { username: 'test_bot' } }),
      };
    };

    const health = await channel.healthCheck();

    assert.equal(health.healthy, true);
    assert.match(health.message, /test_bot/);

    delete process.env.TEST_BOT_TOKEN;
    delete process.env.TEST_CHAT_ID;
  });

  test('_handleUpdate parses /approve command', () => {
    const config = {
      bot_token_env: 'TEST_BOT_TOKEN',
      chat_id_env: 'TEST_CHAT_ID',
      enabled: true,
    };

    const channel = new TelegramChannel(config);

    const update = {
      update_id: 1,
      message: {
        text: '/approve TASK-123',
      },
    };

    channel._handleUpdate(update);

    const approvals = channel.getPendingApprovals();
    assert.equal(approvals.length, 1);
    assert.equal(approvals[0].task_id, 'TASK-123');
    assert.equal(approvals[0].action, 'approve');
  });

  test('_handleUpdate parses /reject command', () => {
    const config = {
      bot_token_env: 'TEST_BOT_TOKEN',
      chat_id_env: 'TEST_CHAT_ID',
      enabled: true,
    };

    const channel = new TelegramChannel(config);

    const update = {
      update_id: 2,
      message: {
        text: '/reject TASK-456 Not needed anymore',
      },
    };

    channel._handleUpdate(update);

    const approvals = channel.getPendingApprovals();
    assert.equal(approvals.length, 1);
    assert.equal(approvals[0].task_id, 'TASK-456');
    assert.equal(approvals[0].action, 'reject');
    assert.equal(approvals[0].reason, 'Not needed anymore');
  });
});

describe('DiscordChannel', () => {
  let mockFetch;
  let fetchCalls;

  beforeEach(() => {
    fetchCalls = [];
    mockFetch = async (url, options) => {
      fetchCalls.push({ url, options });
      return {
        ok: true,
        status: 200,
        json: async () => ({ name: 'test-webhook' }),
        text: async () => 'OK',
      };
    };
    global.fetch = mockFetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('send() posts embed to webhook URL', async () => {
    process.env.TEST_WEBHOOK_URL = 'https://discord.com/api/webhooks/123/abc';

    const config = {
      webhook_url_env: 'TEST_WEBHOOK_URL',
      enabled: true,
    };

    const channel = new DiscordChannel(config);
    const event = { type: 'task.created', timestamp: '2026-02-19T12:00:00Z', task_id: 'TASK-001', data: {} };
    const embed = {
      title: 'TASK-001 Created',
      description: 'Test',
      color: 0x3498db,
    };

    await channel.send(event, embed);

    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].url, 'https://discord.com/api/webhooks/123/abc');

    const body = JSON.parse(fetchCalls[0].options.body);
    assert.equal(body.embeds.length, 1);
    assert.equal(body.embeds[0].title, 'TASK-001 Created');

    delete process.env.TEST_WEBHOOK_URL;
  });

  test('send() retries on failure', async () => {
    process.env.TEST_WEBHOOK_URL = 'https://discord.com/api/webhooks/123/abc';

    let callCount = 0;
    global.fetch = async (url, options) => {
      callCount++;
      if (callCount === 1) {
        return { ok: false, status: 429, text: async () => 'Rate limited' };
      }
      return { ok: true, status: 200 };
    };

    const config = {
      webhook_url_env: 'TEST_WEBHOOK_URL',
      enabled: true,
    };

    const channel = new DiscordChannel(config);
    const event = { type: 'task.created', timestamp: '2026-02-19T12:00:00Z', task_id: 'TASK-001', data: {} };
    const embed = { title: 'Test', description: 'Test', color: 0x3498db };

    await channel.send(event, embed);

    assert.equal(callCount, 2); // Initial call + 1 retry

    delete process.env.TEST_WEBHOOK_URL;
  });

  test('healthCheck() returns healthy when webhook is valid', async () => {
    process.env.TEST_WEBHOOK_URL = 'https://discord.com/api/webhooks/123/abc';

    const config = {
      webhook_url_env: 'TEST_WEBHOOK_URL',
      enabled: true,
    };

    const channel = new DiscordChannel(config);

    global.fetch = async (url) => {
      return {
        ok: true,
        json: async () => ({ name: 'my-webhook' }),
      };
    };

    const health = await channel.healthCheck();

    assert.equal(health.healthy, true);
    assert.match(health.message, /my-webhook/);

    delete process.env.TEST_WEBHOOK_URL;
  });
});

describe('ChannelManager', () => {
  test('_forwardEvent filters events by channel config', async () => {
    // Create a mock EventEmitter
    const emitter = new EventEmitter();

    // Create a minimal mock config
    const manager = new ChannelManager(emitter);
    manager.config = {
      channels: {
        telegram: {
          events: ['task.completed', 'task.failed'],
        },
      },
    };

    // Create a mock Telegram channel
    const mockChannel = {
      name: 'telegram',
      enabled: true,
      send: async (event, message) => {
        mockChannel.lastEvent = event;
      },
    };

    manager.channels = [mockChannel];
    manager.initialized = true;

    // Forward an event that should be filtered OUT
    const filteredEvent = {
      type: 'task.created',
      timestamp: '2026-02-19T12:00:00Z',
      task_id: 'TASK-001',
      data: {},
    };

    await manager._forwardEvent(filteredEvent);
    assert.equal(mockChannel.lastEvent, undefined); // Not sent

    // Forward an event that should pass through
    const passEvent = {
      type: 'task.completed',
      timestamp: '2026-02-19T12:00:00Z',
      task_id: 'TASK-002',
      data: {},
    };

    await manager._forwardEvent(passEvent);
    assert.equal(mockChannel.lastEvent.task_id, 'TASK-002'); // Sent
  });

  test('_forwardEvent respects "all" events filter', async () => {
    const emitter = new EventEmitter();

    const manager = new ChannelManager(emitter);
    manager.config = {
      channels: {
        telegram: {
          events: ['all'],
        },
      },
    };

    const mockChannel = {
      name: 'telegram',
      enabled: true,
      send: async (event, message) => {
        mockChannel.lastEvent = event;
      },
    };

    manager.channels = [mockChannel];
    manager.initialized = true;

    const anyEvent = {
      type: 'task.created',
      timestamp: '2026-02-19T12:00:00Z',
      task_id: 'TASK-003',
      data: {},
    };

    await manager._forwardEvent(anyEvent);
    assert.equal(mockChannel.lastEvent.task_id, 'TASK-003'); // Sent
  });

  test('getPendingApprovals aggregates across channels', () => {
    const emitter = new EventEmitter();
    const manager = new ChannelManager(emitter);

    const mockChannel1 = {
      name: 'telegram',
      enabled: true,
      getPendingApprovals: () => [
        { task_id: 'TASK-001', action: 'approve' },
        { task_id: 'TASK-002', action: 'reject', reason: 'Not needed' },
      ],
    };

    const mockChannel2 = {
      name: 'discord',
      enabled: true,
      getPendingApprovals: () => [],
    };

    manager.channels = [mockChannel1, mockChannel2];

    const approvals = manager.getPendingApprovals();
    assert.equal(approvals.length, 2);
    assert.equal(approvals[0].channel, 'telegram');
    assert.equal(approvals[0].task_id, 'TASK-001');
    assert.equal(approvals[1].task_id, 'TASK-002');
  });
});
