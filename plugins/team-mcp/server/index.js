import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SubscribeRequestSchema, UnsubscribeRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { resolveAgentDir, LockManager } from './lib/state.js';
import { eventEmitter } from './lib/events.js';
import { registerTaskTools } from './lib/tools/task.js';
import { registerPipelineTools } from './lib/tools/pipeline.js';
import { registerConfigTools } from './lib/tools/config.js';
import { registerMetricsTools } from './lib/tools/metrics.js';
import { registerKnowledgeTools } from './lib/tools/knowledge.js';
import { registerFileTools } from './lib/tools/files.js';
import { registerAgentTools } from './lib/tools/agent.js';
import { registerAdventureTools } from './lib/tools/adventure.js';
import { ChannelManager } from './lib/channels/manager.js';
import { registerChannelTools } from './lib/tools/channels.js';
import { registerHookTools } from './lib/tools/hooks.js';
import { registerAgentMemoryTools } from './lib/tools/agent-memory.js';
import { registerDiagnosticsTools } from './lib/tools/diagnostics.js';
import { registerSkillTools } from './lib/tools/skills.js';

// Verify .agent/ directory is accessible before starting the server.
// Exit cleanly (not as an error) if not found -- the server has nothing to serve.
const { agentDir } = resolveAgentDir();
if (!agentDir) {
  console.error(
    'team-pipeline MCP server: .agent/ directory not found.\n' +
    'Run the server from a directory that contains a .agent/ folder (or any parent of one).\n' +
    'Initialize one with: /task-init'
  );
  process.exit(0);
}

const server = new McpServer({
  name: 'team-pipeline',
  version: '0.1.0',
});

// Shared in-memory lock manager. Tool modules that need locking can import
// this singleton: import { lockManager } from '../index.js';
export const lockManager = new LockManager();

// Wire the MCP server reference into the event emitter so it can send
// notifications. Export the singleton so tool modules can import it.
eventEmitter.setServer(server);
export { eventEmitter };

// Initialize channel manager (will be started in main())
const channelManager = new ChannelManager(eventEmitter);

// Register all tool modules.
registerTaskTools(server);
registerPipelineTools(server);
registerConfigTools(server);
registerMetricsTools(server);
registerKnowledgeTools(server);
registerFileTools(server);
registerAgentTools(server);
registerAdventureTools(server);
registerChannelTools(server, channelManager);
registerHookTools(server);
registerAgentMemoryTools(server);
registerDiagnosticsTools(server);
registerSkillTools(server);

// pipeline://events resource -- returns last 50 events from the ring buffer.
server.resource(
  'pipeline-events',
  'pipeline://events',
  { description: 'Recent pipeline events (last 50), chronological order' },
  async () => {
    const events = eventEmitter.getEvents(50);
    return {
      contents: [
        {
          uri: 'pipeline://events',
          mimeType: 'application/json',
          text: JSON.stringify(events, null, 2),
        },
      ],
    };
  }
);

// Declare resource subscription capability (must be called after server.resource() which
// internally registers resources: { listChanged: true }; the SDK deep-merges capabilities).
server.server.registerCapabilities({ resources: { subscribe: true } });

// Register subscribe/unsubscribe handlers on the low-level Server.
// McpServer does not auto-register these, so we use the underlying Server directly.
server.server.setRequestHandler(SubscribeRequestSchema, async (request) => {
  eventEmitter.subscribe(request.params.uri);
  return {};
});

server.server.setRequestHandler(UnsubscribeRequestSchema, async (request) => {
  eventEmitter.unsubscribe(request.params.uri);
  return {};
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Initialize and start channel manager
  try {
    await channelManager.initialize();
    channelManager.startForwarding();
  } catch (error) {
    console.error('[channels] Initialization failed:', error.message);
    // Continue running server even if channels fail to initialize
  }

  // Handle shutdown
  process.on('SIGINT', async () => {
    console.error('Shutting down...');
    await channelManager.shutdown();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.error('Shutting down...');
    await channelManager.shutdown();
    process.exit(0);
  });

  console.error('team-pipeline MCP server started');
}

main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
