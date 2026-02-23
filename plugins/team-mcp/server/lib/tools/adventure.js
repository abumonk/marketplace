/**
 * Adventure management MCP tools.
 */

import { join } from 'path';
import { readdir } from 'fs/promises';
import { existsSync } from 'fs';
import {
  resolveAgentDir,
  readState,
  writeState,
  ensureDir,
  timestamp,
  logEntry,
  deepMerge,
} from '../state.js';
import { validateAdventureTransition } from '../schema.js';
import { eventEmitter } from '../events.js';

/**
 * Parse TC status counts from the Target Conditions table in a manifest body.
 * Looks for rows in a markdown table where the last column is Status.
 *
 * @param {string} body
 * @returns {{ total: number, passed: number, pending: number, failed: number }}
 */
function parseTcSummary(body) {
  const summary = { total: 0, passed: 0, pending: 0, failed: 0 };

  // Match lines that look like table rows with TC-NNN identifiers
  const rowPattern = /^\|[^|]*TC-\d+[^|]*\|.*\|\s*(\w+)\s*\|?\s*$/gm;
  let match;
  while ((match = rowPattern.exec(body)) !== null) {
    const status = match[1].toLowerCase().trim();
    summary.total++;
    if (status === 'passed') {
      summary.passed++;
    } else if (status === 'failed') {
      summary.failed++;
    } else {
      summary.pending++;
    }
  }

  return summary;
}

/**
 * Register all adventure management tools.
 */
export function registerAdventureTools(server) {
  // pipeline.adventure_create
  server.tool(
    'pipeline.adventure_create',
    'Create a new adventure with a manifest file',
    {
      title: { type: 'string', description: 'Adventure title' },
      concept: { type: 'string', description: 'High-level concept description (optional)' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Adventure tags (optional)' },
    },
    async ({ title, concept, tags }) => {
      try {
        const { agentDir } = resolveAgentDir();
        if (!agentDir) {
          throw new Error('Could not find .agent/ directory');
        }

        const adventuresDir = join(agentDir, 'adventures');
        await ensureDir(adventuresDir);

        // Find highest ADV-NNN number
        let existingDirs = [];
        if (existsSync(adventuresDir)) {
          existingDirs = await readdir(adventuresDir);
        }
        const advNumbers = existingDirs
          .filter((d) => /^ADV-\d{3}$/.test(d))
          .map((d) => parseInt(d.match(/\d{3}/)[0], 10));
        const nextNumber = advNumbers.length > 0 ? Math.max(...advNumbers) + 1 : 1;
        const advId = `ADV-${String(nextNumber).padStart(3, '0')}`;

        // Create adventure directory
        const advDir = join(adventuresDir, advId);
        await ensureDir(advDir);

        const manifestPath = join(advDir, 'manifest.md');
        const now = timestamp();

        // Build frontmatter
        const frontmatter = {
          id: advId,
          title,
          state: 'planning',
          created: now,
          updated: now,
          tasks: [],
        };

        if (tags && tags.length > 0) {
          frontmatter.tags = tags;
        }

        // Build body
        const conceptText = concept || '';
        const body = `
## Concept
${conceptText}

## Target Conditions
| ID | Description | Source | Design | Plan | Task(s) | Proof Method | Proof Command | Status |
|----|-------------|--------|--------|------|---------|-------------|---------------|--------|

## Evaluations
| Task | Access Requirements | Skill Set | Est. Duration | Est. Tokens | Est. Cost | Actual Duration | Actual Tokens | Actual Cost | Variance |
|------|-------------------|-----------|---------------|-------------|-----------|-----------------|---------------|-------------|----------|

## Metrics Summary
- **State**: Planning
- **Tasks**: 0/0 done
- **Tests**: -
- **Target Conditions**: 0/0 passed
- **Estimated Cost**: -

## Log
${logEntry('created: Adventure created')}
`;

        // Write manifest file
        await writeState(manifestPath, frontmatter, body);

        // Emit adventure.created event
        await eventEmitter.emit('adventure.created', null, { id: advId, title });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                id: advId,
                title,
                state: 'planning',
                path: manifestPath,
              }),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: error.message }),
            },
          ],
          isError: true,
        };
      }
    }
  );

  // pipeline.adventure_get
  server.tool(
    'pipeline.adventure_get',
    'Read and parse an adventure manifest',
    {
      id: { type: 'string', description: 'Adventure ID (e.g., ADV-001)' },
    },
    async ({ id }) => {
      try {
        const { agentDir } = resolveAgentDir();
        if (!agentDir) {
          throw new Error('Could not find .agent/ directory');
        }

        const manifestPath = join(agentDir, 'adventures', id, 'manifest.md');
        if (!existsSync(manifestPath)) {
          throw new Error(`Adventure ${id} not found`);
        }

        const { frontmatter, body } = await readState(manifestPath);

        // Parse TC summary from the body
        const tc_summary = parseTcSummary(body);

        // Read task files listed in frontmatter.tasks to get completion counts
        const taskIds = frontmatter.tasks || [];
        let completed = 0;
        let in_progress = 0;

        if (taskIds.length > 0) {
          const tasksDir = join(agentDir, 'tasks');
          for (const taskId of taskIds) {
            const taskPath = join(tasksDir, `${taskId}.md`);
            if (existsSync(taskPath)) {
              try {
                const { frontmatter: taskFm } = await readState(taskPath);
                if (taskFm.stage === 'completed' || taskFm.stage === 'researching') {
                  completed++;
                } else {
                  in_progress++;
                }
              } catch {
                // Skip unreadable task files
              }
            }
          }
        }

        const task_summary = {
          total: taskIds.length,
          completed,
          in_progress,
        };

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                ...frontmatter,
                body,
                tc_summary,
                task_summary,
              }),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: error.message }),
            },
          ],
          isError: true,
        };
      }
    }
  );

  // pipeline.adventure_list
  server.tool(
    'pipeline.adventure_list',
    'List all adventures with optional state filter',
    {
      state: { type: 'string', description: 'Filter by state (optional): planning, active, completed, cancelled' },
    },
    async ({ state }) => {
      try {
        const { agentDir } = resolveAgentDir();
        if (!agentDir) {
          throw new Error('Could not find .agent/ directory');
        }

        const adventuresDir = join(agentDir, 'adventures');
        if (!existsSync(adventuresDir)) {
          return {
            content: [{ type: 'text', text: JSON.stringify([]) }],
          };
        }

        const entries = await readdir(adventuresDir);
        const adventures = [];

        for (const entry of entries) {
          if (!/^ADV-\d{3}$/.test(entry)) continue;

          const manifestPath = join(adventuresDir, entry, 'manifest.md');
          if (!existsSync(manifestPath)) continue;

          const { frontmatter } = await readState(manifestPath);

          // Apply state filter if provided
          if (state && frontmatter.state !== state) continue;

          adventures.push({
            id: frontmatter.id,
            title: frontmatter.title,
            state: frontmatter.state,
            created: frontmatter.created,
            updated: frontmatter.updated,
            tasks: frontmatter.tasks || [],
          });
        }

        // Sort by created date (oldest first, to maintain chronological order)
        adventures.sort((a, b) => new Date(a.created) - new Date(b.created));

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(adventures),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: error.message }),
            },
          ],
          isError: true,
        };
      }
    }
  );

  // pipeline.adventure_update
  server.tool(
    'pipeline.adventure_update',
    'Update adventure metadata fields (title, concept, tasks, tags). To change state use adventure_advance.',
    {
      id: { type: 'string', description: 'Adventure ID (e.g., ADV-001)' },
      fields: { type: 'object', description: 'Fields to merge into frontmatter (state is not allowed here)' },
    },
    async ({ id, fields }) => {
      try {
        if (fields.state !== undefined) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: 'VALIDATION_ERROR',
                  message: 'Cannot set state via adventure_update. Use adventure_advance to transition state.',
                }),
              },
            ],
            isError: true,
          };
        }

        const { agentDir } = resolveAgentDir();
        if (!agentDir) {
          throw new Error('Could not find .agent/ directory');
        }

        const manifestPath = join(agentDir, 'adventures', id, 'manifest.md');
        if (!existsSync(manifestPath)) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ error: 'NOT_FOUND', message: `Adventure ${id} not found` }),
              },
            ],
            isError: true,
          };
        }

        const { frontmatter, body } = await readState(manifestPath);
        const updated = deepMerge(frontmatter, fields);
        updated.updated = timestamp();

        await writeState(manifestPath, updated, body);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(updated),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: error.message }),
            },
          ],
          isError: true,
        };
      }
    }
  );

  // pipeline.adventure_advance
  server.tool(
    'pipeline.adventure_advance',
    'Advance an adventure to a new state following valid transitions',
    {
      id: { type: 'string', description: 'Adventure ID (e.g., ADV-001)' },
      target_state: { type: 'string', description: 'Target state to transition to' },
    },
    async ({ id, target_state }) => {
      try {
        const { agentDir } = resolveAgentDir();
        if (!agentDir) {
          throw new Error('Could not find .agent/ directory');
        }

        const manifestPath = join(agentDir, 'adventures', id, 'manifest.md');
        if (!existsSync(manifestPath)) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ error: 'NOT_FOUND', message: `Adventure ${id} not found` }),
              },
            ],
            isError: true,
          };
        }

        const { frontmatter, body } = await readState(manifestPath);
        const from_state = frontmatter.state;

        const validation = validateAdventureTransition(from_state, target_state);
        if (!validation.valid) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ error: 'INVALID_TRANSITION', message: validation.error }),
              },
            ],
            isError: true,
          };
        }

        frontmatter.state = target_state;
        frontmatter.updated = timestamp();

        const newBody = body + logEntry(`advanced: ${from_state} -> ${target_state}`) + '\n';

        await writeState(manifestPath, frontmatter, newBody);

        // Emit event based on target state
        if (target_state === 'completed') {
          await eventEmitter.emit('adventure.completed', null, { id, title: frontmatter.title });
        } else {
          await eventEmitter.emit('adventure.advanced', null, { id, from_state, to_state: target_state });
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ id, from_state, to_state: target_state }),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: error.message }),
            },
          ],
          isError: true,
        };
      }
    }
  );

  // pipeline.adventure_status
  server.tool(
    'pipeline.adventure_status',
    'Get adventure status including TC progress and task completion stats by stage',
    {
      id: { type: 'string', description: 'Adventure ID (e.g., ADV-001)' },
    },
    async ({ id }) => {
      try {
        const { agentDir } = resolveAgentDir();
        if (!agentDir) {
          throw new Error('Could not find .agent/ directory');
        }

        const manifestPath = join(agentDir, 'adventures', id, 'manifest.md');
        if (!existsSync(manifestPath)) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ error: 'NOT_FOUND', message: `Adventure ${id} not found` }),
              },
            ],
            isError: true,
          };
        }

        const { frontmatter, body } = await readState(manifestPath);

        // Parse TC summary from manifest body
        const tc_summary = parseTcSummary(body);

        // Read each task listed in frontmatter.tasks and group by stage
        const taskIds = frontmatter.tasks || [];
        const by_stage = {
          planning: 0,
          implementing: 0,
          reviewing: 0,
          fixing: 0,
          completed: 0,
          researching: 0,
        };
        let completedCount = 0;
        let in_progress = 0;

        if (taskIds.length > 0) {
          const tasksDir = join(agentDir, 'tasks');
          for (const taskId of taskIds) {
            const taskPath = join(tasksDir, `${taskId}.md`);
            if (existsSync(taskPath)) {
              try {
                const { frontmatter: taskFm } = await readState(taskPath);
                const stage = taskFm.stage || 'planning';
                if (by_stage[stage] !== undefined) {
                  by_stage[stage]++;
                }
                if (stage === 'completed' || stage === 'researching') {
                  completedCount++;
                } else {
                  in_progress++;
                }
              } catch {
                // Skip unreadable task files
              }
            }
          }
        }

        const task_summary = {
          total: taskIds.length,
          completed: completedCount,
          in_progress,
          by_stage,
        };

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                id: frontmatter.id,
                title: frontmatter.title,
                state: frontmatter.state,
                tc_summary,
                task_summary,
              }),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: error.message }),
            },
          ],
          isError: true,
        };
      }
    }
  );
}
