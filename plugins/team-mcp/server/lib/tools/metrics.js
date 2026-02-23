import { join } from 'path';
import { existsSync } from 'fs';
import { resolveAgentDir, readState, writeState, timestamp } from '../state.js';

/**
 * Parse the Agent Log markdown table from metrics.md body.
 * Returns array of log entries.
 */
function parseMetricsTable(body) {
  const lines = body.split('\n');
  const entries = [];
  let inTable = false;
  let headerPassed = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Check if we're entering the Agent Log section
    if (trimmed === '## Agent Log') {
      inTable = true;
      headerPassed = false;
      continue;
    }

    if (!inTable) continue;

    // Skip empty lines
    if (trimmed === '') continue;

    // Skip table header row and separator row
    if (!headerPassed) {
      if (trimmed.startsWith('|') && trimmed.includes('Timestamp')) {
        continue;
      }
      if (trimmed.startsWith('|') && trimmed.includes('---')) {
        headerPassed = true;
        continue;
      }
      continue;
    }

    // Check if we hit another section (starts with ##)
    if (trimmed.startsWith('##')) {
      break;
    }

    // Parse table row
    if (trimmed.startsWith('|')) {
      const parts = trimmed
        .split('|')
        .slice(1, -1) // Remove empty first and last elements
        .map((p) => p.trim());

      if (parts.length >= 8) {
        entries.push({
          timestamp: parts[0],
          task: parts[1],
          role: parts[2],
          model: parts[3],
          stage: parts[4],
          turns: parseInt(parts[5]) || 0,
          tokens_in: parseInt(parts[6]) || 0,
          tokens_out: parseInt(parts[7]) || 0,
          duration_min: parts[8] ? parseFloat(parts[8]) : null,
          result: parts[9] || '',
        });
      }
    }
  }

  return entries;
}

/**
 * Format a metrics log entry as a markdown table row.
 */
function formatMetricsRow(entry) {
  const duration = entry.duration_min !== null && entry.duration_min !== undefined
    ? entry.duration_min.toFixed(1)
    : '';
  const result = entry.result || '';
  return `| ${entry.timestamp} | ${entry.task} | ${entry.role} | ${entry.model} | ${entry.stage} | ${entry.turns} | ${entry.tokens_in} | ${entry.tokens_out} | ${duration} | ${result} |`;
}

/**
 * Register metrics tools.
 */
export function registerMetricsTools(server) {
  // pipeline.metrics
  server.tool(
    'pipeline.metrics',
    'Query metrics with optional filters (task_id, date range)',
    {
      task_id: {
        type: 'string',
        description: 'Optional: filter by task ID',
        required: false,
      },
      date_from: {
        type: 'string',
        description: 'Optional: filter entries from this date (ISO format)',
        required: false,
      },
      date_to: {
        type: 'string',
        description: 'Optional: filter entries until this date (ISO format)',
        required: false,
      },
    },
    async ({ task_id, date_from, date_to }) => {
      try {
        const { agentDir } = resolveAgentDir();
        if (!agentDir) {
          throw new Error('No .agent/ directory found in project hierarchy');
        }

        const metricsPath = join(agentDir, 'metrics.md');
        if (!existsSync(metricsPath)) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    totals: {},
                    entries: [],
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const { frontmatter, body } = await readState(metricsPath);
        let entries = parseMetricsTable(body);

        // Apply filters
        if (task_id) {
          entries = entries.filter((e) => e.task === task_id);
        }

        if (date_from) {
          const fromDate = new Date(date_from);
          entries = entries.filter((e) => new Date(e.timestamp) >= fromDate);
        }

        if (date_to) {
          const toDate = new Date(date_to);
          entries = entries.filter((e) => new Date(e.timestamp) <= toDate);
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  totals: frontmatter,
                  entries,
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

  // pipeline.metrics_log
  server.tool(
    'pipeline.metrics_log',
    'Append a new agent performance entry to metrics.md',
    {
      task: {
        type: 'string',
        description: 'Task ID (e.g., TASK-003)',
        required: true,
      },
      role: {
        type: 'string',
        description: 'Agent role (e.g., implementer, reviewer)',
        required: true,
      },
      model: {
        type: 'string',
        description: 'Model used (e.g., sonnet, opus, haiku)',
        required: true,
      },
      stage: {
        type: 'string',
        description: 'Pipeline stage (e.g., implementing, reviewing)',
        required: true,
      },
      turns: {
        type: 'number',
        description: 'Number of turns',
        required: false,
      },
      tokens_in: {
        type: 'number',
        description: 'Input tokens',
        required: false,
      },
      tokens_out: {
        type: 'number',
        description: 'Output tokens',
        required: false,
      },
      duration_min: {
        type: 'number',
        description: 'Duration in minutes',
        required: false,
      },
      result: {
        type: 'string',
        description: 'Result (e.g., completed, failed, blocked)',
        required: false,
      },
    },
    async ({ task, role, model, stage, turns, tokens_in, tokens_out, duration_min, result }) => {
      try {
        const { agentDir } = resolveAgentDir();
        if (!agentDir) {
          throw new Error('No .agent/ directory found in project hierarchy');
        }

        const metricsPath = join(agentDir, 'metrics.md');

        let frontmatter = {
          agents_spawned: 0,
          tokens_in: 0,
          tokens_out: 0,
          avg_turns: 0,
          last_updated: timestamp(),
        };
        let body = '## Agent Log\n\n| Timestamp | Task | Role | Model | Stage | Turns | Tokens In | Tokens Out | Duration (min) | Result |\n|-----------|------|------|-------|-------|-------|-----------|------------|----------------|--------|\n';

        // Read existing metrics if file exists
        if (existsSync(metricsPath)) {
          const state = await readState(metricsPath);
          frontmatter = state.frontmatter;
          body = state.body;
        }

        // Build new entry
        const entry = {
          timestamp: timestamp(),
          task,
          role,
          model,
          stage,
          turns: turns || 0,
          tokens_in: tokens_in || 0,
          tokens_out: tokens_out || 0,
          duration_min,
          result: result || '',
        };

        // Update totals
        const newAgentsSpawned = (frontmatter.agents_spawned || 0) + 1;
        const newTokensIn = (frontmatter.tokens_in || 0) + entry.tokens_in;
        const newTokensOut = (frontmatter.tokens_out || 0) + entry.tokens_out;

        // Recalculate average turns
        const existingEntries = parseMetricsTable(body);
        const totalTurns = existingEntries.reduce((sum, e) => sum + (e.turns || 0), 0) + entry.turns;
        const newAvgTurns = newAgentsSpawned > 0 ? (totalTurns / newAgentsSpawned).toFixed(1) : 0;

        frontmatter.agents_spawned = newAgentsSpawned;
        frontmatter.tokens_in = newTokensIn;
        frontmatter.tokens_out = newTokensOut;
        frontmatter.avg_turns = parseFloat(newAvgTurns);
        frontmatter.last_updated = timestamp();

        // Append new row to body
        const newRow = formatMetricsRow(entry);
        body = body.trimEnd() + '\n' + newRow + '\n';

        // Write back
        await writeState(metricsPath, frontmatter, body);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  logged: true,
                  totals: {
                    agents_spawned: frontmatter.agents_spawned,
                    tokens_in: frontmatter.tokens_in,
                    tokens_out: frontmatter.tokens_out,
                    avg_turns: frontmatter.avg_turns,
                  },
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
