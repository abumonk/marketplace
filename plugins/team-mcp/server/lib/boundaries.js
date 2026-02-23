/**
 * Boundary validation for file operations.
 *
 * Validates that a resolved file path is within the allowed project root,
 * within any configured working_folders, and (when a task_id is given) within
 * the packages declared by that task.
 *
 * The .agent/ directory is always permitted regardless of working_folders
 * configuration so that pipeline state files are never blocked.
 *
 * If working_folders is absent or empty, all paths within the project root
 * are allowed (backward-compatible with projects that have no folder config).
 */

import { resolve, join, sep } from 'path';

/**
 * Normalise a resolved absolute path to use the OS separator and ensure it
 * ends with the separator so that prefix-matching cannot mistake
 * /foo/bar for a parent of /foo/barbaz.
 *
 * @param {string} absPath
 * @returns {string}
 */
function normalise(absPath) {
  // resolve() already uses the platform separator; just ensure trailing sep.
  return absPath.endsWith(sep) ? absPath : absPath + sep;
}

/**
 * Check whether `absPath` is inside `absDir`.
 *
 * Both must be absolute paths already resolved via path.resolve().
 *
 * @param {string} absPath  - The file path being tested
 * @param {string} absDir   - The directory boundary
 * @returns {boolean}
 */
function isInside(absPath, absDir) {
  const normPath = normalise(absPath);
  const normDir = normalise(absDir);
  return normPath.startsWith(normDir);
}

/**
 * Validate whether `filePath` is accessible given the provided config and
 * optional task metadata.
 *
 * @param {string}  filePath    - The path to validate (may be relative or absolute)
 * @param {string|null} taskId  - Optional task ID for package-scoped access
 * @param {object}  config      - Parsed config frontmatter (from .agent/config.md)
 * @param {string}  projectRoot - Absolute path to the project root directory
 * @param {Function} [readTaskFn] - Optional async function(taskId) => frontmatter object;
 *                                  used to load task packages when taskId is provided.
 *                                  Defaults to a no-op that returns {}.
 * @returns {Promise<{ allowed: boolean, reason?: string }>}
 */
export async function validatePath(filePath, taskId, config, projectRoot, readTaskFn) {
  // 1. Resolve the file path relative to the project root.
  const resolved = resolve(projectRoot, filePath);

  // 2. Must stay within project root.
  if (!isInside(resolved, projectRoot)) {
    return { allowed: false, reason: 'path is outside project root' };
  }

  // 3. .agent/ is always allowed.
  const agentDir = join(projectRoot, '.agent');
  if (isInside(resolved, agentDir)) {
    return { allowed: true };
  }

  // 4. Check working_folders (if configured).
  const workingFolders = config.working_folders;
  const hasWorkingFolders = Array.isArray(workingFolders) && workingFolders.length > 0;

  if (hasWorkingFolders) {
    // Each working folder entry is expected to have at minimum a `path` field.
    // Allow the entry to be a plain string as a convenience.
    const inFolder = workingFolders.some((wf) => {
      const wfPath = typeof wf === 'string' ? wf : wf.path;
      if (!wfPath) return false;
      return isInside(resolved, resolve(projectRoot, wfPath));
    });

    if (!inFolder) {
      return { allowed: false, reason: 'path is outside configured working_folders' };
    }

    // 5. Check task packages (only meaningful when working_folders is configured).
    if (taskId && typeof readTaskFn === 'function') {
      let taskFrontmatter;
      try {
        taskFrontmatter = await readTaskFn(taskId);
      } catch (_) {
        // If the task cannot be read, skip package narrowing.
        taskFrontmatter = {};
      }

      const packages = taskFrontmatter.packages;
      if (Array.isArray(packages) && packages.length > 0) {
        const inPackage = packages.some((pkg) => {
          const wf = workingFolders.find((f) => {
            const name = typeof f === 'string' ? f : f.name;
            return name === pkg;
          });
          if (!wf) return false;
          const wfPath = typeof wf === 'string' ? wf : wf.path;
          if (!wfPath) return false;
          return isInside(resolved, resolve(projectRoot, wfPath));
        });

        if (!inPackage) {
          return { allowed: false, reason: 'path is outside task packages' };
        }
      }
    }
  }

  return { allowed: true };
}
