/**
 * MCP tools for messaging channel management.
 *
 * Tools:
 * - pipeline.channel_status -- Get status of all configured channels
 * - pipeline.channel_send -- Manually send a message to a specific channel
 * - pipeline.channel_approvals -- List pending approvals from bidirectional channels
 */

import { formatForTelegram, formatForDiscord } from '../channels/formatter.js';

/**
 * Register channel management tools.
 *
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {import('../channels/manager.js').ChannelManager} channelManager
 */
export function registerChannelTools(server, channelManager) {
  /**
   * Get status of all configured channels.
   */
  server.tool(
    'pipeline.channel_status',
    'Get status of all configured messaging channels (Telegram, Discord)',
    {
      type: 'object',
      properties: {
        refresh: {
          type: 'boolean',
          description: 'Run health checks before returning status (default: false)',
        },
      },
    },
    async ({ refresh = false }) => {
      try {
        const statuses = await channelManager.getStatus(refresh);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                channels: statuses,
                forwarding: channelManager.forwarding,
              }, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: 'INTERNAL_ERROR',
                message: error.message,
              }),
            },
          ],
          isError: true,
        };
      }
    }
  );

  /**
   * Manually send a message to a specific channel (for testing or ad-hoc notifications).
   */
  server.tool(
    'pipeline.channel_send',
    'Manually send a message to a specific channel (Telegram or Discord)',
    {
      type: 'object',
      properties: {
        channel: {
          type: 'string',
          description: 'Channel name (telegram or discord)',
        },
        message: {
          type: 'string',
          description: 'Plain text message to send',
        },
      },
      required: ['channel', 'message'],
    },
    async ({ channel, message }) => {
      try {
        const targetChannel = channelManager.channels.find(c => c.name === channel);
        if (!targetChannel) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: 'NOT_FOUND',
                  message: `Channel '${channel}' not found or not enabled`,
                }),
              },
            ],
            isError: true,
          };
        }

        if (!targetChannel.enabled) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: 'VALIDATION_ERROR',
                  message: `Channel '${channel}' is disabled`,
                }),
              },
            ],
            isError: true,
          };
        }

        // Format the message based on channel type
        let formattedMessage;
        if (channel === 'telegram') {
          formattedMessage = `<b>Manual Message</b>\n\n${message}\n\n<i>team-pipeline | ${new Date().toISOString().slice(0, 16).replace('T', ' ')}</i>`;
        } else if (channel === 'discord') {
          formattedMessage = {
            title: 'Manual Message',
            description: message,
            color: 0x3498db, // blue
            timestamp: new Date().toISOString(),
            footer: { text: 'team-pipeline' },
          };
        } else {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: 'VALIDATION_ERROR',
                  message: `Unknown channel type: ${channel}`,
                }),
              },
            ],
            isError: true,
          };
        }

        // Create a mock event envelope
        const mockEvent = {
          type: 'manual.message',
          timestamp: new Date().toISOString(),
          data: { message },
        };

        await targetChannel.send(mockEvent, formattedMessage);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                channel,
                sent_at: new Date().toISOString(),
              }),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: 'INTERNAL_ERROR',
                message: error.message,
              }),
            },
          ],
          isError: true,
        };
      }
    }
  );

  /**
   * Get pending approvals from bidirectional channels.
   */
  server.tool(
    'pipeline.channel_approvals',
    'List pending approvals received from bidirectional channels (Telegram)',
    {},
    async () => {
      try {
        const approvals = channelManager.getPendingApprovals();

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                count: approvals.length,
                approvals,
              }, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: 'INTERNAL_ERROR',
                message: error.message,
              }),
            },
          ],
          isError: true,
        };
      }
    }
  );
}
