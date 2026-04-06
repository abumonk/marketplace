/**
 * Adventure management MCP tools.
 */

import { join } from 'path';
import { readdir, unlink, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import {
  resolveAgentDir,
  readState,
  writeState,
  ensureDir,
  timestamp,
  logEntry,
  deepMerge,
  appendAdventureLog,
  appendAdventureMetrics,
} from '../state.js';
import { validateAdventureTransition } from '../schema.js';
import { eventEmitter } from '../events.js';

/**
 * Parse TC status counts from the Target Conditions table in a manifest body.
 * Uses column-aware parsing: finds the Target Conditions table header,
 * identifies the Status column index, then reads status from each data row.
 *
 * Handles edge cases: empty tables, extra whitespace, markdown-formatted
 * status values, malformed rows with too few columns, and missing separators.
 *
 * @param {string} body
 * @returns {{ total: number, passed: number, pending: number, failed: number, rows: Array<{id: string, status: string}> }}
 */
export function parseTcSummary(body) {
  const summary = { total: 0, passed: 0, pending: 0, failed: 0, rows: [] };

  if (!body || typeof body !== 'string') return summary;

  const lines = body.split('\n');

  // Find the Target Conditions table header row
  let headerIdx = -1;
  let statusCol = -1;
  let idCol = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('|')) continue;
    // Look for a table header row containing both "ID" and "Status" columns
    if (/\bID\b/i.test(line) && /\bStatus\b/i.test(line)) {
      const cols = line.split('|').map((c) => c.trim()).filter((c) => c !== '');
      idCol = cols.findIndex((c) => /^ID$/i.test(c));
      statusCol = cols.findIndex((c) => /^Status$/i.test(c));
      if (idCol !== -1 && statusCol !== -1) {
        headerIdx = i;
        break;
      }
    }
  }

  if (headerIdx === -1) return summary;

  // Skip the separator row: verify it's a valid separator (|---|...|)
  // If next line isn't a separator, start data rows immediately after header
  let dataStart = headerIdx + 1;
  if (dataStart < lines.length) {
    const sepLine = lines[dataStart].trim();
    if (/^\|[\s:|-]+\|$/.test(sepLine) || /^\|[\s:|-]+$/.test(sepLine)) {
      dataStart = headerIdx + 2;
    }
  }

  for (let i = dataStart; i < lines.length; i++) {
    const line = lines[i].trim();
    // Stop at empty line, next heading, or non-table line
    if (!line || !line.startsWith('|')) break;

    const cols = line.split('|').map((c) => c.trim()).filter((c) => c !== '');
    // Skip rows with too few columns to have both ID and Status
    if (cols.length <= Math.max(idCol, statusCol)) continue;

    const id = cols[idCol];
    // Must contain TC-NNN pattern to be a valid TC row (skip filler/empty rows)
    if (!/TC-\d+/.test(id)) continue;

    // Strip markdown formatting (bold, links, code, etc.) from status
    const rawStatus = cols[statusCol].replace(/[*_`\[\]()]/g, '').trim().toLowerCase();
    // Skip rows where status cell is empty after stripping
    if (!rawStatus) continue;

    const cleanId = id.replace(/[*_`\[\]()]/g, '').trim();
    summary.total++;
    summary.rows.push({ id: cleanId, status: rawStatus });

    if (rawStatus === 'passed') {
      summary.passed++;
    } else if (rawStatus === 'failed') {
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
      environment: {
        type: 'object',
        description: 'Environment data collected at creation (project, workspace, repo, branch, pc, platform, runtime, shell)',
      },
    },
    async ({ title, concept, tags, environment }) => {
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

        // Create adventure directory and subdirectories
        const advDir = join(adventuresDir, advId);
        await ensureDir(advDir);
        await ensureDir(join(advDir, 'designs'));
        await ensureDir(join(advDir, 'plans'));
        await ensureDir(join(advDir, 'schemas'));
        await ensureDir(join(advDir, 'tasks'));
        await ensureDir(join(advDir, 'tasks', 'archive'));
        await ensureDir(join(advDir, 'roles'));
        await ensureDir(join(advDir, 'tests'));

        const manifestPath = join(advDir, 'manifest.md');
        const now = timestamp();

        // Build frontmatter
        const frontmatter = {
          id: advId,
          title,
          state: 'concept',
          created: now,
          updated: now,
          tasks: [],
        };

        if (tags && tags.length > 0) {
          frontmatter.tags = tags;
        }

        // Build body with environment data
        const conceptText = concept || '';
        const env = environment || {};
        const body = `
## Concept
${conceptText}

## Target Conditions
| ID | Description | Source | Design | Plan | Task(s) | Proof Method | Proof Command | Status |
|----|-------------|--------|--------|------|---------|-------------|---------------|--------|

## Evaluations
| Task | Access Requirements | Skill Set | Est. Duration | Est. Tokens | Est. Cost | Actual Duration | Actual Tokens | Actual Cost | Variance |
|------|-------------------|-----------|---------------|-------------|-----------|-----------------|---------------|-------------|----------|

## Environment
- **Project**: ${env.project || '-'}
- **Workspace**: ${env.workspace || '-'}
- **Repo**: ${env.repo || '-'}
- **Branch**: ${env.branch || '-'}
- **PC**: ${env.pc || '-'}
- **Platform**: ${env.platform || '-'}
- **Runtime**: ${env.runtime || '-'}
- **Shell**: ${env.shell || '-'}
`;

        // Write manifest file
        await writeState(manifestPath, frontmatter, body);

        // Initialize adventure.log
        await appendAdventureLog(advDir, 'lead', `adventure created: ${advId} ${title}`);

        // Initialize metrics.md
        const metricsContent = `---
adventure_id: ${advId}
total_tokens_in: 0
total_tokens_out: 0
total_duration: 0
total_cost: 0.00
agent_runs: 0
---

## Agent Runs

| Agent | Task | Model | Tokens In | Tokens Out | Duration | Turns | Result |
|-------|------|-------|-----------|------------|----------|-------|--------|
`;
        await writeFile(join(advDir, 'metrics.md'), metricsContent, 'utf-8');

        // Emit adventure.created event
        await eventEmitter.emit('adventure.created', null, { id: advId, title });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                id: advId,
                title,
                state: 'concept',
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

        // Read task files from adventure's own tasks/ directory
        const advDir = join(agentDir, 'adventures', id);
        const advTasksDir = join(advDir, 'tasks');
        const taskIds = frontmatter.tasks || [];
        let completed = 0;
        let in_progress = 0;

        if (taskIds.length > 0) {
          for (const taskId of taskIds) {
            const taskPath = join(advTasksDir, `${taskId}.md`);
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

        // Read metrics summary if available
        let metrics = null;
        const metricsPath = join(advDir, 'metrics.md');
        if (existsSync(metricsPath)) {
          try {
            const { frontmatter: metricsFm } = await readState(metricsPath);
            metrics = metricsFm;
          } catch {
            // Non-fatal
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
                ...(metrics && { metrics }),
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

        // Cascade cleanup on cancellation: archive all associated tasks
        // Scans both frontmatter.tasks list AND tasks/ directory for orphans
        const advDir = join(agentDir, 'adventures', id);
        const archivedTasks = [];
        if (target_state === 'cancelled') {
          const advTasksDir = join(advDir, 'tasks');
          const archiveDir = join(advTasksDir, 'archive');
          await ensureDir(archiveDir);

          // Collect task IDs from both manifest and filesystem to catch orphans
          const manifestTaskIds = new Set(frontmatter.tasks || []);
          const fsTaskIds = new Set();
          if (existsSync(advTasksDir)) {
            const files = await readdir(advTasksDir);
            for (const f of files) {
              const match = f.match(/^(ADV\d{3}-T\d{3})\.md$/);
              if (match) fsTaskIds.add(match[1]);
            }
          }
          const allTaskIds = new Set([...manifestTaskIds, ...fsTaskIds]);

          for (const taskId of allTaskIds) {
            const taskPath = join(advTasksDir, `${taskId}.md`);
            if (existsSync(taskPath)) {
              try {
                const { frontmatter: taskFm, body: taskBody } = await readState(taskPath);
                // Only archive non-completed tasks
                if (taskFm.stage !== 'completed' && taskFm.stage !== 'researching') {
                  taskFm.stage = 'completed';
                  taskFm.status = 'cancelled';
                  taskFm.updated = timestamp();
                  const updatedTaskBody =
                    taskBody + logEntry(`cancelled: Adventure ${id} cancelled`) + '\n';
                  const archivePath = join(archiveDir, `${taskId}.md`);
                  await writeState(archivePath, taskFm, updatedTaskBody);
                  // Remove from active tasks
                  await unlink(taskPath);
                  archivedTasks.push(taskId);
                }
              } catch {
                // Skip unreadable task files
              }
            }
          }
        }

        // Append to adventure.log
        let logMsg = `state: ${from_state} -> ${target_state}`;
        if (archivedTasks.length > 0) {
          logMsg += ` | archived ${archivedTasks.length} tasks: ${archivedTasks.join(', ')}`;
        }
        await appendAdventureLog(advDir, 'lead', logMsg);

        // Update manifest body with log entry and write
        const newBody = body + logEntry(`advanced: ${from_state} -> ${target_state}`) + '\n';
        await writeState(manifestPath, frontmatter, newBody);

        // Determine if this is a terminal state (triggers reporter)
        const isTerminal = ['completed', 'cancelled', 'blocked'].includes(target_state);

        // Emit event based on target state
        if (target_state === 'completed') {
          await eventEmitter.emit('adventure.completed', null, { id, title: frontmatter.title, terminal: true });
        } else if (target_state === 'cancelled') {
          await eventEmitter.emit('adventure.cancelled', null, {
            id,
            title: frontmatter.title,
            archived_tasks: archivedTasks,
            terminal: true,
          });
        } else if (target_state === 'blocked') {
          await eventEmitter.emit('adventure.blocked', null, { id, title: frontmatter.title, terminal: true });
        } else {
          await eventEmitter.emit('adventure.advanced', null, { id, from_state, to_state: target_state });
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                id,
                from_state,
                to_state: target_state,
                ...(archivedTasks.length > 0 && { archived_tasks: archivedTasks }),
                ...(isTerminal && { terminal: true, spawn_reporter: true }),
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

        // Read tasks from adventure's own tasks/ directory
        const advDir = join(agentDir, 'adventures', id);
        const advTasksDir = join(advDir, 'tasks');
        const taskIds = frontmatter.tasks || [];
        const by_stage = {
          planning: 0,
          preparing: 0,
          implementing: 0,
          reviewing: 0,
          fixing: 0,
          completed: 0,
          researching: 0,
        };
        let completedCount = 0;
        let in_progress = 0;

        if (taskIds.length > 0) {
          for (const taskId of taskIds) {
            const taskPath = join(advTasksDir, `${taskId}.md`);
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

        // Read metrics
        let metrics = null;
        const metricsPath = join(advDir, 'metrics.md');
        if (existsSync(metricsPath)) {
          try {
            const { frontmatter: metricsFm } = await readState(metricsPath);
            metrics = metricsFm;
          } catch {
            // Non-fatal
          }
        }

        // Check for reports
        const hasReportEn = existsSync(join(advDir, 'report-en.md'));
        const hasReportRu = existsSync(join(advDir, 'report-ru.md'));

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
                ...(metrics && { metrics }),
                reports: { en: hasReportEn, ru: hasReportRu },
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

  // pipeline.adventure_log
  server.tool(
    'pipeline.adventure_log',
    'Append a log entry to an adventure\'s adventure.log (append-only)',
    {
      id: { type: 'string', description: 'Adventure ID (e.g., ADV-001)' },
      agent: { type: 'string', description: 'Agent identifier (e.g., lead, adventure-planner)' },
      message: { type: 'string', description: 'Log message' },
    },
    async ({ id, agent, message }) => {
      try {
        const { agentDir } = resolveAgentDir();
        if (!agentDir) {
          throw new Error('Could not find .agent/ directory');
        }

        const advDir = join(agentDir, 'adventures', id);
        if (!existsSync(advDir)) {
          throw new Error(`Adventure ${id} not found`);
        }

        await appendAdventureLog(advDir, agent, message);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ id, logged: true }),
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

  // pipeline.adventure_task_create
  server.tool(
    'pipeline.adventure_task_create',
    'Create a new task within an adventure. Rejects creation for completed/cancelled adventures.',
    {
      adventure_id: { type: 'string', description: 'Adventure ID (e.g., ADV-001)' },
      title: { type: 'string', description: 'Task title' },
      description: { type: 'string', description: 'Task description' },
      files: { type: 'array', items: { type: 'string' }, description: 'Target files' },
      depends_on: { type: 'array', items: { type: 'string' }, description: 'Task dependencies' },
      target_conditions: { type: 'array', items: { type: 'string' }, description: 'TC IDs this task must satisfy' },
      plan: { type: 'string', description: 'Plan reference (e.g., plan-001)' },
    },
    async ({ adventure_id, title, description, files, depends_on, target_conditions, plan }) => {
      try {
        const { agentDir } = resolveAgentDir();
        if (!agentDir) throw new Error('Could not find .agent/ directory');

        const advDir = join(agentDir, 'adventures', adventure_id);
        const manifestPath = join(advDir, 'manifest.md');
        if (!existsSync(manifestPath)) throw new Error(`Adventure ${adventure_id} not found`);

        const { frontmatter, body } = await readState(manifestPath);

        // Reject task creation for terminal states
        if (frontmatter.state === 'completed') {
          return {
            content: [{ type: 'text', text: JSON.stringify({
              error: 'TERMINAL_STATE',
              message: `Adventure ${adventure_id} is completed (terminal). Start a new adventure for follow-up work.`,
            }) }],
            isError: true,
          };
        }
        if (frontmatter.state === 'cancelled') {
          return {
            content: [{ type: 'text', text: JSON.stringify({
              error: 'TERMINAL_STATE',
              message: `Adventure ${adventure_id} is cancelled (terminal). Start a new adventure for follow-up work.`,
            }) }],
            isError: true,
          };
        }

        // Find next task number
        const advTasksDir = join(advDir, 'tasks');
        await ensureDir(advTasksDir);
        const advNum = adventure_id.replace('ADV-', '');
        let existingFiles = [];
        if (existsSync(advTasksDir)) {
          existingFiles = await readdir(advTasksDir);
        }
        const taskPattern = new RegExp(`^ADV${advNum}-T(\\d{3})\\.md$`);
        const taskNumbers = existingFiles
          .map((f) => { const m = f.match(taskPattern); return m ? parseInt(m[1], 10) : 0; })
          .filter((n) => n > 0);
        const nextNum = taskNumbers.length > 0 ? Math.max(...taskNumbers) + 1 : 1;
        const taskId = `ADV${advNum}-T${String(nextNum).padStart(3, '0')}`;

        const now = timestamp();
        const taskFrontmatter = {
          id: taskId,
          title,
          stage: 'planning',
          status: 'in_progress',
          created: now,
          updated: now,
          iterations: 0,
          assignee: 'planner',
          files: files || [],
          repos: [],
          depends_on: depends_on || [],
          tags: [],
          adventure_id,
          adventure_plan: plan || '',
          target_conditions: target_conditions || [],
        };

        const taskBody = `
## Description
${description || ''}

## Acceptance Criteria
<!-- Defined by planner -->

## Design
<!-- Filled by planner agent -->

## Log
- [${now}] created: Task created in adventure ${adventure_id}
`;

        const taskPath = join(advTasksDir, `${taskId}.md`);
        await writeState(taskPath, taskFrontmatter, taskBody);

        // Add task to manifest's tasks list
        const tasks = frontmatter.tasks || [];
        tasks.push(taskId);
        frontmatter.tasks = tasks;
        frontmatter.updated = now;
        await writeState(manifestPath, frontmatter, body);

        // If adventure was blocked, transition to active
        if (frontmatter.state === 'blocked') {
          frontmatter.state = 'active';
          await writeState(manifestPath, frontmatter, body);
          await appendAdventureLog(advDir, 'lead', `state: blocked -> active (new task ${taskId} created)`);
        }

        await appendAdventureLog(advDir, 'lead', `task created: ${taskId} "${title}"`);

        return {
          content: [{ type: 'text', text: JSON.stringify({
            id: taskId,
            adventure_id,
            title,
            state_change: frontmatter.state === 'active' && taskNumbers.length > 0 ? null : 'blocked -> active',
            path: taskPath,
          }) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: error.message }) }],
          isError: true,
        };
      }
    }
  );

  // pipeline.adventure_metrics
  server.tool(
    'pipeline.adventure_metrics',
    'Append an agent run row to an adventure\'s metrics.md',
    {
      id: { type: 'string', description: 'Adventure ID (e.g., ADV-001)' },
      row: { type: 'string', description: 'Pipe-delimited metrics row (e.g., "| planner | ADV015-T001 | opus | 5000 | 3000 | 120 | 8 | complete |")' },
    },
    async ({ id, row }) => {
      try {
        const { agentDir } = resolveAgentDir();
        if (!agentDir) {
          throw new Error('Could not find .agent/ directory');
        }

        const advDir = join(agentDir, 'adventures', id);
        if (!existsSync(advDir)) {
          throw new Error(`Adventure ${id} not found`);
        }

        await appendAdventureMetrics(advDir, row);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ id, metrics_appended: true }),
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
