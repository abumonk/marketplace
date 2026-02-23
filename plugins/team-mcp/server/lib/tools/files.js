/**
 * File operation MCP tools with boundary-enforced access.
 *
 * Tools:
 *   pipeline.file_read   - Read a file's content (text or base64 for binary)
 *   pipeline.file_write  - Write content to a file
 *   pipeline.file_search - Search for files matching a pattern within allowed boundaries
 *
 * All tools accept an optional task_id parameter.  When provided, the task's
 * `packages` field is used to further narrow the allowed directories beyond
 * the project-wide working_folders configuration.
 */

import { join, resolve, dirname, basename } from 'path';
import { readFile, writeFile, readdir, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { resolveAgentDir, readState, ensureDir } from '../state.js';
import { validatePath } from '../boundaries.js';
import { VALIDATION_ERROR, NOT_FOUND, INTERNAL_ERROR } from '../errors.js';

// Binary file extensions that should be returned as base64.
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg',
  '.pdf', '.zip', '.tar', '.gz', '.bz2',
  '.exe', '.dll', '.so', '.dylib',
  '.wasm',
]);

/**
 * Determine if a filename looks like a binary file.
 * @param {string} filePath
 * @returns {boolean}
 */
function isBinary(filePath) {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

/**
 * Build the readTaskFn closure used by validatePath.
 * Reads task frontmatter from .agent/tasks/<taskId>.md.
 *
 * @param {string} agentDir
 * @returns {Function}
 */
function makeReadTaskFn(agentDir) {
  return async (taskId) => {
    const taskPath = join(agentDir, 'tasks', `${taskId}.md`);
    const { frontmatter } = await readState(taskPath);
    return frontmatter;
  };
}

/**
 * Resolve project root and config, or throw with a useful message.
 *
 * @returns {{ agentDir: string, projectRoot: string, config: object }}
 */
async function resolveContext() {
  const { agentDir, projectRoot } = resolveAgentDir();
  if (!agentDir) {
    throw new Error('Could not find .agent/ directory');
  }

  const configPath = join(agentDir, 'config.md');
  let config = {};
  try {
    const { frontmatter } = await readState(configPath);
    config = frontmatter;
  } catch (_) {
    // No config file -- treat as empty (unrestricted access within root).
  }

  return { agentDir, projectRoot, config };
}

/**
 * Recursively collect all file paths within a directory.
 *
 * @param {string} dir
 * @param {string[]} [accumulator]
 * @returns {Promise<string[]>}
 */
async function walkDir(dir, accumulator = []) {
  let entries;
  try {
    entries = await readdir(dir);
  } catch (_) {
    return accumulator;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    try {
      const s = await stat(full);
      if (s.isDirectory()) {
        await walkDir(full, accumulator);
      } else {
        accumulator.push(full);
      }
    } catch (_) {
      // Skip unreadable entries.
    }
  }
  return accumulator;
}

/**
 * Convert a glob-style pattern (only * and ? wildcards) to a RegExp.
 * This handles simple filename/path patterns; it is not a full glob engine.
 *
 * @param {string} pattern
 * @returns {RegExp}
 */
function globToRegex(pattern) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape regex special chars
    .replace(/\*/g, '.*')                   // * -> .*
    .replace(/\?/g, '.');                   // ? -> .
  return new RegExp(escaped, 'i');
}

/**
 * Register all file operation tools on the MCP server.
 *
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 */
export function registerFileTools(server) {
  // pipeline.file_read
  server.tool(
    'pipeline.file_read',
    'Read a file within the project working folders. Returns text content or base64 for binary files.',
    {
      path: {
        type: 'string',
        description: 'File path to read (relative to project root or absolute)',
      },
      task_id: {
        type: 'string',
        description: 'Optional task ID to apply task-scoped package restrictions',
      },
    },
    async ({ path: filePath, task_id }) => {
      try {
        if (!filePath) {
          return VALIDATION_ERROR('path is required');
        }

        const { agentDir, projectRoot, config } = await resolveContext();
        const readTaskFn = makeReadTaskFn(agentDir);

        const check = await validatePath(filePath, task_id || null, config, projectRoot, readTaskFn);
        if (!check.allowed) {
          return VALIDATION_ERROR(`Access denied: ${check.reason}`);
        }

        const absPath = resolve(projectRoot, filePath);

        if (!existsSync(absPath)) {
          return NOT_FOUND(`File not found: ${filePath}`);
        }

        const binary = isBinary(absPath);
        const fileContent = await readFile(absPath, binary ? null : 'utf-8');

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                path: filePath,
                encoding: binary ? 'base64' : 'utf-8',
                content: binary ? fileContent.toString('base64') : fileContent,
              }),
            },
          ],
        };
      } catch (error) {
        return INTERNAL_ERROR(error.message);
      }
    }
  );

  // pipeline.file_write
  server.tool(
    'pipeline.file_write',
    'Write content to a file within the project working folders. Creates parent directories as needed.',
    {
      path: {
        type: 'string',
        description: 'File path to write (relative to project root or absolute)',
      },
      content: {
        type: 'string',
        description: 'Content to write to the file',
      },
      task_id: {
        type: 'string',
        description: 'Optional task ID to apply task-scoped package restrictions',
      },
    },
    async ({ path: filePath, content, task_id }) => {
      try {
        if (!filePath) {
          return VALIDATION_ERROR('path is required');
        }
        if (content === undefined || content === null) {
          return VALIDATION_ERROR('content is required');
        }

        const { agentDir, projectRoot, config } = await resolveContext();
        const readTaskFn = makeReadTaskFn(agentDir);

        const check = await validatePath(filePath, task_id || null, config, projectRoot, readTaskFn);
        if (!check.allowed) {
          return VALIDATION_ERROR(`Access denied: ${check.reason}`);
        }

        const absPath = resolve(projectRoot, filePath);

        // Ensure parent directory exists.
        await ensureDir(dirname(absPath));

        await writeFile(absPath, content, 'utf-8');

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                written: true,
                path: filePath,
              }),
            },
          ],
        };
      } catch (error) {
        return INTERNAL_ERROR(error.message);
      }
    }
  );

  // pipeline.file_search
  server.tool(
    'pipeline.file_search',
    'Search for files matching a pattern within allowed boundaries. Returns matching file paths with optional content previews.',
    {
      pattern: {
        type: 'string',
        description: 'Filename pattern to search for. Supports * (any chars) and ? (single char) wildcards.',
      },
      path: {
        type: 'string',
        description: 'Directory to search within (relative to project root or absolute). Defaults to project root.',
      },
      task_id: {
        type: 'string',
        description: 'Optional task ID to apply task-scoped package restrictions',
      },
    },
    async ({ pattern, path: searchPath, task_id }) => {
      try {
        if (!pattern) {
          return VALIDATION_ERROR('pattern is required');
        }

        const { agentDir, projectRoot, config } = await resolveContext();
        const readTaskFn = makeReadTaskFn(agentDir);

        // Determine the directory to search.
        const baseDir = searchPath || '.';

        const check = await validatePath(baseDir, task_id || null, config, projectRoot, readTaskFn);
        if (!check.allowed) {
          return VALIDATION_ERROR(`Access denied: ${check.reason}`);
        }

        const absBase = resolve(projectRoot, baseDir);

        if (!existsSync(absBase)) {
          return NOT_FOUND(`Directory not found: ${baseDir}`);
        }

        // Collect all files under absBase.
        const allFiles = await walkDir(absBase);

        // Build pattern regex.
        const regex = globToRegex(pattern);

        // Filter to files whose basename matches the pattern.
        const matches = [];
        for (const filePath of allFiles) {
          if (regex.test(basename(filePath)) || regex.test(filePath)) {
            // Validate each match against boundaries (guards against symlinks that
            // escape the project root).
            const matchCheck = await validatePath(
              filePath,
              task_id || null,
              config,
              projectRoot,
              readTaskFn
            );
            if (!matchCheck.allowed) continue;

            // Provide a short content preview for text files.
            let preview = null;
            if (!isBinary(filePath)) {
              try {
                const raw = await readFile(filePath, 'utf-8');
                preview = raw.slice(0, 200);
              } catch (_) {
                // Preview unavailable.
              }
            }

            matches.push({
              path: filePath,
              preview,
            });
          }
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ matches }),
            },
          ],
        };
      } catch (error) {
        return INTERNAL_ERROR(error.message);
      }
    }
  );
}
