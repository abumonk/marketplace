/**
 * Task management MCP tools.
 */

import { join } from 'path';
import { readdir } from 'fs/promises';
import { existsSync } from 'fs';
import {
  resolveAgentDir,
  readState,
  writeState,
  ensureDir,
  moveFile,
  timestamp,
  logEntry,
  deepMerge,
} from '../state.js';
import {
  validateTask,
  validateTransition,
  getNextStage,
  getDefaultAssignee,
  STAGES,
} from '../schema.js';
import { eventEmitter } from '../events.js';

/**
 * Register all task management tools.
 */
export function registerTaskTools(server) {
  // pipeline.task_create
  server.tool(
    'pipeline.task_create',
    'Create a new task with validated frontmatter',
    {
      title: { type: 'string', description: 'Task title' },
      description: { type: 'string', description: 'Task description (optional)' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Task tags (optional)' },
      depends_on: { type: 'array', items: { type: 'string' }, description: 'Task IDs this task depends on (optional)' },
      packages: { type: 'array', items: { type: 'string' }, description: 'Package/folder restrictions (optional)' },
    },
    async ({ title, description, tags, depends_on, packages }) => {
      try {
        const { agentDir } = resolveAgentDir();
        if (!agentDir) {
          throw new Error('Could not find .agent/ directory');
        }

        const tasksDir = join(agentDir, 'tasks');
        await ensureDir(tasksDir);

        // Find highest TASK-NNN number
        const taskFiles = await readdir(tasksDir);
        const taskNumbers = taskFiles
          .filter((f) => /^TASK-\d{3}\.md$/.test(f))
          .map((f) => parseInt(f.match(/\d{3}/)[0], 10));
        const nextNumber = taskNumbers.length > 0 ? Math.max(...taskNumbers) + 1 : 1;
        const taskId = `TASK-${String(nextNumber).padStart(3, '0')}`;
        const taskPath = join(tasksDir, `${taskId}.md`);

        // Build frontmatter
        const now = timestamp();
        const frontmatter = {
          id: taskId,
          title,
          stage: 'planning',
          status: 'in_progress',
          created: now,
          updated: now,
          iterations: 0,
          assignee: 'planner',
          files: [],
          repos: [],
          depends_on: depends_on || [],
          tags: tags || [],
          packages: packages || [],
        };

        // Build body
        const body = `## Description

${description || ''}

## Acceptance Criteria

- [ ]

## Design
<!-- Filled by planner agent -->

## Log
${logEntry('created: Task created')}
`;

        // Validate
        const validation = validateTask(frontmatter);
        if (!validation.valid) {
          throw new Error(`Task validation failed: ${validation.errors.join(', ')}`);
        }

        // Write task file
        await writeState(taskPath, frontmatter, body);

        // Emit task.created event (non-blocking; errors are logged internally)
        await eventEmitter.emit('task.created', taskId, {
          title,
          assignee: frontmatter.assignee,
          tags: frontmatter.tags,
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                id: taskId,
                title,
                stage: 'planning',
                path: taskPath,
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

  // pipeline.task_get
  server.tool(
    'pipeline.task_get',
    'Read and parse a task file',
    {
      id: { type: 'string', description: 'Task ID (e.g., TASK-001)' },
    },
    async ({ id }) => {
      try {
        const { agentDir } = resolveAgentDir();
        if (!agentDir) {
          throw new Error('Could not find .agent/ directory');
        }

        const taskPath = join(agentDir, 'tasks', `${id}.md`);
        if (!existsSync(taskPath)) {
          throw new Error(`Task ${id} not found`);
        }

        const { frontmatter, body } = await readState(taskPath);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                ...frontmatter,
                body,
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

  // pipeline.task_list
  server.tool(
    'pipeline.task_list',
    'List all tasks with optional filters',
    {
      stage: { type: 'string', description: 'Filter by stage (optional)' },
      status: { type: 'string', description: 'Filter by status (optional)' },
      assignee: { type: 'string', description: 'Filter by assignee (optional)' },
    },
    async ({ stage, status, assignee }) => {
      try {
        const { agentDir } = resolveAgentDir();
        if (!agentDir) {
          throw new Error('Could not find .agent/ directory');
        }

        const tasksDir = join(agentDir, 'tasks');
        if (!existsSync(tasksDir)) {
          return {
            content: [{ type: 'text', text: JSON.stringify([]) }],
          };
        }

        const taskFiles = await readdir(tasksDir);
        const tasks = [];

        for (const file of taskFiles) {
          if (!/^TASK-\d{3}\.md$/.test(file)) continue;

          const taskPath = join(tasksDir, file);
          const { frontmatter } = await readState(taskPath);

          // Apply filters
          if (stage && frontmatter.stage !== stage) continue;
          if (status && frontmatter.status !== status) continue;
          if (assignee && frontmatter.assignee !== assignee) continue;

          tasks.push({
            id: frontmatter.id,
            title: frontmatter.title,
            stage: frontmatter.stage,
            status: frontmatter.status,
            assignee: frontmatter.assignee,
            iterations: frontmatter.iterations,
            updated: frontmatter.updated,
          });
        }

        // Sort by updated timestamp (most recent first)
        tasks.sort((a, b) => new Date(b.updated) - new Date(a.updated));

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(tasks),
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

  // pipeline.task_update
  server.tool(
    'pipeline.task_update',
    'Update task frontmatter fields with validation',
    {
      id: { type: 'string', description: 'Task ID (e.g., TASK-001)' },
      fields: { type: 'object', description: 'Fields to update' },
    },
    async ({ id, fields }) => {
      try {
        const { agentDir } = resolveAgentDir();
        if (!agentDir) {
          throw new Error('Could not find .agent/ directory');
        }

        const taskPath = join(agentDir, 'tasks', `${id}.md`);
        if (!existsSync(taskPath)) {
          throw new Error(`Task ${id} not found`);
        }

        const { frontmatter, body } = await readState(taskPath);

        // Merge fields
        const updatedFrontmatter = deepMerge(frontmatter, fields);
        updatedFrontmatter.updated = timestamp();

        // Validate
        const validation = validateTask(updatedFrontmatter);
        if (!validation.valid) {
          throw new Error(`Task validation failed: ${validation.errors.join(', ')}`);
        }

        // Append log entry with changed fields
        const changedFields = Object.keys(fields).join(', ');
        const updatedBody = body + '\n' + logEntry(`updated: ${changedFields}`);

        // Write back
        await writeState(taskPath, updatedFrontmatter, updatedBody);

        // Emit status-change events when status is set to failed or cancelled
        if (fields.status === 'failed' || fields.status === 'error') {
          await eventEmitter.emit('task.failed', id, {
            title: updatedFrontmatter.title,
            stage: updatedFrontmatter.stage,
            iteration: updatedFrontmatter.iterations,
          });
        } else if (fields.status === 'cancelled') {
          await eventEmitter.emit('task.cancelled', id, {
            title: updatedFrontmatter.title,
            previous_stage: frontmatter.stage,
            reason: fields.reason || null,
          });
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(updatedFrontmatter),
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

  // pipeline.task_advance
  server.tool(
    'pipeline.task_advance',
    'Advance task to next stage with validation',
    {
      id: { type: 'string', description: 'Task ID (e.g., TASK-001)' },
    },
    async ({ id }) => {
      try {
        const { agentDir } = resolveAgentDir();
        if (!agentDir) {
          throw new Error('Could not find .agent/ directory');
        }

        const taskPath = join(agentDir, 'tasks', `${id}.md`);
        if (!existsSync(taskPath)) {
          throw new Error(`Task ${id} not found`);
        }

        const { frontmatter, body } = await readState(taskPath);

        // Determine next stage
        const nextStage = getNextStage(frontmatter.stage, frontmatter.status);
        if (!nextStage) {
          throw new Error(`Cannot advance task ${id}: stage '${frontmatter.stage}' with status '${frontmatter.status}' has no automatic transition`);
        }

        // Validate transition
        const transitionValidation = validateTransition(frontmatter.stage, nextStage);
        if (!transitionValidation.valid) {
          throw new Error(`Transition validation failed: ${transitionValidation.error}`);
        }

        // Check dependencies
        if (frontmatter.depends_on && frontmatter.depends_on.length > 0) {
          const tasksDir = join(agentDir, 'tasks');
          for (const depId of frontmatter.depends_on) {
            const depPath = join(tasksDir, `${depId}.md`);
            if (!existsSync(depPath)) {
              throw new Error(`Dependency ${depId} not found`);
            }
            const { frontmatter: depFrontmatter } = await readState(depPath);
            if (depFrontmatter.stage !== 'completed' && depFrontmatter.stage !== 'researching') {
              throw new Error(`Cannot advance: dependency ${depId} is in stage '${depFrontmatter.stage}' (must be 'completed' or 'researching')`);
            }
          }
        }

        const oldStage = frontmatter.stage;
        const newAssignee = getDefaultAssignee(nextStage);

        // Update frontmatter
        frontmatter.stage = nextStage;
        frontmatter.status = 'in_progress';
        frontmatter.assignee = newAssignee;
        frontmatter.updated = timestamp();

        // Increment iterations if fixing -> reviewing
        if (oldStage === 'fixing' && nextStage === 'reviewing') {
          frontmatter.iterations = (frontmatter.iterations || 0) + 1;
        }

        // Append log entry
        const updatedBody = body + '\n' + logEntry(`advanced: ${oldStage} -> ${nextStage}`);

        // Write back
        await writeState(taskPath, frontmatter, updatedBody);

        // Emit the appropriate pipeline event
        if (nextStage === 'completed') {
          await eventEmitter.emit('task.completed', id, {
            title: frontmatter.title,
            iterations: frontmatter.iterations,
          });
        } else {
          await eventEmitter.emit('task.advanced', id, {
            from_stage: oldStage,
            to_stage: nextStage,
            assignee: newAssignee,
          });
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                id,
                from_stage: oldStage,
                to_stage: nextStage,
                assignee: newAssignee,
                iterations: frontmatter.iterations,
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

  // pipeline.task_log
  server.tool(
    'pipeline.task_log',
    'Append a log entry to a task',
    {
      id: { type: 'string', description: 'Task ID (e.g., TASK-001)' },
      message: { type: 'string', description: 'Log message' },
    },
    async ({ id, message }) => {
      try {
        const { agentDir } = resolveAgentDir();
        if (!agentDir) {
          throw new Error('Could not find .agent/ directory');
        }

        const taskPath = join(agentDir, 'tasks', `${id}.md`);
        if (!existsSync(taskPath)) {
          throw new Error(`Task ${id} not found`);
        }

        const { frontmatter, body } = await readState(taskPath);

        // Append log entry
        const entry = logEntry(message);
        const updatedBody = body + '\n' + entry;

        // Update timestamp
        frontmatter.updated = timestamp();

        // Write back
        await writeState(taskPath, frontmatter, updatedBody);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                id,
                entry,
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

  // pipeline.task_archive
  server.tool(
    'pipeline.task_archive',
    'Move a task to the archive',
    {
      id: { type: 'string', description: 'Task ID (e.g., TASK-001)' },
    },
    async ({ id }) => {
      try {
        const { agentDir } = resolveAgentDir();
        if (!agentDir) {
          throw new Error('Could not find .agent/ directory');
        }

        const tasksDir = join(agentDir, 'tasks');
        const archiveDir = join(tasksDir, 'archive');
        await ensureDir(archiveDir);

        const taskPath = join(tasksDir, `${id}.md`);
        if (!existsSync(taskPath)) {
          throw new Error(`Task ${id} not found`);
        }

        const archivePath = join(archiveDir, `${id}.md`);

        // Move file
        await moveFile(taskPath, archivePath);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                id,
                archived_to: archivePath,
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
