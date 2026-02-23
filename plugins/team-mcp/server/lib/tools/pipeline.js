import { join } from 'path';
import { resolveAgentDir, listFiles, readState } from '../state.js';
import { STAGES } from '../schema.js';

/**
 * Register pipeline state tools.
 */
export function registerPipelineTools(server) {
  // pipeline.status
  server.tool(
    'pipeline.status',
    'Get full pipeline status with tasks grouped by stage, active agents, and queue',
    {},
    async () => {
      try {
        const { agentDir } = resolveAgentDir();
        if (!agentDir) {
          throw new Error('No .agent/ directory found in project hierarchy');
        }

        const tasksDir = join(agentDir, 'tasks');
        const taskFiles = await listFiles(tasksDir, /^TASK-\d+\.md$/);

        // Read all task files
        const tasks = [];
        for (const filename of taskFiles) {
          const filePath = join(tasksDir, filename);
          const { frontmatter } = await readState(filePath);
          tasks.push({
            id: frontmatter.id,
            title: frontmatter.title,
            stage: frontmatter.stage,
            status: frontmatter.status,
            assignee: frontmatter.assignee,
            created: frontmatter.created,
            updated: frontmatter.updated,
            iterations: frontmatter.iterations,
            depends_on: frontmatter.depends_on || [],
            tags: frontmatter.tags || [],
            packages: frontmatter.packages || [],
          });
        }

        // Group tasks by stage
        const tasks_by_stage = {};
        for (const stage of STAGES) {
          tasks_by_stage[stage] = tasks.filter((t) => t.stage === stage);
        }

        // Read lead-state.md if it exists
        const leadStatePath = join(agentDir, 'lead-state.md');
        let active_agents = [];
        let queue = [];
        let pending_proposals = 0;

        try {
          const { frontmatter } = await readState(leadStatePath);
          active_agents = frontmatter.active_agents || [];
          queue = frontmatter.queue || [];
          pending_proposals = frontmatter.pending_proposals || 0;
        } catch (err) {
          // lead-state.md doesn't exist yet, use empty defaults
        }

        // Calculate summary
        const summary = {
          total: tasks.length,
          by_stage: {},
        };
        for (const stage of STAGES) {
          summary.by_stage[stage] = tasks_by_stage[stage].length;
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  tasks_by_stage,
                  active_agents,
                  queue,
                  pending_proposals,
                  summary,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: error.message,
              }),
            },
          ],
          isError: true,
        };
      }
    }
  );
}
