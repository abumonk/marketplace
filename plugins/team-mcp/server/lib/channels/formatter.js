/**
 * Event-to-message formatting for messaging channels.
 *
 * Provides platform-specific formatters:
 * - formatForTelegram(event) -- returns HTML string
 * - formatForDiscord(event) -- returns Discord embed object
 *
 * Uses templates with {variable} substitution for consistency.
 */

/** Telegram HTML templates per event type */
const TELEGRAM_TEMPLATES = {
  'task.created': `<b>{task_id} Created</b>

<b>{title}</b>
Tags: {tags}
Assignee: {assignee}

<i>team-pipeline | {timestamp}</i>`,

  'task.advanced': `<b>{task_id} Advanced to {to_stage}</b>

<b>{title}</b>
Stage: <code>{from_stage}</code> → <code>{to_stage}</code>
Assignee: {assignee}
Mode: {mode}

<i>team-pipeline | {timestamp}</i>`,

  'task.completed': `✅ <b>{task_id} Completed</b>

<b>{title}</b>
Iterations: {iterations}
Duration: {duration_minutes} min
Stages: {stages_passed}

<i>team-pipeline | {timestamp}</i>`,

  'task.blocked': `⛔ <b>{task_id} Blocked</b>

<b>{title}</b>
Stage: <code>{stage}</code>
Iterations: {iterations}/{max_iterations}
Reason: {last_review_summary}

<i>team-pipeline | {timestamp}</i>`,

  'task.failed': `❌ <b>{task_id} Failed</b>

<b>{title}</b>
Stage: <code>{stage}</code>
Iteration: {iteration}
Issues: {issues_count}
Summary: {issues_summary}

<i>team-pipeline | {timestamp}</i>`,

  'task.cancelled': `🚫 <b>{task_id} Cancelled</b>

<b>{title}</b>
Previous stage: <code>{previous_stage}</code>
Reason: {reason}

<i>team-pipeline | {timestamp}</i>`,

  'agent.started': `🤖 <b>Agent Started: {role}</b>

Task: {task_id}
Stage: <code>{stage}</code>
Model: {model}
Max turns: {max_turns}

<i>team-pipeline | {timestamp}</i>`,

  'agent.completed': `✅ <b>Agent Completed: {role}</b>

Task: {task_id}
Stage: <code>{stage}</code>
Result: {result_status}
Turns used: {turns_used}

<i>team-pipeline | {timestamp}</i>`,

  'agent.error': `❌ <b>Agent Error: {role}</b>

Task: {task_id}
Stage: <code>{stage}</code>
Error: {error}

<i>team-pipeline | {timestamp}</i>`,
};

/** Discord embed colors (decimal) */
const DISCORD_COLORS = {
  green: 0x2ecc71,    // completed, passed
  red: 0xe74c3c,      // failed, error, blocked
  yellow: 0xf39c12,   // advanced, started
  blue: 0x3498db,     // created, info
};

/**
 * Apply template variable substitution.
 * Replaces {variable} with values[variable], leaves unmatched placeholders as-is.
 *
 * @param {string} template - Template string with {variable} placeholders
 * @param {object} values - Variable values
 * @returns {string}
 */
export function applyTemplate(template, values) {
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    return values[key] !== undefined ? String(values[key]) : match;
  });
}

/**
 * Format pipeline event for Telegram (HTML).
 *
 * @param {object} event - Event envelope (type, timestamp, task_id, data)
 * @returns {string} HTML string
 */
export function formatForTelegram(event) {
  const template = TELEGRAM_TEMPLATES[event.type];
  if (!template) {
    return `<b>Unknown event: ${event.type}</b>\n\n<i>team-pipeline | ${formatTimestamp(event.timestamp)}</i>`;
  }

  const variables = {
    task_id: event.task_id || 'N/A',
    timestamp: formatTimestamp(event.timestamp),
    title: event.data.title || 'Untitled',
    ...event.data,
  };

  // Convert arrays to comma-separated strings
  if (Array.isArray(variables.tags)) {
    variables.tags = variables.tags.join(', ') || 'none';
  }
  if (Array.isArray(variables.stages_passed)) {
    variables.stages_passed = variables.stages_passed.join(' → ');
  }

  return applyTemplate(template, variables);
}

/**
 * Format pipeline event for Discord (embed object).
 *
 * @param {object} event - Event envelope (type, timestamp, task_id, data)
 * @returns {object} Discord embed object
 */
export function formatForDiscord(event) {
  const colorMap = {
    'task.created': DISCORD_COLORS.blue,
    'task.advanced': DISCORD_COLORS.yellow,
    'task.completed': DISCORD_COLORS.green,
    'task.blocked': DISCORD_COLORS.red,
    'task.failed': DISCORD_COLORS.red,
    'task.cancelled': DISCORD_COLORS.red,
    'agent.started': DISCORD_COLORS.yellow,
    'agent.completed': DISCORD_COLORS.green,
    'agent.error': DISCORD_COLORS.red,
  };

  const color = colorMap[event.type] || DISCORD_COLORS.blue;
  const taskId = event.task_id || 'N/A';
  const data = event.data || {};

  let title = '';
  let description = '';

  switch (event.type) {
    case 'task.created':
      title = `${taskId} Created`;
      description = `**${data.title || 'Untitled'}**\nTags: ${Array.isArray(data.tags) ? data.tags.join(', ') : 'none'}\nAssignee: ${data.assignee || 'unassigned'}`;
      break;

    case 'task.advanced':
      title = `${taskId} Advanced to ${data.to_stage}`;
      description = `**${data.title || 'Untitled'}**\nStage: \`${data.from_stage}\` → \`${data.to_stage}\`\nAssignee: ${data.assignee || 'unassigned'}\nMode: ${data.mode || 'auto'}`;
      break;

    case 'task.completed':
      title = `✅ ${taskId} Completed`;
      description = `**${data.title || 'Untitled'}**\nIterations: ${data.iterations || 0}\nDuration: ${data.duration_minutes || 0} min\nStages: ${Array.isArray(data.stages_passed) ? data.stages_passed.join(' → ') : 'N/A'}`;
      break;

    case 'task.blocked':
      title = `⛔ ${taskId} Blocked`;
      description = `**${data.title || 'Untitled'}**\nStage: \`${data.stage}\`\nIterations: ${data.iterations}/${data.max_iterations}\nReason: ${data.last_review_summary || 'N/A'}`;
      break;

    case 'task.failed':
      title = `❌ ${taskId} Failed`;
      description = `**${data.title || 'Untitled'}**\nStage: \`${data.stage}\`\nIteration: ${data.iteration}\nIssues: ${data.issues_count || 0}\nSummary: ${data.issues_summary || 'N/A'}`;
      break;

    case 'task.cancelled':
      title = `🚫 ${taskId} Cancelled`;
      description = `**${data.title || 'Untitled'}**\nPrevious stage: \`${data.previous_stage}\`\nReason: ${data.reason || 'N/A'}`;
      break;

    case 'agent.started':
      title = `🤖 Agent Started: ${data.role}`;
      description = `Task: ${taskId}\nStage: \`${data.stage}\`\nModel: ${data.model}\nMax turns: ${data.max_turns}`;
      break;

    case 'agent.completed':
      title = `✅ Agent Completed: ${data.role}`;
      description = `Task: ${taskId}\nStage: \`${data.stage}\`\nResult: ${data.result_status}\nTurns used: ${data.turns_used}`;
      break;

    case 'agent.error':
      title = `❌ Agent Error: ${data.role}`;
      description = `Task: ${taskId}\nStage: \`${data.stage}\`\nError: ${data.error || 'Unknown error'}`;
      break;

    default:
      title = `Unknown event: ${event.type}`;
      description = `Task: ${taskId}`;
  }

  return {
    title,
    description,
    color,
    timestamp: event.timestamp,
    footer: {
      text: 'team-pipeline',
    },
  };
}

/**
 * Format ISO 8601 timestamp as "YYYY-MM-DD HH:MM".
 *
 * @param {string} isoString - ISO 8601 timestamp
 * @returns {string}
 */
function formatTimestamp(isoString) {
  const d = new Date(isoString);
  const date = d.toISOString().slice(0, 10); // YYYY-MM-DD
  const time = d.toISOString().slice(11, 16); // HH:MM
  return `${date} ${time}`;
}
