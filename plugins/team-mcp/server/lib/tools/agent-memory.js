import { join } from 'path';
import { existsSync } from 'fs';
import { readFile, writeFile, readdir } from 'fs/promises';
import { resolveAgentDir, listFiles, ensureDir } from '../state.js';
import { VALIDATION_ERROR, NOT_FOUND, INTERNAL_ERROR } from '../errors.js';

/**
 * Validate a memory filename: simple .md file, no path separators or traversal.
 *
 * @param {string} file
 * @returns {string|null} Error message, or null if valid
 */
export function validateMemoryFilename(file) {
  if (!file || typeof file !== 'string' || file.trim() === '') {
    return 'File name must be a non-empty string';
  }
  if (file.includes('/') || file.includes('\\') || file.includes('..')) {
    return 'File name must not contain path separators or ".."';
  }
  if (!file.endsWith('.md')) {
    return 'File name must end with ".md"';
  }
  return null;
}

/**
 * Truncate content to at most maxLines lines.
 *
 * @param {string} content
 * @param {number} maxLines
 * @returns {{ content: string, truncated: boolean, lines: number }}
 */
export function truncateToLines(content, maxLines) {
  const lines = content.split('\n');
  if (lines.length <= maxLines) {
    return { content, truncated: false, lines: lines.length };
  }
  return {
    content: lines.slice(0, maxLines).join('\n'),
    truncated: true,
    lines: lines.length,
  };
}

/**
 * Search for a query string (case-insensitive) in a file's content.
 *
 * @param {string} content - File content
 * @param {string} query - Search query
 * @param {string} role - Role name (included in results)
 * @param {string} file - File name (included in results)
 * @returns {Array<{ role, file, line, lineNumber }>}
 */
export function searchInContent(content, query, role, file) {
  const lower = query.toLowerCase();
  const lines = content.split('\n');
  const matches = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase().includes(lower)) {
      matches.push({ role, file, line: lines[i], lineNumber: i + 1 });
    }
  }
  return matches;
}

export function registerAgentMemoryTools(server) {
  server.tool(
    'pipeline.memory_list',
    'List memory files for a given agent role',
    {
      role: {
        type: 'string',
        description: 'Role name (e.g., planner, coder, code-reviewer, reviewer, researcher, lead)',
        required: true,
      },
    },
    async ({ role }) => {
      try {
        const { agentDir } = resolveAgentDir();
        if (!agentDir) return NOT_FOUND('No .agent/ directory found');

        const memDir = join(agentDir, 'agent-memory', role);
        if (!existsSync(memDir)) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ role, files: [], exists: false }, null, 2) }],
          };
        }

        const files = await listFiles(memDir, /\.md$/);
        return {
          content: [{ type: 'text', text: JSON.stringify({ role, files, exists: true }, null, 2) }],
        };
      } catch (error) {
        return INTERNAL_ERROR(error.message);
      }
    }
  );

  server.tool(
    'pipeline.memory_get',
    'Read an agent memory file (MEMORY.md or topic file)',
    {
      role: {
        type: 'string',
        description: 'Role name (e.g., planner, coder, code-reviewer)',
        required: true,
      },
      file: {
        type: 'string',
        description: 'Optional: specific file name (default: MEMORY.md). Example: "build-errors.md"',
        required: false,
      },
      max_lines: {
        type: 'number',
        description: 'Optional: maximum number of lines to return (default: 200 for MEMORY.md, unlimited for topic files)',
        required: false,
      },
    },
    async ({ role, file, max_lines }) => {
      try {
        const { agentDir } = resolveAgentDir();
        if (!agentDir) return NOT_FOUND('No .agent/ directory found');

        const fileName = file || 'MEMORY.md';
        const err = validateMemoryFilename(fileName);
        if (err) return VALIDATION_ERROR(err);

        const filePath = join(agentDir, 'agent-memory', role, fileName);
        if (!existsSync(filePath)) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ role, file: fileName, content: null, exists: false }, null, 2),
            }],
          };
        }

        const rawContent = await readFile(filePath, 'utf-8');
        const limit = max_lines !== undefined
          ? max_lines
          : (fileName === 'MEMORY.md' ? 200 : undefined);

        let content, truncated, lines;
        if (limit !== undefined) {
          ({ content, truncated, lines } = truncateToLines(rawContent, limit));
        } else {
          lines = rawContent.split('\n').length;
          content = rawContent;
          truncated = false;
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ role, file: fileName, content, exists: true, lines, truncated }, null, 2),
          }],
        };
      } catch (error) {
        return INTERNAL_ERROR(error.message);
      }
    }
  );

  server.tool(
    'pipeline.memory_set',
    'Write content to an agent memory file',
    {
      role: {
        type: 'string',
        description: 'Role name',
        required: true,
      },
      file: {
        type: 'string',
        description: 'File name to write (e.g., "MEMORY.md", "build-errors.md")',
        required: true,
      },
      content: {
        type: 'string',
        description: 'Full content to write to the file',
        required: true,
      },
    },
    async ({ role, file, content }) => {
      try {
        const { agentDir } = resolveAgentDir();
        if (!agentDir) return NOT_FOUND('No .agent/ directory found');

        const err = validateMemoryFilename(file);
        if (err) return VALIDATION_ERROR(err);

        const memDir = join(agentDir, 'agent-memory', role);
        await ensureDir(memDir);

        const filePath = join(memDir, file);
        await writeFile(filePath, content, 'utf-8');
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ role, file, written: true, bytes: Buffer.byteLength(content, 'utf-8') }, null, 2),
          }],
        };
      } catch (error) {
        return INTERNAL_ERROR(error.message);
      }
    }
  );

  server.tool(
    'pipeline.memory_search',
    'Search across all or specific role memories for a query string (case-insensitive)',
    {
      query: {
        type: 'string',
        description: 'Search query (case-insensitive substring match)',
        required: true,
      },
      role: {
        type: 'string',
        description: 'Optional: limit search to a specific role. If omitted, searches all roles.',
        required: false,
      },
    },
    async ({ query, role }) => {
      try {
        const { agentDir } = resolveAgentDir();
        if (!agentDir) return NOT_FOUND('No .agent/ directory found');

        const memBaseDir = join(agentDir, 'agent-memory');
        let roles = [];
        if (role) {
          roles = [role];
        } else if (existsSync(memBaseDir)) {
          roles = await readdir(memBaseDir);
        }

        const matches = [];
        for (const r of roles) {
          const roleDir = join(memBaseDir, r);
          if (!existsSync(roleDir)) continue;
          const files = await listFiles(roleDir, /\.md$/);
          for (const f of files) {
            const content = await readFile(join(roleDir, f), 'utf-8');
            matches.push(...searchInContent(content, query, r, f));
          }
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ query, matches, total_matches: matches.length, roles_searched: roles.length }, null, 2),
          }],
        };
      } catch (error) {
        return INTERNAL_ERROR(error.message);
      }
    }
  );
}
