import { join } from 'path';
import { existsSync } from 'fs';
import { resolveAgentDir, readState, writeState } from '../state.js';
import { VALIDATION_ERROR, NOT_FOUND, INTERNAL_ERROR } from '../errors.js';

const VALID_EVENTS = [
  'PreToolUse', 'PostToolUse', 'SubagentStop',
  'StageTransition', 'TaskCompleted', 'InstructionsLoaded',
];
const VALID_ACTIONS = ['block', 'check', 'notify', 'log', 'inject', 'skip'];
const VALID_MODES = ['enforce', 'advisory', 'always'];

/**
 * Test whether a hook matches a given event and context.
 *
 * @param {object} hook - Hook rule object
 * @param {string} event - Event type string
 * @param {object} context - Event context (tool, role, stage, tags, from, to, etc.)
 * @returns {boolean}
 */
export function matchHook(hook, event, context) {
  if (hook.event !== event) return false;
  if (hook.enabled === false) return false;

  const m = hook.matcher || {};

  if (m.tools && !m.tools.includes('*')) {
    if (!context.tool || !m.tools.includes(context.tool)) return false;
  }
  if (m.roles && !m.roles.includes('*')) {
    if (!context.role || !m.roles.includes(context.role)) return false;
  }
  if (m.stages && !m.stages.includes('*')) {
    if (!context.stage || !m.stages.includes(context.stage)) return false;
  }
  if (m.tags && !m.tags.includes('*')) {
    const contextTags = Array.isArray(context.tags) ? context.tags : [];
    if (!m.tags.some((t) => contextTags.includes(t))) return false;
  }
  if (m.tasks && !m.tasks.includes('*')) {
    if (!context.task_id || !m.tasks.includes(context.task_id)) return false;
  }
  if (m.from !== undefined) {
    if (context.from !== m.from) return false;
  }
  if (m.to !== undefined) {
    if (context.to !== m.to) return false;
  }

  return true;
}

/**
 * Validate a hook rule object.
 *
 * @param {object} rule
 * @returns {string|null} Error message, or null if valid
 */
export function validateHookRule(rule) {
  if (!rule.id || typeof rule.id !== 'string' || rule.id.trim() === '') {
    return 'Hook rule must have a non-empty string id';
  }
  if (!VALID_EVENTS.includes(rule.event)) {
    return `Invalid event '${rule.event}'. Must be one of: ${VALID_EVENTS.join(', ')}`;
  }
  if (!VALID_ACTIONS.includes(rule.action)) {
    return `Invalid action '${rule.action}'. Must be one of: ${VALID_ACTIONS.join(', ')}`;
  }
  if (!VALID_MODES.includes(rule.mode)) {
    return `Invalid mode '${rule.mode}'. Must be one of: ${VALID_MODES.join(', ')}`;
  }
  return null;
}

export function registerHookTools(server) {
  server.tool(
    'pipeline.hooks_get',
    'Read hook configuration from .agent/hooks.md, optionally filtered by event type',
    {
      event: {
        type: 'string',
        description: 'Optional: filter by event type (PreToolUse, PostToolUse, SubagentStop, StageTransition, TaskCompleted, InstructionsLoaded)',
        required: false,
      },
      enabled_only: {
        type: 'boolean',
        description: 'Optional: if true, return only enabled hooks (default: false)',
        required: false,
      },
    },
    async ({ event, enabled_only }) => {
      try {
        const { agentDir } = resolveAgentDir();
        if (!agentDir) return NOT_FOUND('No .agent/ directory found');

        const hooksPath = join(agentDir, 'hooks.md');
        if (!existsSync(hooksPath)) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ version: null, hooks_by_event: {}, total_hooks: 0, enabled_count: 0 }, null, 2),
            }],
          };
        }

        const { frontmatter } = await readState(hooksPath);
        let hooks = Array.isArray(frontmatter.hooks) ? frontmatter.hooks : [];

        if (event) hooks = hooks.filter((h) => h.event === event);
        if (enabled_only) hooks = hooks.filter((h) => h.enabled !== false);

        const hooks_by_event = {};
        for (const h of hooks) {
          if (!hooks_by_event[h.event]) hooks_by_event[h.event] = [];
          hooks_by_event[h.event].push(h);
        }

        const result = {
          version: frontmatter.version || null,
          hooks_by_event,
          total_hooks: hooks.length,
          enabled_count: hooks.filter((h) => h.enabled !== false).length,
        };
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return INTERNAL_ERROR(error.message);
      }
    }
  );

  server.tool(
    'pipeline.hooks_set',
    'Write or merge hook rules into .agent/hooks.md',
    {
      hooks: {
        type: 'string',
        description: 'JSON array of hook rule objects to set. Each must have: id, event, action, mode. Replaces hooks with matching id; appends hooks with new ids.',
        required: true,
      },
      replace_all: {
        type: 'boolean',
        description: 'Optional: if true, replace the entire hooks array instead of merging (default: false)',
        required: false,
      },
    },
    async ({ hooks: hooksJson, replace_all }) => {
      try {
        const { agentDir } = resolveAgentDir();
        if (!agentDir) return NOT_FOUND('No .agent/ directory found');

        let incoming;
        try {
          incoming = JSON.parse(hooksJson);
          if (!Array.isArray(incoming)) throw new Error('hooks must be a JSON array');
        } catch (e) {
          return VALIDATION_ERROR(`Invalid JSON for hooks: ${e.message}`);
        }

        for (const rule of incoming) {
          const err = validateHookRule(rule);
          if (err) return VALIDATION_ERROR(err);
        }

        const hooksPath = join(agentDir, 'hooks.md');
        let frontmatter = { version: '1.0', hooks: [] };
        let body = '';

        if (existsSync(hooksPath)) {
          const state = await readState(hooksPath);
          frontmatter = state.frontmatter;
          body = state.body;
          if (!Array.isArray(frontmatter.hooks)) frontmatter.hooks = [];
        }

        let hooks_added = 0;
        let hooks_replaced = 0;

        if (replace_all) {
          hooks_added = incoming.length;
          frontmatter.hooks = incoming;
        } else {
          for (const rule of incoming) {
            const idx = frontmatter.hooks.findIndex((h) => h.id === rule.id);
            if (idx >= 0) {
              frontmatter.hooks[idx] = rule;
              hooks_replaced++;
            } else {
              frontmatter.hooks.push(rule);
              hooks_added++;
            }
          }
        }

        await writeState(hooksPath, frontmatter, body);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ updated: true, total_hooks: frontmatter.hooks.length, hooks_added, hooks_replaced }, null, 2),
          }],
        };
      } catch (error) {
        return INTERNAL_ERROR(error.message);
      }
    }
  );

  server.tool(
    'pipeline.hooks_evaluate',
    'Evaluate hooks against a synthetic event context to test which hooks would fire',
    {
      event: {
        type: 'string',
        description: 'Event type to evaluate (PreToolUse, PostToolUse, SubagentStop, StageTransition, TaskCompleted, InstructionsLoaded)',
        required: true,
      },
      context: {
        type: 'string',
        description: 'JSON object with event context. For PreToolUse: { tool, role, stage }. For StageTransition: { from, to, tags }. For SubagentStop: { role, stage, tags }.',
        required: true,
      },
    },
    async ({ event, context: contextJson }) => {
      try {
        if (!VALID_EVENTS.includes(event)) {
          return VALIDATION_ERROR(`Invalid event '${event}'. Must be one of: ${VALID_EVENTS.join(', ')}`);
        }

        let context;
        try {
          context = JSON.parse(contextJson);
        } catch (e) {
          return VALIDATION_ERROR(`Invalid JSON for context: ${e.message}`);
        }

        const { agentDir } = resolveAgentDir();
        if (!agentDir) return NOT_FOUND('No .agent/ directory found');

        const hooksPath = join(agentDir, 'hooks.md');
        let hooks = [];
        if (existsSync(hooksPath)) {
          const { frontmatter } = await readState(hooksPath);
          hooks = Array.isArray(frontmatter.hooks) ? frontmatter.hooks : [];
        }

        const matching = hooks.filter((h) => matchHook(h, event, context));
        const blocked = matching.some((h) => h.action === 'block' && h.mode === 'enforce');
        const actions = matching.map((h) => ({
          id: h.id,
          action: h.action,
          mode: h.mode,
          description: h.description,
        }));

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ event, context, matching_hooks: matching.map((h) => h.id), blocked, actions }, null, 2),
          }],
        };
      } catch (error) {
        return INTERNAL_ERROR(error.message);
      }
    }
  );
}
