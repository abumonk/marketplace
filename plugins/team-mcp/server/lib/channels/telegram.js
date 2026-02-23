/**
 * Telegram channel adapter.
 *
 * Outbound: send formatted messages via Bot API sendMessage
 * Inbound: poll getUpdates for commands (/approve, /reject, /status)
 */

import { BaseChannel } from './base.js';

export class TelegramChannel extends BaseChannel {
  constructor(config) {
    super('telegram', config);

    // Read secrets from environment variables
    this.botToken = process.env[config.bot_token_env];
    this.chatId = process.env[config.chat_id_env];

    // Polling state
    this.polling = false;
    this.pollAbortController = null;
    this.updateOffset = 0;

    // Pending approvals queue
    this.pendingApprovals = [];
  }

  /**
   * Send a formatted message to Telegram.
   *
   * @param {object} event - Event envelope
   * @param {string} formattedMessage - HTML string
   * @returns {Promise<void>}
   */
  async send(event, formattedMessage) {
    if (!this.botToken || !this.chatId) {
      throw new Error('Telegram credentials not configured (check bot_token_env and chat_id_env)');
    }

    const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
    const payload = {
      chat_id: this.chatId,
      text: formattedMessage,
      parse_mode: 'HTML',
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        // Retry once after 2s delay
        await new Promise(resolve => setTimeout(resolve, 2000));
        const retryResponse = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!retryResponse.ok) {
          const errorText = await retryResponse.text();
          throw new Error(`Telegram API error (retry failed): ${retryResponse.status} ${errorText}`);
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
   * Start polling for inbound commands via getUpdates.
   *
   * @returns {Promise<void>}
   */
  async startListening() {
    if (this.polling || !this.config.bidirectional) {
      return;
    }

    if (!this.botToken) {
      console.error('[telegram] Cannot start polling: bot_token not configured');
      return;
    }

    this.polling = true;
    this.pollAbortController = new AbortController();

    console.error('[telegram] Started polling for commands');

    // Start the polling loop (do not await -- runs in background)
    this._pollLoop().catch(err => {
      console.error('[telegram] Polling loop error:', err.message);
      this.polling = false;
    });
  }

  /**
   * Stop polling for inbound commands.
   *
   * @returns {Promise<void>}
   */
  async stopListening() {
    if (!this.polling) {
      return;
    }

    this.polling = false;
    if (this.pollAbortController) {
      this.pollAbortController.abort();
      this.pollAbortController = null;
    }

    console.error('[telegram] Stopped polling');
  }

  /**
   * Polling loop (runs until stopListening is called).
   * Calls getUpdates with long polling (timeout=30).
   */
  async _pollLoop() {
    const url = `https://api.telegram.org/bot${this.botToken}/getUpdates`;

    while (this.polling) {
      try {
        const response = await fetch(`${url}?offset=${this.updateOffset}&timeout=30`, {
          signal: this.pollAbortController?.signal,
        });

        if (!response.ok) {
          console.error(`[telegram] getUpdates error: ${response.status}`);
          await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5s before retry
          continue;
        }

        const data = await response.json();
        if (data.ok && Array.isArray(data.result)) {
          for (const update of data.result) {
            this._handleUpdate(update);
            this.updateOffset = update.update_id + 1;
          }
        }
      } catch (error) {
        if (error.name === 'AbortError') {
          // Polling was stopped
          break;
        }
        console.error('[telegram] Polling error:', error.message);
        await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5s before retry
      }
    }
  }

  /**
   * Handle a single update (parse commands).
   *
   * @param {object} update - Telegram update object
   */
  _handleUpdate(update) {
    const message = update.message;
    if (!message || !message.text) {
      return;
    }

    const text = message.text.trim();

    // Parse /approve TASK-NNN
    const approveMatch = text.match(/^\/approve\s+(TASK-\d+)/i);
    if (approveMatch) {
      this.pendingApprovals.push({
        task_id: approveMatch[1],
        action: 'approve',
      });
      console.error(`[telegram] Received approval for ${approveMatch[1]}`);
      return;
    }

    // Parse /reject TASK-NNN [reason]
    const rejectMatch = text.match(/^\/reject\s+(TASK-\d+)(?:\s+(.+))?/i);
    if (rejectMatch) {
      this.pendingApprovals.push({
        task_id: rejectMatch[1],
        action: 'reject',
        reason: rejectMatch[2] || 'No reason provided',
      });
      console.error(`[telegram] Received rejection for ${rejectMatch[1]}`);
      return;
    }

    // Parse /status (no action, just log)
    if (text.match(/^\/status/i)) {
      console.error('[telegram] Received /status command (not implemented)');
    }
  }

  /**
   * Check if the channel is healthy (credentials present, API reachable).
   *
   * @returns {Promise<{healthy: boolean, message?: string}>}
   */
  async healthCheck() {
    if (!this.botToken) {
      return { healthy: false, message: 'bot_token not configured' };
    }

    if (!this.chatId) {
      return { healthy: false, message: 'chat_id not configured' };
    }

    try {
      const url = `https://api.telegram.org/bot${this.botToken}/getMe`;
      const response = await fetch(url);

      if (!response.ok) {
        return { healthy: false, message: `API error: ${response.status}` };
      }

      const data = await response.json();
      if (!data.ok) {
        return { healthy: false, message: 'Bot API returned not ok' };
      }

      return { healthy: true, message: `Bot: ${data.result.username}` };
    } catch (error) {
      return { healthy: false, message: error.message };
    }
  }

  /**
   * Get pending approvals received from Telegram.
   *
   * @returns {Array<{task_id: string, action: 'approve'|'reject', reason?: string}>}
   */
  getPendingApprovals() {
    return this.pendingApprovals;
  }
}
