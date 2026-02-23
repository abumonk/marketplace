/**
 * Base class for messaging channel adapters.
 *
 * Each channel adapter extends BaseChannel and implements:
 * - send(event, formattedMessage) -- send formatted message to the channel
 * - healthCheck() -- verify credentials and connectivity
 * - startListening() -- [optional] start inbound message polling
 * - stopListening() -- [optional] stop inbound message polling
 * - getPendingApprovals() -- [optional] return pending approval commands
 */

export class BaseChannel {
  /**
   * @param {string} name - Channel name (e.g., 'telegram', 'discord')
   * @param {object} config - Channel configuration from messenger.md
   */
  constructor(name, config) {
    this.name = name;
    this.config = config;
    this.enabled = config.enabled !== false;
    this.lastSendTime = null;
    this.lastError = null;
  }

  /**
   * Send a formatted message for a pipeline event.
   *
   * @param {object} event - Event envelope (type, timestamp, task_id, data)
   * @param {string|object} formattedMessage - Channel-specific formatted message
   * @returns {Promise<void>}
   * @throws {Error} Not implemented (must override in subclass)
   */
  async send(event, formattedMessage) {
    throw new Error(`${this.name}.send() not implemented`);
  }

  /**
   * Start listening for inbound commands (approvals, queries).
   * No-op by default (override in bidirectional channels).
   *
   * @returns {Promise<void>}
   */
  async startListening() {
    // No-op by default
  }

  /**
   * Stop listening for inbound commands.
   * No-op by default (override in bidirectional channels).
   *
   * @returns {Promise<void>}
   */
  async stopListening() {
    // No-op by default
  }

  /**
   * Check if this channel is healthy (credentials present, endpoint reachable).
   *
   * @returns {Promise<{healthy: boolean, message?: string}>}
   * @throws {Error} Not implemented (must override in subclass)
   */
  async healthCheck() {
    throw new Error(`${this.name}.healthCheck() not implemented`);
  }

  /**
   * Get pending approvals received from this channel.
   * Returns empty array by default (override in bidirectional channels).
   *
   * @returns {Array<{task_id: string, action: 'approve'|'reject', reason?: string}>}
   */
  getPendingApprovals() {
    return [];
  }
}
