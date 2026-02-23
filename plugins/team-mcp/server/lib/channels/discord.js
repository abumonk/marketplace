/**
 * Discord channel adapter.
 *
 * Outbound: send formatted embeds via webhook POST
 * Inbound: not implemented in v1 (requires Discord bot gateway)
 */

import { BaseChannel } from './base.js';

export class DiscordChannel extends BaseChannel {
  constructor(config) {
    super('discord', config);

    // Read webhook URL from environment variable
    this.webhookUrl = process.env[config.webhook_url_env];
  }

  /**
   * Send a formatted message to Discord via webhook.
   *
   * @param {object} event - Event envelope
   * @param {object} formattedMessage - Discord embed object
   * @returns {Promise<void>}
   */
  async send(event, formattedMessage) {
    if (!this.webhookUrl) {
      throw new Error('Discord webhook URL not configured (check webhook_url_env)');
    }

    const payload = {
      embeds: [formattedMessage],
    };

    try {
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        // Retry once after 2s delay
        await new Promise(resolve => setTimeout(resolve, 2000));
        const retryResponse = await fetch(this.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!retryResponse.ok) {
          const errorText = await retryResponse.text();
          throw new Error(`Discord webhook error (retry failed): ${retryResponse.status} ${errorText}`);
        }
      }

      this.lastSendTime = new Date().toISOString();
      this.lastError = null;
    } catch (error) {
      this.lastError = error.message;
      throw error;
    }
  }

  /**
   * Check if the channel is healthy (webhook URL configured and reachable).
   *
   * @returns {Promise<{healthy: boolean, message?: string}>}
   */
  async healthCheck() {
    if (!this.webhookUrl) {
      return { healthy: false, message: 'webhook_url not configured' };
    }

    try {
      // GET request to webhook URL returns webhook info (if valid)
      const response = await fetch(this.webhookUrl);

      if (!response.ok) {
        return { healthy: false, message: `Webhook error: ${response.status}` };
      }

      const data = await response.json();
      return { healthy: true, message: `Webhook: ${data.name || 'N/A'}` };
    } catch (error) {
      return { healthy: false, message: error.message };
    }
  }

  /**
   * Start listening for inbound commands.
   * Not implemented in v1 (Discord webhooks are outbound-only).
   *
   * @returns {Promise<void>}
   */
  async startListening() {
    // No-op: Discord bidirectional requires bot gateway, deferred to v2
  }

  /**
   * Stop listening for inbound commands.
   * Not implemented in v1.
   *
   * @returns {Promise<void>}
   */
  async stopListening() {
    // No-op
  }
}
