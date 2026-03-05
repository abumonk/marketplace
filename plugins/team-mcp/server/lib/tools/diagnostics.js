import { join } from 'path';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { resolveAgentDir, readState, listFiles } from '../state.js';
import { VALIDATION_ERROR, NOT_FOUND, INTERNAL_ERROR } from '../errors.js';

/**
 * Check whether an agent is stale (running beyond the threshold).
 *
 * @param {object} agent - Agent record with status and started_at
 * @param {number} thresholdMs - Stale threshold in milliseconds (default 30 min)
 * @returns {boolean}
 */
export function isStaleAgent(agent, thresholdMs = 30 * 60 * 1000) {
  if (agent.status !== 'running') return false;
  const startedAt = agent.started_at ? new Date(agent.started_at).getTime() : 0;
  return Date.now() - startedAt > thresholdMs;
}

/**
 * Compute overall health status from individual check results.
 *
 * @param {object} checks - Map of check name -> { status: 'ok'|'warn'|'critical' }
 * @returns {'HEALTHY'|'WARNINGS'|'CRITICAL'}
 */
export function computeHealthStatus(checks) {
  const statuses = Object.values(checks).map((c) => c.status);
  if (statuses.includes('critical')) return 'CRITICAL';
  if (statuses.includes('warn')) return 'WARNINGS';
  return 'HEALTHY';
}

/**
 * Calculate variance percentage: (actual - estimated) / estimated * 100.
 *
 * @param {number} estimated
 * @param {number} actual
 * @returns {number|null} Rounded variance percentage, or null if estimated is zero/falsy
 */
export function calculateVariance(estimated, actual) {
  if (!estimated || estimated === 0) return null;
  return Math.round(((actual - estimated) / estimated) * 100);
}

/**
 * Parse an estimated duration string to minutes.
 * Supports "20min", "1h", "2h", etc.
 *
 * @param {string|null} dur
 * @returns {number|null}
 */
export function parseDurationToMin(dur) {
  if (!dur) return null;
  const minMatch = dur.match(/(\d+)\s*min/);
  const hourMatch = dur.match(/(\d+)\s*h/);
  if (minMatch) return parseInt(minMatch[1], 10);
  if (hourMatch) return parseInt(hourMatch[1], 10) * 60;
  return null;
}

export function registerDiagnosticsTools(server) {
  server.tool(
    'pipeline.health',
    'Comprehensive pipeline health check: stale agents, stuck tasks, broken dependencies, config issues, metrics anomalies',
    {
      include_details: {
        type: 'boolean',
        description: 'Optional: include detailed issue descriptions (default: true)',
        required: false,
      },
    },
    async ({ include_details = true }) => {
      try {
        const { agentDir } = resolveAgentDir();
        if (!agentDir) return NOT_FOUND('No .agent/ directory found');

        const checks = {};
        const issues = [];

        // 1. Stale agents
        const leadStatePath = join(agentDir, 'lead-state.md');
        if (existsSync(leadStatePath)) {
          const { frontmatter } = await readState(leadStatePath);
          const agents = Array.isArray(frontmatter.agents) ? frontmatter.agents
            : Array.isArray(frontmatter.active_agents) ? frontmatter.active_agents : [];
          const staleWarn = agents.filter((a) => isStaleAgent(a, 30 * 60 * 1000));
          const staleCrit = agents.filter((a) => isStaleAgent(a, 2 * 60 * 60 * 1000));
          checks.stale_agents = {
            status: staleCrit.length > 0 ? 'critical' : staleWarn.length > 0 ? 'warn' : 'ok',
            details: include_details ? staleWarn.map((a) => `Agent ${a.id || a.role} running since ${a.started_at}`) : [],
          };
          if (staleCrit.length > 0) {
            issues.push({ severity: 'critical', category: 'agents', description: `${staleCrit.length} agent(s) stale > 2h` });
          } else if (staleWarn.length > 0) {
            issues.push({ severity: 'warning', category: 'agents', description: `${staleWarn.length} agent(s) stale > 30min` });
          }
        } else {
          checks.stale_agents = { status: 'ok', details: [] };
        }

        // 2. Stuck/stale tasks
        const tasksDir = join(agentDir, 'tasks');
        const taskFiles = await listFiles(tasksDir, /^TASK-.*\.md$/);
        const taskMap = {};

        const configPath = join(agentDir, 'config.md');
        let maxIterations = 3;
        if (existsSync(configPath)) {
          const { frontmatter: cfg } = await readState(configPath);
          if (cfg.max_iterations) maxIterations = cfg.max_iterations;
        }

        const stuckTasks = [];
        const staleTasks = [];
        const blockedTasks = [];

        for (const f of taskFiles) {
          const { frontmatter: tf } = await readState(join(tasksDir, f));
          taskMap[tf.id || f.replace('.md', '')] = tf;

          if (tf.status === 'in_progress') {
            const updated = tf.updated ? new Date(tf.updated).getTime() : 0;
            if (updated > 0 && Date.now() - updated > 60 * 60 * 1000) {
              staleTasks.push(tf.id);
            }
          }
          if (tf.stage === 'fixing' && tf.iterations >= maxIterations) {
            stuckTasks.push(tf.id);
          }
          if (tf.status === 'BLOCKED') {
            blockedTasks.push(tf.id);
          }
        }

        checks.stuck_tasks = {
          status: stuckTasks.length > 0 ? 'critical' : staleTasks.length > 0 ? 'warn' : 'ok',
          details: include_details ? [
            ...stuckTasks.map((id) => `${id}: stuck in fixing loop`),
            ...staleTasks.map((id) => `${id}: in_progress > 60min`),
            ...blockedTasks.map((id) => `${id}: BLOCKED`),
          ] : [],
        };
        if (stuckTasks.length > 0) {
          issues.push({ severity: 'critical', category: 'tasks', description: `${stuckTasks.length} task(s) stuck in fix loop`, ids: stuckTasks });
        }
        if (staleTasks.length > 0) {
          issues.push({ severity: 'warning', category: 'tasks', description: `${staleTasks.length} task(s) stale in_progress`, ids: staleTasks });
        }

        // 3. Broken dependencies
        const brokenDeps = [];
        for (const [taskId, tf] of Object.entries(taskMap)) {
          const deps = Array.isArray(tf.depends_on) ? tf.depends_on
            : (tf.depends_on ? [tf.depends_on] : []);
          for (const dep of deps) {
            if (!taskMap[dep]) {
              brokenDeps.push(`${taskId} depends on missing ${dep}`);
            }
          }
        }
        checks.broken_deps = {
          status: brokenDeps.length > 0 ? 'warn' : 'ok',
          details: include_details ? brokenDeps : [],
        };
        if (brokenDeps.length > 0) {
          issues.push({ severity: 'warning', category: 'dependencies', description: `${brokenDeps.length} broken dependency reference(s)` });
        }

        // 4. Config validation
        const configIssues = [];
        if (existsSync(configPath)) {
          const { frontmatter: cfg } = await readState(configPath);
          if (!cfg.build_command || cfg.build_command.trim() === '') configIssues.push('build_command is not set');
          if (!cfg.test_command || cfg.test_command.trim() === '') configIssues.push('test_command is not set');
          if (!cfg.stage_assignments) {
            configIssues.push('stage_assignments is not configured');
          } else {
            for (const s of ['planning', 'implementing', 'reviewing', 'fixing']) {
              if (!cfg.stage_assignments[s]) configIssues.push(`stage_assignments.${s} is missing`);
            }
          }
          if (!cfg.active_roles || cfg.active_roles.length === 0) configIssues.push('active_roles is empty');
        } else {
          configIssues.push('config.md not found');
        }
        checks.config_validation = {
          status: configIssues.length > 0 ? 'warn' : 'ok',
          details: include_details ? configIssues : [],
        };
        if (configIssues.length > 0) {
          issues.push({ severity: 'warning', category: 'config', description: `${configIssues.length} config issue(s)` });
        }

        // 5. Metrics anomalies
        const metricsPath = join(agentDir, 'metrics.md');
        const metricsIssues = [];
        if (existsSync(metricsPath)) {
          const { frontmatter: mf } = await readState(metricsPath);
          if (mf.totals && mf.totals.agents_spawned > 0) {
            const avgTokens = (mf.totals.tokens_in + mf.totals.tokens_out) / mf.totals.agents_spawned;
            if (avgTokens > 80000) {
              metricsIssues.push(`High avg token usage: ${Math.round(avgTokens).toLocaleString()} tokens/agent`);
            }
          }
        }
        checks.metrics_anomalies = {
          status: metricsIssues.length > 0 ? 'warn' : 'ok',
          details: include_details ? metricsIssues : [],
        };
        if (metricsIssues.length > 0) {
          issues.push({ severity: 'warning', category: 'metrics', description: 'Metrics anomalies detected' });
        }

        const status = computeHealthStatus(checks);
        const summary = {
          total_issues: issues.length,
          critical: issues.filter((i) => i.severity === 'critical').length,
          warnings: issues.filter((i) => i.severity === 'warning').length,
          info: issues.filter((i) => i.severity === 'info').length,
        };

        return { content: [{ type: 'text', text: JSON.stringify({ status, checks, issues, summary }, null, 2) }] };
      } catch (error) {
        return INTERNAL_ERROR(error.message);
      }
    }
  );

  server.tool(
    'pipeline.debug_task',
    'Full artifact dump for a specific task: task file, design, reports, dependencies, agent status, diagnosis',
    {
      task_id: {
        type: 'string',
        description: 'Task ID to debug (e.g., TASK-042)',
        required: true,
      },
    },
    async ({ task_id }) => {
      try {
        if (!task_id || !task_id.match(/^TASK-\d+$/)) {
          return VALIDATION_ERROR('task_id must be in format TASK-NNN');
        }

        const { agentDir } = resolveAgentDir();
        if (!agentDir) return NOT_FOUND('No .agent/ directory found');

        const taskPath = join(agentDir, 'tasks', `${task_id}.md`);
        if (!existsSync(taskPath)) return NOT_FOUND(`Task ${task_id} not found`);

        const { frontmatter, body } = await readState(taskPath);

        // Design document
        const designPath = join(agentDir, 'designs', `${task_id}-design.md`);
        const design = existsSync(designPath)
          ? { exists: true, content: await readFile(designPath, 'utf-8') }
          : { exists: false, content: null };

        // Report files
        const reportsDir = join(agentDir, 'reports');
        const reports = [];
        if (existsSync(reportsDir)) {
          const reportFiles = await listFiles(reportsDir, new RegExp(`^${task_id}-`));
          for (const f of reportFiles) {
            reports.push({ file: f, content: await readFile(join(reportsDir, f), 'utf-8') });
          }
        }

        // Dependencies
        const deps = Array.isArray(frontmatter.depends_on) ? frontmatter.depends_on
          : (frontmatter.depends_on ? [frontmatter.depends_on] : []);
        const dependencies = [];
        for (const dep of deps) {
          const depPath = join(agentDir, 'tasks', `${dep}.md`);
          if (existsSync(depPath)) {
            const { frontmatter: df } = await readState(depPath);
            dependencies.push({ id: dep, stage: df.stage, status: df.status });
          } else {
            dependencies.push({ id: dep, stage: null, status: 'NOT_FOUND' });
          }
        }

        // Agent status from lead-state
        let agent_status = { assigned: false, agent_id: null, status: null };
        const leadStatePath = join(agentDir, 'lead-state.md');
        if (existsSync(leadStatePath)) {
          const { frontmatter: ls } = await readState(leadStatePath);
          const agents = Array.isArray(ls.agents) ? ls.agents
            : Array.isArray(ls.active_agents) ? ls.active_agents : [];
          const entry = agents.find((a) => a.task_id === task_id || a.task === task_id);
          if (entry) {
            agent_status = { assigned: true, agent_id: entry.id, status: entry.status };
          }
        }

        // Diagnosis
        const diagParts = [];
        const configPath = join(agentDir, 'config.md');
        let maxIter = 3;
        if (existsSync(configPath)) {
          const { frontmatter: cfg } = await readState(configPath);
          if (cfg.max_iterations) maxIter = cfg.max_iterations;
        }
        if (frontmatter.stage === 'fixing' && frontmatter.iterations >= maxIter) {
          diagParts.push('Stuck in fix loop (max iterations reached)');
        }
        if (frontmatter.status === 'BLOCKED') diagParts.push('Task is BLOCKED');
        if (!design.exists) diagParts.push('No design document found');
        const unmetDeps = dependencies.filter((d) => d.status !== 'completed' && d.status !== 'done');
        if (unmetDeps.length > 0) {
          diagParts.push(`Unmet dependencies: ${unmetDeps.map((d) => d.id).join(', ')}`);
        }
        const diagnosis = diagParts.length > 0 ? diagParts.join('. ') : 'No issues detected.';

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ task_id, frontmatter, body, design, reports, dependencies, agent_status, diagnosis }, null, 2),
          }],
        };
      } catch (error) {
        return INTERNAL_ERROR(error.message);
      }
    }
  );

  server.tool(
    'pipeline.estimation_report',
    'Compare estimated vs actual duration and token usage across tasks',
    {
      adventure_id: {
        type: 'string',
        description: 'Optional: filter by adventure ID (e.g., ADV-009). If omitted, reports on all tasks with estimates.',
        required: false,
      },
    },
    async ({ adventure_id }) => {
      try {
        const { agentDir } = resolveAgentDir();
        if (!agentDir) return NOT_FOUND('No .agent/ directory found');

        const tasksDir = join(agentDir, 'tasks');
        const taskFiles = await listFiles(tasksDir, /^TASK-.*\.md$/);

        // Parse metrics log table rows
        const metricsRows = {};
        const metricsPath = join(agentDir, 'metrics.md');
        if (existsSync(metricsPath)) {
          const metricsContent = await readFile(metricsPath, 'utf-8');
          for (const line of metricsContent.split('\n')) {
            if (!line.startsWith('|') || line.includes('---') || line.includes('timestamp')) continue;
            const cols = line.split('|').map((c) => c.trim()).filter(Boolean);
            if (cols.length >= 9) {
              const [, task, , , , , tokens_in, tokens_out, duration_min] = cols;
              if (!metricsRows[task]) metricsRows[task] = [];
              metricsRows[task].push({
                tokens_in: parseInt(tokens_in, 10) || 0,
                tokens_out: parseInt(tokens_out, 10) || 0,
                duration_min: parseFloat(duration_min) || 0,
              });
            }
          }
        }

        const tasks = [];
        let totalEstDuration = 0, totalActDuration = 0;
        let totalEstTokens = 0, totalActTokens = 0;
        const tagVariances = {};

        for (const f of taskFiles) {
          const { frontmatter: tf } = await readState(join(tasksDir, f));
          if (adventure_id && tf.adventure_id !== adventure_id) continue;

          const eval_ = tf.evaluation || {};
          const estDurStr = eval_.estimated_duration;
          const estTokens = eval_.estimated_tokens;
          if (!estDurStr && !estTokens) continue;

          const estDurMin = parseDurationToMin(estDurStr);
          const rows = metricsRows[tf.id] || [];
          const actTokens = rows.reduce((s, r) => s + r.tokens_in + r.tokens_out, 0);
          const actDurMin = rows.reduce((s, r) => s + r.duration_min, 0);
          const durVariance = estDurMin && actDurMin ? calculateVariance(estDurMin, actDurMin) : null;
          const tokenVariance = estTokens && actTokens ? calculateVariance(estTokens, actTokens) : null;

          tasks.push({
            id: tf.id,
            title: tf.title,
            estimated_duration: estDurStr || null,
            actual_duration_min: actDurMin || null,
            duration_variance_pct: durVariance,
            estimated_tokens: estTokens || null,
            actual_tokens: actTokens || null,
            token_variance_pct: tokenVariance,
          });

          if (estDurMin) totalEstDuration += estDurMin;
          if (actDurMin) totalActDuration += actDurMin;
          if (estTokens) totalEstTokens += estTokens;
          if (actTokens) totalActTokens += actTokens;

          for (const tag of (Array.isArray(tf.tags) ? tf.tags : [])) {
            if (!tagVariances[tag]) tagVariances[tag] = { total: 0, count: 0 };
            if (tokenVariance !== null) {
              tagVariances[tag].total += tokenVariance;
              tagVariances[tag].count++;
            }
          }
        }

        const overallDurVariance = totalEstDuration ? calculateVariance(totalEstDuration, totalActDuration) : null;
        const overallTokenVariance = totalEstTokens ? calculateVariance(totalEstTokens, totalActTokens) : null;
        const suggestedMultiplier = totalEstDuration && totalActDuration
          ? Math.round((totalActDuration / totalEstDuration) * 10) / 10
          : null;

        const patterns = Object.entries(tagVariances)
          .filter(([, v]) => v.count >= 2)
          .map(([tag, v]) => ({ tag, avg_variance_pct: Math.round(v.total / v.count), task_count: v.count }))
          .sort((a, b) => Math.abs(b.avg_variance_pct) - Math.abs(a.avg_variance_pct));

        const aggregate = {
          total_estimated_duration_min: totalEstDuration || null,
          total_actual_duration_min: totalActDuration || null,
          overall_duration_variance_pct: overallDurVariance,
          total_estimated_tokens: totalEstTokens || null,
          total_actual_tokens: totalActTokens || null,
          overall_token_variance_pct: overallTokenVariance,
          suggested_duration_multiplier: suggestedMultiplier,
        };

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ adventure_id: adventure_id || null, tasks, aggregate, patterns }, null, 2),
          }],
        };
      } catch (error) {
        return INTERNAL_ERROR(error.message);
      }
    }
  );
}
