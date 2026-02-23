/**
 * Channel manager: loads channel configuration, routes events to enabled channels.
 *
 * Subscribes to the EventEmitter singleton and forwards events to configured
 * messaging channels (Telegram, Discord). Handles filtering, formatting, and
 * error recovery.
 */

import { join } from 'path';
import { existsSync } from 'fs';
import { readState, resolveAgentDir } from '../state.js';
import { formatForTelegram, formatForDiscord } from './formatter.js';
import { TelegramChannel } from './telegram.js';
import { DiscordChannel } from './discord.js';

export class ChannelManager {
  /**
   * @param {import('../events.js').EventEmitter} eventEmitter - EventEmitter singleton
   */
  constructor(eventEmitter) {
    this.eventEmitter = eventEmitter;
    this.channels = [];
    this.config = null;
    this.initialized = false;
    this.forwarding = false;

    // Store original emit for wrapping
    this._originalEmit = null;
  }

  /**
   * Load channel configuration from .agent/messenger.md and instantiate adapters.
   *
   * @returns {Promise<void>}
   */
  async initialize() {
    const { agentDir } = resolveAgentDir();
    if (!agentDir) {
      throw new Error('Channel manager requires .agent/ directory');
    }

    const messengerPath = join(agentDir, 'messenger.md');
    if (!existsSync(messengerPath)) {
      console.error('[channels] No messenger.md found, channels disabled');
      this.initialized = true;
      return;
    }

    try {
      const { frontmatter } = await readState(messengerPath);
      this.config = frontmatter;

      // Instantiate enabled channels
      if (frontmatter.channels?.telegram?.enabled) {
        const telegram = new TelegramChannel(frontmatter.channels.telegram);
        this.channels.push(telegram);
        console.error('[channels] Telegram enabled');
      }

      if (frontmatter.channels?.discord?.enabled) {
        const discord = new DiscordChannel(frontmatter.channels.discord);
        this.channels.push(discord);
        console.error('[channels] Discord enabled');
      }

      this.initialized = true;
      console.error(`[channels] Initialized ${this.channels.length} channel(s)`);
    } catch (error) {
      console.error(`[channels] Initialization error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Start forwarding events to channels.
   * Wraps the eventEmitter.emit() method to intercept events.
   *
   * @returns {void}
   */
  startForwarding() {
    if (this.forwarding || !this.initialized) {
      return;
    }

    this.forwarding = true;

    // Wrap the emit method to intercept events
    this._originalEmit = this.eventEmitter.emit.bind(this.eventEmitter);
    this.eventEmitter.emit = async (type, taskId, data = {}) => {
      // Call the original emit first
      const event = await this._originalEmit(type, taskId, data);

      // Forward to channels (fire-and-forget)
      this._forwardEvent(event).catch(err => {
        console.error(`[channels] Forward error: ${err.message}`);
      });

      return event;
    };

    // Start listening on bidirectional channels
    for (const channel of this.channels) {
      channel.startListening().catch(err => {
        console.error(`[channels] ${channel.name} startListening error: ${err.message}`);
      });
    }

    console.error('[channels] Event forwarding started');
  }

  /**
   * Stop forwarding and shut down all channels.
   *
   * @returns {Promise<void>}
   */
  async shutdown() {
    if (!this.forwarding) {
      return;
    }

    // Restore original emit
    if (this._originalEmit) {
      this.eventEmitter.emit = this._originalEmit;
      this._originalEmit = null;
    }

    // Stop all channels
    for (const channel of this.channels) {
      try {
        await channel.stopListening();
      } catch (error) {
        console.error(`[channels] ${channel.name} stopListening error: ${error.message}`);
      }
    }

    this.forwarding = false;
    console.error('[channels] Shutdown complete');
  }

  /**
   * Forward a single event to all enabled channels (respecting filters).
   *
   * @param {object} event - Event envelope
   * @returns {Promise<void>}
   */
  async _forwardEvent(event) {
    for (const channel of this.channels) {
      if (!channel.enabled) {
        continue;
      }

      // Check event filtering
      const channelConfig = this.config?.channels?.[channel.name];
      if (!channelConfig) {
        continue;
      }

      const eventFilter = channelConfig.events || ['all'];
      if (!eventFilter.includes('all') && !eventFilter.includes(event.type)) {
        continue;
      }

      // Format message for this channel
      let formattedMessage;
      try {
        if (channel.name === 'telegram') {
          formattedMessage = formatForTelegram(event);
        } else if (channel.name === 'discord') {
          formattedMessage = formatForDiscord(event);
        } else {
          console.error(`[channels] Unknown channel formatter: ${channel.name}`);
          continue;
        }
      } catch (error) {
        console.error(`[channels] ${channel.name} formatting error: ${error.message}`);
        continue;
      }

      // Send to channel (fire-and-forget)
      channel.send(event, formattedMessage).catch(err => {
        console.error(`[channels] ${channel.name} send error: ${err.message}`);
      });
    }
  }

  /**
   * Get status of all channels.
   *
   * @param {boolean} refresh - If true, run health checks before returning status
   * @returns {Promise<Array<object>>}
   */
  async getStatus(refresh = false) {
    const statuses = [];

    for (const channel of this.channels) {
      const status = {
        name: channel.name,
        enabled: channel.enabled,
        lastSendTime: channel.lastSendTime,
        lastError: channel.lastError,
        pendingApprovals: channel.getPendingApprovals().length,
      };

      if (refresh) {
        try {
          const health = await channel.healthCheck();
          status.healthy = health.healthy;
          status.healthMessage = health.message;
        } catch (error) {
          status.healthy = false;
          status.healthMessage = error.message;
        }
      }

      statuses.push(status);
    }

    return statuses;
  }

  /**
   * Get all pending approvals across all channels.
   *
   * @returns {Array<{channel: string, task_id: string, action: string, reason?: string}>}
   */
  getPendingApprovals() {
    const approvals = [];

    for (const channel of this.channels) {
      const channelApprovals = channel.getPendingApprovals();
      for (const approval of channelApprovals) {
        approvals.push({
          channel: channel.name,
          ...approval,
        });
      }
    }

    return approvals;
  }
}
