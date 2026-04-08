import { readFile, writeFile, appendFile, readdir, mkdir, rename } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

/**
 * Parse a markdown file with YAML frontmatter.
 * Returns { frontmatter: object, body: string }.
 */
export function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content };
  }
  const frontmatter = parseYaml(match[1]) || {};
  const body = match[2];
  return { frontmatter, body };
}

/**
 * Serialize frontmatter + body back to markdown with YAML frontmatter.
 */
export function serializeFrontmatter(frontmatter, body) {
  const yaml = stringifyYaml(frontmatter, { lineWidth: 0 }).trimEnd();
  return `---\n${yaml}\n---\n${body}`;
}

/**
 * Read and parse a frontmatter file.
 */
export async function readState(filePath) {
  const content = await readFile(filePath, 'utf-8');
  return parseFrontmatter(content);
}

/**
 * Write a frontmatter file atomically (write full content).
 */
export async function writeState(filePath, frontmatter, body) {
  const content = serializeFrontmatter(frontmatter, body);
  await writeFile(filePath, content, 'utf-8');
}

/**
 * Deep merge source into target. Arrays are replaced, not merged.
 */
export function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] !== null &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      typeof result[key] === 'object' &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(result[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

/**
 * Resolve the .agent/ directory from the current working directory.
 * Walks up from cwd looking for .agent/.
 */
export function resolveAgentDir(startDir = process.cwd()) {
  let dir = resolve(startDir);
  while (dir !== resolve(dir, '..')) {
    const agentDir = join(dir, '.agent');
    if (existsSync(agentDir)) {
      return { agentDir, projectRoot: dir };
    }
    dir = resolve(dir, '..');
  }
  return { agentDir: null, projectRoot: null };
}

/**
 * List files matching a pattern in a directory.
 */
export async function listFiles(dir, pattern = /\.md$/) {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir);
  return entries.filter((f) => pattern.test(f));
}

/**
 * Ensure a directory exists.
 */
export async function ensureDir(dir) {
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

/**
 * Move a file from source to destination.
 */
export async function moveFile(src, dest) {
  await ensureDir(join(dest, '..'));
  await rename(src, dest);
}

/**
 * Get ISO timestamp string.
 */
export function timestamp() {
  return new Date().toISOString();
}

/**
 * Format a log entry for task files.
 */
export function logEntry(message) {
  const now = new Date();
  const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return `- [${ts}] ${message}`;
}

/**
 * Format a single adventure log line.
 * Format: [{ISO timestamp}] {agent} | "{message}"
 *
 * @param {string} agent - Agent identifier (e.g., 'lead', 'adventure-planner')
 * @param {string} message - Log message
 * @returns {string} Formatted log line with newline
 */
export function adventureLogLine(agent, message) {
  return `[${new Date().toISOString()}] ${agent} | "${message}"\n`;
}

/**
 * Append a line to an adventure's adventure.log file (append-only, never read).
 *
 * @param {string} adventureDir - Path to the adventure directory (e.g., .agent/adventures/ADV-015)
 * @param {string} agent - Agent identifier
 * @param {string} message - Log message
 */
export async function appendAdventureLog(adventureDir, agent, message) {
  const logPath = join(adventureDir, 'adventure.log');
  await appendFile(logPath, adventureLogLine(agent, message), 'utf-8');
}

/**
 * Append a metrics row to an adventure's metrics.md file.
 *
 * @param {string} adventureDir - Path to the adventure directory
 * @param {string} row - Pipe-delimited table row (without leading/trailing newline)
 */
export async function appendAdventureMetrics(adventureDir, row) {
  const metricsPath = join(adventureDir, 'metrics.md');
  await appendFile(metricsPath, row + '\n', 'utf-8');
}

/**
 * Read the agents array from lead-state.md.
 *
 * @param {string} agentDir - path to the .agent/ directory
 * @returns {Promise<Array>} agents array (empty if missing)
 */
export async function readAgents(agentDir) {
  const filePath = join(agentDir, 'lead-state.md');
  const { frontmatter } = await readState(filePath);
  return Array.isArray(frontmatter.agents) ? frontmatter.agents : [];
}

/**
 * Append a new agent record to lead-state.md and update active_count.
 *
 * @param {string} agentDir - path to the .agent/ directory
 * @param {object} agentRecord - agent record to add
 */
export async function writeAgent(agentDir, agentRecord) {
  const filePath = join(agentDir, 'lead-state.md');
  const { frontmatter, body } = await readState(filePath);
  if (!Array.isArray(frontmatter.agents)) {
    frontmatter.agents = [];
  }
  frontmatter.agents.push(agentRecord);
  frontmatter.active_count = frontmatter.agents.filter((a) => a.status === 'running').length;
  await writeState(filePath, frontmatter, body);
}

/**
 * Update an existing agent record in lead-state.md.
 *
 * @param {string} agentDir - path to the .agent/ directory
 * @param {string} agentId - id of the agent to update
 * @param {object} updates - fields to merge into the agent record
 */
export async function updateAgent(agentDir, agentId, updates) {
  const filePath = join(agentDir, 'lead-state.md');
  const { frontmatter, body } = await readState(filePath);
  if (!Array.isArray(frontmatter.agents)) {
    frontmatter.agents = [];
  }
  const idx = frontmatter.agents.findIndex((a) => a.id === agentId);
  if (idx === -1) {
    throw new Error(`Agent ${agentId} not found`);
  }
  Object.assign(frontmatter.agents[idx], updates);
  frontmatter.active_count = frontmatter.agents.filter((a) => a.status === 'running').length;
  await writeState(filePath, frontmatter, body);
}

/**
 * Mark running agents as stale if their started_at is older than timeoutMs.
 *
 * @param {string} agentDir - path to the .agent/ directory
 * @param {number} [timeoutMs=300000] - stale threshold in milliseconds (default 5 min)
 * @returns {Promise<string[]>} IDs of agents that were marked stale
 */
export async function cleanupStaleAgents(agentDir, timeoutMs = 300000) {
  const filePath = join(agentDir, 'lead-state.md');
  const { frontmatter, body } = await readState(filePath);
  if (!Array.isArray(frontmatter.agents)) {
    frontmatter.agents = [];
  }
  const now = Date.now();
  const staleIds = [];
  for (const agent of frontmatter.agents) {
    if (agent.status === 'running') {
      const startedAt = agent.started_at ? new Date(agent.started_at).getTime() : 0;
      if (now - startedAt > timeoutMs) {
        agent.status = 'stale';
        staleIds.push(agent.id);
      }
    }
  }
  frontmatter.active_count = frontmatter.agents.filter((a) => a.status === 'running').length;
  await writeState(filePath, frontmatter, body);
  return staleIds;
}

/**
 * In-memory lock manager for multi-step pipeline operations.
 *
 * Locks are keyed by a resource ID (typically a task ID).  Each lock records
 * the session that acquired it and the time it was acquired.  Locks expire
 * automatically after `ttlMs` milliseconds (default 30 s) and are cleaned up
 * lazily on the next acquire() call.
 *
 * Locks are NOT persisted -- they are lost if the server restarts, which is
 * acceptable given the short TTL and the nature of pipeline operations.
 *
 * Re-entrancy: the same session may call acquire() on a resource it already
 * holds without error; the TTL is refreshed on each successful acquire.
 */
export class LockManager {
  /**
   * @param {{ ttlMs?: number }} [options]
   */
  constructor({ ttlMs = 30_000 } = {}) {
    /** @type {Map<string, { session: string, acquired: Date }>} */
    this._locks = new Map();
    this._ttlMs = ttlMs;
  }

  /**
   * Remove all locks whose TTL has elapsed.
   */
  cleanup() {
    const now = Date.now();
    for (const [resourceId, lock] of this._locks) {
      if (now - lock.acquired.getTime() >= this._ttlMs) {
        this._locks.delete(resourceId);
      }
    }
  }

  /**
   * Try to acquire a lock on `resourceId` for `session`.
   *
   * - If no lock exists (or the existing lock has expired), the lock is granted.
   * - If the same session already holds the lock, the TTL is refreshed and the
   *   lock is granted (re-entrant).
   * - If a *different* session holds a non-expired lock, returns false.
   *
   * @param {string} resourceId
   * @param {string} session
   * @returns {{ acquired: true } | { acquired: false, holder: string, expiresIn: number }}
   */
  acquire(resourceId, session) {
    // Sweep expired locks first.
    this.cleanup();

    const existing = this._locks.get(resourceId);
    if (existing) {
      if (existing.session !== session) {
        const expiresIn = this._ttlMs - (Date.now() - existing.acquired.getTime());
        return { acquired: false, holder: existing.session, expiresIn: Math.max(0, expiresIn) };
      }
      // Same session -- re-entrant: refresh TTL.
    }

    this._locks.set(resourceId, { session, acquired: new Date() });
    return { acquired: true };
  }

  /**
   * Release the lock on `resourceId`.
   *
   * Only the session that holds the lock may release it.  Silently ignores
   * attempts to release a lock held by a different session or a non-existent
   * lock (idempotent for the owning session).
   *
   * @param {string} resourceId
   * @param {string} session
   * @returns {{ released: boolean, reason?: string }}
   */
  release(resourceId, session) {
    const existing = this._locks.get(resourceId);
    if (!existing) {
      return { released: true }; // Already gone -- treat as success.
    }
    if (existing.session !== session) {
      return { released: false, reason: `Lock held by session '${existing.session}'` };
    }
    this._locks.delete(resourceId);
    return { released: true };
  }

  /**
   * Check whether `resourceId` is currently locked by any active session.
   *
   * Expired locks are treated as not locked (but are not cleaned up here;
   * call cleanup() or acquire() to prune them).
   *
   * @param {string} resourceId
   * @returns {boolean}
   */
  isLocked(resourceId) {
    const existing = this._locks.get(resourceId);
    if (!existing) return false;
    const expired = Date.now() - existing.acquired.getTime() >= this._ttlMs;
    return !expired;
  }
}
