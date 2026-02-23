import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { resolveAgentDir } from '../state.js';

const VALID_SECTIONS = ['patterns', 'issues', 'decisions'];

/**
 * Validate section name.
 */
function validateSection(section) {
  if (!VALID_SECTIONS.includes(section)) {
    throw new Error(`Invalid section "${section}". Must be one of: ${VALID_SECTIONS.join(', ')}`);
  }
}

/**
 * Get the file path for a knowledge section.
 */
function getKnowledgePath(section) {
  const { agentDir } = resolveAgentDir();
  if (!agentDir) {
    throw new Error('No .agent/ directory found in project hierarchy');
  }
  return join(agentDir, 'knowledge', `${section}.md`);
}

/**
 * Read a knowledge file. Returns empty string if file doesn't exist.
 */
async function readKnowledgeFile(filePath) {
  if (!existsSync(filePath)) {
    return '';
  }
  return await readFile(filePath, 'utf-8');
}

/**
 * Register knowledge base tools.
 */
export function registerKnowledgeTools(server) {
  // pipeline.knowledge_get
  server.tool(
    'pipeline.knowledge_get',
    'Read a knowledge base section (patterns, issues, or decisions)',
    {
      section: {
        type: 'string',
        description: 'Section to read: patterns, issues, or decisions',
        required: true,
      },
    },
    async ({ section }) => {
      try {
        validateSection(section);
        const filePath = getKnowledgePath(section);
        const content = await readKnowledgeFile(filePath);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                section,
                content,
              }, null, 2),
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

  // pipeline.knowledge_add
  server.tool(
    'pipeline.knowledge_add',
    'Add an entry to a knowledge base section with deduplication',
    {
      section: {
        type: 'string',
        description: 'Section to add to: patterns, issues, or decisions',
        required: true,
      },
      name: {
        type: 'string',
        description: 'Name of the entry',
        required: true,
      },
      description: {
        type: 'string',
        description: 'Description of the entry',
        required: true,
      },
      source: {
        type: 'string',
        description: 'Source reference (e.g., TASK-003)',
        required: false,
      },
    },
    async ({ section, name, description, source }) => {
      try {
        validateSection(section);
        const filePath = getKnowledgePath(section);
        let content = await readKnowledgeFile(filePath);

        // Check for duplicate entry (case-insensitive name match)
        const nameLower = name.toLowerCase();
        const lines = content.split('\n');
        const existingEntry = lines.find((line) => {
          const match = line.match(/^-\s+\*\*(.+?)\*\*/);
          if (match) {
            return match[1].toLowerCase() === nameLower;
          }
          return false;
        });

        if (existingEntry) {
          const existingName = existingEntry.match(/^-\s+\*\*(.+?)\*\*/)[1];
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  added: false,
                  reason: 'duplicate',
                  existing_name: existingName,
                }, null, 2),
              },
            ],
          };
        }

        // Build the new entry
        const sourceText = source ? ` (from ${source})` : '';
        const newEntry = `- **${name}**: ${description}${sourceText}`;

        // Find insertion point: after the last bullet entry or at the end
        let insertIndex = -1;
        for (let i = lines.length - 1; i >= 0; i--) {
          if (lines[i].trim().startsWith('- **')) {
            insertIndex = i + 1;
            break;
          }
        }

        // If no entries found, append at the end
        if (insertIndex === -1) {
          // Append after content, ensuring proper spacing
          if (content.trim() === '') {
            content = newEntry + '\n';
          } else {
            content = content.trimEnd() + '\n\n' + newEntry + '\n';
          }
        } else {
          // Insert after last entry
          lines.splice(insertIndex, 0, newEntry);
          content = lines.join('\n');
        }

        // Write back to file
        await writeFile(filePath, content, 'utf-8');

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                added: true,
                section,
                name,
              }, null, 2),
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

  // pipeline.knowledge_search
  server.tool(
    'pipeline.knowledge_search',
    'Search knowledge base sections for matching text',
    {
      query: {
        type: 'string',
        description: 'Search query (case-insensitive substring match)',
        required: true,
      },
      section: {
        type: 'string',
        description: 'Optional: limit search to one section (patterns, issues, or decisions)',
        required: false,
      },
    },
    async ({ query, section }) => {
      try {
        const sectionsToSearch = section
          ? [section]
          : VALID_SECTIONS;

        // Validate section if specified
        if (section) {
          validateSection(section);
        }

        const matches = [];
        const queryLower = query.toLowerCase();

        for (const sectionName of sectionsToSearch) {
          const filePath = getKnowledgePath(sectionName);
          const content = await readKnowledgeFile(filePath);

          if (!content) continue;

          const lines = content.split('\n');
          lines.forEach((line, index) => {
            if (line.toLowerCase().includes(queryLower)) {
              matches.push({
                section: sectionName,
                line: line.trim(),
                lineNumber: index + 1,
              });
            }
          });
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                query,
                matches,
              }, null, 2),
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
