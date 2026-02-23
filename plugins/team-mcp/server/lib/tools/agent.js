/**
 * Agent spawn and list MCP tools.
 *
 * Agents are tracked in .agent/lead-state.md under an `agents` key in the
 * YAML frontmatter.  The spawn tool appends a new entry; the list tool reads
 * and optionally filters the array.
 */

import { join } from 'path';
import { existsSync } from 'fs';
import {
  resolveAgentDir,
  readState,
  writeState,
  timestamp,
} from '../state.js';
import { lockManager } from '../../index.js';
import {
  VALIDATION_ERROR,
  NOT_FOUND,
  LOCK_CONFLICT,
  INTERNAL_ERROR,
} from '../errors.js';
import { eventEmitter } from '../events.js';

const ALLOWED_ROLES = ['planner', 'implementer', 'reviewer', 'researcher'];

/**
 * Register agent management tools.
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 */
export function registerAgentTools(server) {
  // pipeline.agent_spawn
  server.tool(
    'pipeline.agent_spawn',
    'Record a new agent entry in lead-state.md with id, role, task_id, model, status, and started_at',
    {
      role: {
        type: 'string',
        description: 'Agent role: planner, implementer, reviewer, or researcher',
      },
      task_id: {
        type: 'string',
        description: 'Task ID the agent is working on (optional)',
      },
      model: {
        type: 'string',
        description: 'Model identifier for the agent (optional)',
      },
      description: {
        type: 'string',
        description: 'Short description of what this agent is doing (optional)',
      },
    },
    async ({ role, task_id, model, description }) => {
      // Validate role
      if (!ALLOWED_ROLES.includes(role)) {
        return VALIDATION_ERROR(
          `Invalid role '${role}'. Must be one of: ${ALLOWED_ROLES.join(', ')}`
        );
      }

      const { agentDir } = resolveAgentDir();
      if (!agentDir) {
        return NOT_FOUND('Could not find .agent/ directory');
      }

      const leadStatePath = join(agentDir, 'lead-state.md');
      if (!existsSync(leadStatePath)) {
        return NOT_FOUND('lead-state.md not found in .agent/ directory');
      }

      // Generate unique agent ID and session ID for this call
      const agentId = `agent-${Date.now()}`;
      const sessionId = `spawn-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      // Acquire lock on lead-state before writing
      const lockResult = lockManager.acquire('lead-state', sessionId);
      if (!lockResult.acquired) {
        return LOCK_CONFLICT(
          `lead-state is locked by session '${lockResult.holder}'. ` +
          `Retry in ${Math.ceil(lockResult.expiresIn / 1000)}s.`
        );
      }

      try {
        const { frontmatter, body } = await readState(leadStatePath);

        // Ensure agents array exists
        if (!Array.isArray(frontmatter.agents)) {
          frontmatter.agents = [];
        }

        const now = timestamp();
        const agentEntry = {
          id: agentId,
          role,
          task_id: task_id || null,
          model: model || null,
          status: 'running',
          started_at: now,
          description: description || null,
        };

        frontmatter.agents.push(agentEntry);

        await writeState(leadStatePath, frontmatter, body);

        await eventEmitter.emit('agent.spawned', task_id || null, { agent_id: agentId, role, model: model || null });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                id: agentId,
                role,
                task_id: task_id || null,
                status: 'running',
              }),
            },
          ],
        };
      } catch (error) {
        return INTERNAL_ERROR(`Failed to spawn agent: ${error.message}`);
      } finally {
        lockManager.release('lead-state', sessionId);
      }
    }
  );

  // pipeline.agent_list
  server.tool(
    'pipeline.agent_list',
    'List agents tracked in lead-state.md with optional filters by status, role, or task_id',
    {
      status: {
        type: 'string',
        description: 'Filter by agent status (optional)',
      },
      role: {
        type: 'string',
        description: 'Filter by agent role (optional)',
      },
      task_id: {
        type: 'string',
        description: 'Filter by task ID (optional)',
      },
    },
    async ({ status, role, task_id }) => {
      try {
        const { agentDir } = resolveAgentDir();
        if (!agentDir) {
          return NOT_FOUND('Could not find .agent/ directory');
        }

        const leadStatePath = join(agentDir, 'lead-state.md');
        if (!existsSync(leadStatePath)) {
          return NOT_FOUND('lead-state.md not found in .agent/ directory');
        }

        const { frontmatter } = await readState(leadStatePath);

        let agents = Array.isArray(frontmatter.agents) ? frontmatter.agents : [];

        // Apply filters
        if (status) {
          agents = agents.filter((a) => a.status === status);
        }
        if (role) {
          agents = agents.filter((a) => a.role === role);
        }
        if (task_id) {
          agents = agents.filter((a) => a.task_id === task_id);
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(agents),
            },
          ],
        };
      } catch (error) {
        return INTERNAL_ERROR(`Failed to list agents: ${error.message}`);
      }
    }
  );

  // pipeline.agent_complete
  server.tool(
    'pipeline.agent_complete',
    'Update an agent entry in lead-state.md to completed or failed, recording completed_at and an optional result summary',
    {
      id: {
        type: 'string',
        description: 'Agent ID to complete',
      },
      status: {
        type: 'string',
        description: 'Final status: "completed" or "failed"',
        enum: ['completed', 'failed'],
      },
      result: {
        type: 'string',
        description: 'Optional summary of what the agent did or why it failed',
      },
    },
    async ({ id, status, result }) => {
      // Validate status
      if (status !== 'completed' && status !== 'failed') {
        return VALIDATION_ERROR(`Invalid status '${status}'. Must be 'completed' or 'failed'.`);
      }

      const { agentDir } = resolveAgentDir();
      if (!agentDir) {
        return NOT_FOUND('Could not find .agent/ directory');
      }

      const leadStatePath = join(agentDir, 'lead-state.md');
      if (!existsSync(leadStatePath)) {
        return NOT_FOUND('lead-state.md not found in .agent/ directory');
      }

      const sessionId = `complete-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      const lockResult = lockManager.acquire('lead-state', sessionId);
      if (!lockResult.acquired) {
        return LOCK_CONFLICT(
          `lead-state is locked by session '${lockResult.holder}'. ` +
          `Retry in ${Math.ceil(lockResult.expiresIn / 1000)}s.`
        );
      }

      let agent;
      let completedAt;
      try {
        const { frontmatter, body } = await readState(leadStatePath);

        const agents = Array.isArray(frontmatter.agents) ? frontmatter.agents : [];
        const agentIndex = agents.findIndex((a) => a.id === id);

        if (agentIndex === -1) {
          return NOT_FOUND(`Agent '${id}' not found in lead-state.md`);
        }

        agent = agents[agentIndex];

        if (agent.status !== 'running') {
          return VALIDATION_ERROR(
            `Agent '${id}' is already completed/stale (current status: '${agent.status}')`
          );
        }

        completedAt = timestamp();
        agent.status = status;
        agent.completed_at = completedAt;
        agent.result = result || null;

        agents[agentIndex] = agent;
        frontmatter.agents = agents;

        await writeState(leadStatePath, frontmatter, body);
      } catch (error) {
        return INTERNAL_ERROR(`Failed to complete agent: ${error.message}`);
      } finally {
        lockManager.release('lead-state', sessionId);
      }

      // Emit event after lock is released
      if (status === 'completed') {
        await eventEmitter.emit('agent.completed', agent.task_id || null, {
          agent_id: id,
          role: agent.role,
          result: result || null,
        });
      } else {
        await eventEmitter.emit('agent.failed', agent.task_id || null, {
          agent_id: id,
          role: agent.role,
          result: result || null,
        });
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ id, status, completed_at: completedAt }),
          },
        ],
      };
    }
  );
}
