import { join } from 'path';
import { resolveAgentDir, readState, writeState, deepMerge } from '../state.js';

/**
 * Get a nested value from an object using dot notation.
 * E.g., get({a: {b: {c: 1}}}, 'a.b.c') => 1
 */
function getNestedValue(obj, key) {
  const keys = key.split('.');
  let value = obj;
  for (const k of keys) {
    if (value === null || value === undefined || typeof value !== 'object') {
      return undefined;
    }
    value = value[k];
  }
  return value;
}

/**
 * Set a nested value in an object using dot notation.
 * E.g., setNestedValue({}, 'a.b.c', 1) => {a: {b: {c: 1}}}
 * Returns the modified object.
 */
function setNestedValue(obj, key, value) {
  const keys = key.split('.');
  const lastKey = keys.pop();
  let target = obj;

  for (const k of keys) {
    if (target[k] === undefined || target[k] === null || typeof target[k] !== 'object') {
      target[k] = {};
    }
    target = target[k];
  }

  target[lastKey] = value;
  return obj;
}

/**
 * Register config tools.
 */
export function registerConfigTools(server) {
  // pipeline.config_get
  server.tool(
    'pipeline.config_get',
    'Read config fields from .agent/config.md frontmatter',
    {
      key: {
        type: 'string',
        description: 'Optional: specific config key to get (dot notation, e.g., "git.mode"). If omitted, returns full config.',
        required: false,
      },
    },
    async ({ key }) => {
      try {
        const { agentDir } = resolveAgentDir();
        if (!agentDir) {
          throw new Error('No .agent/ directory found in project hierarchy');
        }

        const configPath = join(agentDir, 'config.md');
        const { frontmatter } = await readState(configPath);

        if (key) {
          const value = getNestedValue(frontmatter, key);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    key,
                    value,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } else {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    config: frontmatter,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }
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

  // pipeline.config_set
  server.tool(
    'pipeline.config_set',
    'Update a config field in .agent/config.md frontmatter with deep merge',
    {
      key: {
        type: 'string',
        description: 'Config key to set (dot notation, e.g., "git.mode")',
        required: true,
      },
      value: {
        type: 'string',
        description: 'New value for the config key (any JSON-serializable value)',
        required: true,
      },
    },
    async ({ key, value }) => {
      try {
        const { agentDir } = resolveAgentDir();
        if (!agentDir) {
          throw new Error('No .agent/ directory found in project hierarchy');
        }

        const configPath = join(agentDir, 'config.md');
        const { frontmatter, body } = await readState(configPath);

        // Get old value
        const old_value = getNestedValue(frontmatter, key);

        // Parse value if it's a JSON string
        let newValue = value;
        try {
          newValue = JSON.parse(value);
        } catch (e) {
          // If not valid JSON, use as string
        }

        // Create nested update object
        const update = {};
        setNestedValue(update, key, newValue);

        // Deep merge the update
        const updatedFrontmatter = deepMerge(frontmatter, update);

        // Write back
        await writeState(configPath, updatedFrontmatter, body);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  key,
                  old_value,
                  new_value: newValue,
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
