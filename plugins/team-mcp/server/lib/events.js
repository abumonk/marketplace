/**
 * Event emitter with in-memory ring buffer for MCP pipeline events.
 *
 * Emitting an event:
 *   1. Constructs a structured event envelope (type, timestamp, task_id, data)
 *   2. Adds it to a ring buffer (last 50 events)
 *   3. Writes last_event to lead-state.md frontmatter (for messenger hook consumption)
 *   4. Sends an MCP notification to connected clients (if server reference is set)
 *
 * Event types:
 *   task.created    -- new task was created via pipeline.task_create
 *   task.advanced   -- task moved to a new stage via pipeline.task_advance
 *   task.completed  -- task reached the 'completed' stage
 *   task.blocked    -- task was blocked (max_iterations exceeded)
 *   task.failed     -- task status set to 'failed' via pipeline.task_update
 *   task.cancelled  -- task status set to 'cancelled' via pipeline.task_update
 */

import { join } from 'path';
import { existsSync } from 'fs';
import { resolveAgentDir, readState, writeState } from './state.js';

/** MCP notification method for pipeline events */
const NOTIFICATION_METHOD = 'notifications/pipeline/event';

/** Maximum number of events retained in the ring buffer */
const RING_BUFFER_SIZE = 50;

/**
 * EventEmitter manages pipeline event dispatch and the in-memory ring buffer.
 *
 * Use the exported singleton `eventEmitter` rather than constructing your own.
 */
export class EventEmitter {
  constructor() {
    /** @type {Array<{type: string, timestamp: string, task_id?: string, data: object}>} */
    this._buffer = [];

    /** @type {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer|null} */
    this._server = null;

    /** @type {Set<string>} URIs of currently subscribed resources */
    this._subscriptions = new Set();
  }

  /**
   * Store the MCP server reference so emit() can send notifications.
   * Call this after the McpServer instance is created in index.js.
   *
   * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
   */
  setServer(server) {
    this._server = server;
  }

  /**
   * Subscribe to a resource URI (e.g. 'pipeline://events').
   * Idempotent -- subscribing the same URI twice has no additional effect.
   *
   * @param {string} uri - Resource URI to subscribe to
   */
  subscribe(uri) {
    this._subscriptions.add(uri);
  }

  /**
   * Unsubscribe from a resource URI.
   * No-op if the URI is not currently subscribed.
   *
   * @param {string} uri - Resource URI to unsubscribe from
   */
  unsubscribe(uri) {
    this._subscriptions.delete(uri);
  }

  /**
   * Return the current set of subscribed URIs (for testing / inspection).
   *
   * @returns {Set<string>}
   */
  getSubscriptions() {
    return this._subscriptions;
  }

  /**
   * Emit a pipeline event.
   *
   * @param {string} type        - Event type (e.g. 'task.created')
   * @param {string|null} taskId - Task ID this event relates to, or null
   * @param {object} data        - Event-specific payload fields
   */
  async emit(type, taskId, data = {}) {
    // 1. Construct event envelope
    const event = {
      type,
      timestamp: new Date().toISOString(),
      ...(taskId ? { task_id: taskId } : {}),
      data,
    };

    // 2. Add to ring buffer (evict oldest if at capacity)
    this._buffer.push(event);
    if (this._buffer.length > RING_BUFFER_SIZE) {
      this._buffer.shift();
    }

    // 3. Write last_event to lead-state.md (fire-and-forget, non-fatal)
    try {
      const { agentDir } = resolveAgentDir();
      if (agentDir) {
        const leadStatePath = join(agentDir, 'lead-state.md');
        if (existsSync(leadStatePath)) {
          const { frontmatter, body } = await readState(leadStatePath);
          frontmatter.last_event = event;
          await writeState(leadStatePath, frontmatter, body);
        }
      }
    } catch (err) {
      // Non-fatal: log to stderr but do not interrupt the caller
      console.error(`[events] Failed to write last_event to lead-state.md: ${err.message}`);
    }

    // 4. Send MCP notification (fire-and-forget, non-fatal).
    // McpServer wraps an underlying Server accessible via `.server`.
    if (this._server) {
      try {
        await this._server.server.notification({
          method: NOTIFICATION_METHOD,
          params: { event },
        });
      } catch (err) {
        // Non-fatal: client may not be connected or may not support notifications
        console.error(`[events] Failed to send MCP notification: ${err.message}`);
      }

      // 5. Send standard resource-updated notification for subscribed URIs.
      // This tells subscribers to re-read the pipeline://events resource.
      if (this._subscriptions.has('pipeline://events')) {
        try {
          await this._server.server.sendResourceUpdated({ uri: 'pipeline://events' });
        } catch (err) {
          // Non-fatal: client may have disconnected
          console.error(`[events] Failed to send resource updated notification: ${err.message}`);
        }
      }
    }

    return event;
  }

  /**
   * Return recent events from the ring buffer in chronological order (oldest first).
   *
   * @param {number} [limit=50] - Maximum number of events to return
   * @returns {Array<object>}
   */
  getEvents(limit = RING_BUFFER_SIZE) {
    const count = Math.min(limit, this._buffer.length);
    return this._buffer.slice(this._buffer.length - count);
  }
}

/**
 * Singleton event emitter instance.
 * Import this in tool modules: import { eventEmitter } from '../events.js';
 */
export const eventEmitter = new EventEmitter();
