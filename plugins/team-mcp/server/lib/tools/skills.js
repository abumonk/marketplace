import { join, relative, dirname, resolve } from 'path';
import { existsSync } from 'fs';
import { readFile, readdir } from 'fs/promises';
import { resolveAgentDir, readState, listFiles } from '../state.js';
import { VALIDATION_ERROR, NOT_FOUND, INTERNAL_ERROR } from '../errors.js';

const RULE_FILE_NAMES = ['RULES.md', '.rules.md', 'CLAUDE.md'];

export function registerSkillTools(server) {
  server.tool(
    'pipeline.skills_list',
    'List all installed skills from .agent/config.md, with optional source filter',
    {
      source: {
        type: 'string',
        description: 'Optional: filter by source (e.g., "project-stub", "team-pipeline"). If omitted, lists all.',
        required: false,
      },
    },
    async ({ source }) => {
      try {
        const { agentDir } = resolveAgentDir();
        if (!agentDir) return NOT_FOUND('No .agent/ directory found');

        const configPath = join(agentDir, 'config.md');
        if (!existsSync(configPath)) return NOT_FOUND('config.md not found');

        const { frontmatter } = await readState(configPath);
        let skills = Array.isArray(frontmatter.installed_skills) ? frontmatter.installed_skills : [];
        if (source) skills = skills.filter((s) => s.source === source);

        // Enrich with SKILL.md metadata for project-level skills
        const enriched = await Promise.all(
          skills.map(async (s) => {
            const skillFilePath = join(agentDir, 'skills', s.name, 'SKILL.md');
            if (existsSync(skillFilePath)) {
              try {
                const { frontmatter: sf } = await readState(skillFilePath);
                return {
                  ...s,
                  has_skill_file: true,
                  context: sf.context || 'inline',
                  agent: sf.agent || null,
                  model: sf.model || null,
                  allowed_tools: sf['allowed-tools'] || null,
                };
              } catch {
                return { ...s, has_skill_file: false };
              }
            }
            return { ...s, has_skill_file: false };
          })
        );

        const sources = [...new Set(enriched.map((s) => s.source).filter(Boolean))];
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ skills: enriched, total: enriched.length, sources }, null, 2),
          }],
        };
      } catch (error) {
        return INTERNAL_ERROR(error.message);
      }
    }
  );

  server.tool(
    'pipeline.skills_get',
    'Read a specific skill definition from .agent/skills/<name>/SKILL.md',
    {
      name: {
        type: 'string',
        description: 'Skill name to read',
        required: true,
      },
    },
    async ({ name }) => {
      try {
        const { agentDir } = resolveAgentDir();
        if (!agentDir) return NOT_FOUND('No .agent/ directory found');

        const configPath = join(agentDir, 'config.md');
        let skillRecord = null;
        if (existsSync(configPath)) {
          const { frontmatter } = await readState(configPath);
          const installed = Array.isArray(frontmatter.installed_skills) ? frontmatter.installed_skills : [];
          skillRecord = installed.find((s) => s.name === name);
        }

        if (!skillRecord) return NOT_FOUND(`Skill '${name}' not found in installed_skills`);

        const skillFilePath = join(agentDir, 'skills', name, 'SKILL.md');
        let frontmatter = null, body = null;
        if (existsSync(skillFilePath)) {
          const state = await readState(skillFilePath);
          frontmatter = state.frontmatter;
          body = state.body;
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ name, source: skillRecord.source, installed: skillRecord.installed, frontmatter, body }, null, 2),
          }],
        };
      } catch (error) {
        return INTERNAL_ERROR(error.message);
      }
    }
  );

  server.tool(
    'pipeline.rules_list',
    'List path-scoped rule files in the project (.agent/rules/ and RULES.md files in subdirectories)',
    {
      path: {
        type: 'string',
        description: 'Optional: directory path to scan for rule files. Defaults to project root.',
        required: false,
      },
    },
    async ({ path: searchPath }) => {
      try {
        const { agentDir, projectRoot } = resolveAgentDir();
        if (!agentDir) return NOT_FOUND('No .agent/ directory found');

        const scanDir = searchPath ? resolve(searchPath) : projectRoot;
        const rules = [];

        // Scan .agent/rules/ first
        const agentRulesDir = join(agentDir, 'rules');
        if (existsSync(agentRulesDir)) {
          const ruleFiles = await listFiles(agentRulesDir, /\.md$/);
          for (const f of ruleFiles) {
            const content = await readFile(join(agentRulesDir, f), 'utf-8');
            const preview = content.split('\n').slice(0, 5).join('\n');
            rules.push({ path: `.agent/rules/${f}`, type: 'agent-rule', preview });
          }
        }

        // Scan project subdirectories for convention-based rule files
        async function scanForRules(dir, depth = 0) {
          if (depth > 4) return;
          try {
            const entries = await readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
              const fullPath = join(dir, entry.name);
              if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
                await scanForRules(fullPath, depth + 1);
              } else if (entry.isFile() && RULE_FILE_NAMES.includes(entry.name)) {
                // Skip root-level files (they are global, not path-scoped)
                if (dir === projectRoot) continue;
                const content = await readFile(fullPath, 'utf-8');
                const preview = content.split('\n').slice(0, 5).join('\n');
                rules.push({
                  path: relative(projectRoot, fullPath),
                  type: entry.name,
                  preview,
                });
              }
            }
          } catch { /* skip unreadable directories */ }
        }

        await scanForRules(scanDir);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ rules, total: rules.length }, null, 2),
          }],
        };
      } catch (error) {
        return INTERNAL_ERROR(error.message);
      }
    }
  );

  server.tool(
    'pipeline.rules_match',
    'Find which rule files apply to a given set of file paths by walking up their directory trees',
    {
      files: {
        type: 'string',
        description: 'JSON array of file paths to check rules for (e.g., ["src/api/handler.ts", "packages/core/src/index.ts"])',
        required: true,
      },
    },
    async ({ files: filesJson }) => {
      try {
        let files;
        try {
          files = JSON.parse(filesJson);
          if (!Array.isArray(files)) throw new Error('files must be a JSON array');
        } catch (e) {
          return VALIDATION_ERROR(`Invalid JSON for files: ${e.message}`);
        }

        const { agentDir, projectRoot } = resolveAgentDir();
        if (!agentDir) return NOT_FOUND('No .agent/ directory found');

        // Walk up from each file's directory to find convention-based rule files
        const ruleFileSet = new Set();
        for (const file of files) {
          let dir = dirname(resolve(projectRoot, file));
          while (dir.startsWith(projectRoot) && dir !== projectRoot) {
            for (const ruleName of RULE_FILE_NAMES) {
              const candidate = join(dir, ruleName);
              if (existsSync(candidate)) ruleFileSet.add(candidate);
            }
            const parent = dirname(dir);
            if (parent === dir) break;
            dir = parent;
          }
        }

        // Check .agent/rules/ for glob-based agent rules
        const agentRulesDir = join(agentDir, 'rules');
        if (existsSync(agentRulesDir)) {
          const ruleFiles = await listFiles(agentRulesDir, /\.md$/);
          for (const f of ruleFiles) {
            const fullPath = join(agentRulesDir, f);
            const { frontmatter } = await readState(fullPath);
            const paths = Array.isArray(frontmatter.paths) ? frontmatter.paths : [];
            if (paths.length === 0) {
              // Global rule (no paths) — matches all tasks
              ruleFileSet.add(fullPath);
            } else {
              // Best-effort prefix matching: extract non-wildcard prefix segments
              for (const file of files) {
                const matched = paths.some((pattern) => {
                  const prefix = pattern.split('**')[0].split('*')[0].replace(/\/$/, '');
                  return prefix.length > 0 && file.startsWith(prefix);
                });
                if (matched) {
                  ruleFileSet.add(fullPath);
                  break;
                }
              }
            }
          }
        }

        const matching_rules = [];
        for (const ruleFile of ruleFileSet) {
          const content = await readFile(ruleFile, 'utf-8');
          const relPath = ruleFile.startsWith(projectRoot)
            ? relative(projectRoot, ruleFile)
            : ruleFile;
          matching_rules.push({ rule_file: relPath, applies_to: files, content });
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ files_checked: files.length, matching_rules }, null, 2),
          }],
        };
      } catch (error) {
        return INTERNAL_ERROR(error.message);
      }
    }
  );
}
