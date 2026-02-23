/**
 * Unit tests for lib/boundaries.js
 *
 * Covers TC-022 through TC-026:
 *   TC-022: Block paths outside project root
 *   TC-023: Block paths outside working folders
 *   TC-024: .agent/ always allowed
 *   TC-025: Task packages restriction
 *   TC-026: Empty working_folders unrestricted
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, join, sep } from 'path';
import { validatePath } from '../lib/boundaries.js';

// Use a stable fake project root for all tests. The boundaries module
// uses path.resolve() internally, so we just need a string that looks like
// an absolute path on this platform.
const PROJECT_ROOT = resolve('/tmp/fake-project');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a config object with the given working_folders array.
 * @param {Array|undefined} workingFolders
 */
function makeConfig(workingFolders) {
  if (workingFolders === undefined) {
    return {};
  }
  return { working_folders: workingFolders };
}

/**
 * Build a readTaskFn that returns fake task frontmatter.
 * @param {{ packages?: string[] }} taskFrontmatter
 */
function makeReadTaskFn(taskFrontmatter) {
  return async () => taskFrontmatter;
}

// ---------------------------------------------------------------------------
// TC-022: Block paths outside project root
// ---------------------------------------------------------------------------

test('TC-022: path inside project root is allowed (no working_folders)', async () => {
  const filePath = join(PROJECT_ROOT, 'src', 'index.js');
  const result = await validatePath(filePath, null, makeConfig([]), PROJECT_ROOT);
  // empty working_folders means unrestricted within root -- allowed
  assert.equal(result.allowed, true);
});

test('TC-022: path outside project root is blocked', async () => {
  const filePath = resolve('/tmp/outside-project/secret.txt');
  const result = await validatePath(filePath, null, makeConfig([]), PROJECT_ROOT);
  assert.equal(result.allowed, false);
  assert.ok(result.reason.includes('project root'));
});

test('TC-022: path traversal attempt is blocked', async () => {
  // Use a relative path that would escape the root
  const filePath = '../../etc/passwd';
  const result = await validatePath(filePath, null, makeConfig([]), PROJECT_ROOT);
  assert.equal(result.allowed, false);
  assert.ok(result.reason.includes('project root'));
});

test('TC-022: path that starts with project root string but is outside it is blocked', async () => {
  // e.g. /tmp/fake-projectextra should not be treated as inside /tmp/fake-project
  const outsidePath = PROJECT_ROOT + 'extra';
  const result = await validatePath(outsidePath, null, makeConfig([]), PROJECT_ROOT);
  assert.equal(result.allowed, false);
  assert.ok(result.reason.includes('project root'));
});

// ---------------------------------------------------------------------------
// TC-023: Block paths outside working folders
// ---------------------------------------------------------------------------

test('TC-023: path inside working folder is allowed', async () => {
  const workingFolders = [{ name: 'src', path: 'src' }];
  const filePath = join(PROJECT_ROOT, 'src', 'index.js');
  const result = await validatePath(filePath, null, makeConfig(workingFolders), PROJECT_ROOT);
  assert.equal(result.allowed, true);
});

test('TC-023: path outside configured working folders is blocked', async () => {
  const workingFolders = [{ name: 'src', path: 'src' }];
  const filePath = join(PROJECT_ROOT, 'docs', 'readme.md');
  const result = await validatePath(filePath, null, makeConfig(workingFolders), PROJECT_ROOT);
  assert.equal(result.allowed, false);
  assert.ok(result.reason.includes('working_folders'));
});

test('TC-023: multiple working folders, path in second folder is allowed', async () => {
  const workingFolders = [
    { name: 'src', path: 'src' },
    { name: 'docs', path: 'docs' },
  ];
  const filePath = join(PROJECT_ROOT, 'docs', 'guide.md');
  const result = await validatePath(filePath, null, makeConfig(workingFolders), PROJECT_ROOT);
  assert.equal(result.allowed, true);
});

test('TC-023: plain string working folder entries are supported', async () => {
  const workingFolders = ['src', 'tests'];
  const filePath = join(PROJECT_ROOT, 'tests', 'unit.js');
  const result = await validatePath(filePath, null, makeConfig(workingFolders), PROJECT_ROOT);
  assert.equal(result.allowed, true);
});

// ---------------------------------------------------------------------------
// TC-024: .agent/ always allowed regardless of working_folders
// ---------------------------------------------------------------------------

test('TC-024: .agent/ path allowed even when working_folders is configured', async () => {
  const workingFolders = [{ name: 'src', path: 'src' }];
  // .agent/ is not in working_folders, but should still be allowed
  const filePath = join(PROJECT_ROOT, '.agent', 'tasks', 'TASK-001.md');
  const result = await validatePath(filePath, null, makeConfig(workingFolders), PROJECT_ROOT);
  assert.equal(result.allowed, true);
});

test('TC-024: .agent/ path allowed when working_folders is empty', async () => {
  const filePath = join(PROJECT_ROOT, '.agent', 'config.md');
  const result = await validatePath(filePath, null, makeConfig([]), PROJECT_ROOT);
  assert.equal(result.allowed, true);
});

test('TC-024: .agent/ path allowed when no working_folders key in config', async () => {
  const filePath = join(PROJECT_ROOT, '.agent', 'lead-state.md');
  const result = await validatePath(filePath, null, makeConfig(undefined), PROJECT_ROOT);
  assert.equal(result.allowed, true);
});

test('TC-024: deep .agent/ sub-path is allowed', async () => {
  const workingFolders = [{ name: 'src', path: 'src' }];
  const filePath = join(PROJECT_ROOT, '.agent', 'knowledge', 'patterns.md');
  const result = await validatePath(filePath, null, makeConfig(workingFolders), PROJECT_ROOT);
  assert.equal(result.allowed, true);
});

// ---------------------------------------------------------------------------
// TC-025: Task packages restriction
// ---------------------------------------------------------------------------

test('TC-025: task with packages restricts to declared package folders', async () => {
  const workingFolders = [
    { name: 'frontend', path: 'src/frontend' },
    { name: 'backend', path: 'src/backend' },
  ];
  // Task only declares 'frontend' package
  const readTaskFn = makeReadTaskFn({ packages: ['frontend'] });
  const taskId = 'TASK-001';

  // Path in 'frontend' -- allowed
  const allowedPath = join(PROJECT_ROOT, 'src', 'frontend', 'app.js');
  const r1 = await validatePath(allowedPath, taskId, makeConfig(workingFolders), PROJECT_ROOT, readTaskFn);
  assert.equal(r1.allowed, true);

  // Path in 'backend' -- blocked because task doesn't declare it
  const blockedPath = join(PROJECT_ROOT, 'src', 'backend', 'server.js');
  const r2 = await validatePath(blockedPath, taskId, makeConfig(workingFolders), PROJECT_ROOT, readTaskFn);
  assert.equal(r2.allowed, false);
  assert.ok(r2.reason.includes('packages'));
});

test('TC-025: task with empty packages allows all working folders', async () => {
  const workingFolders = [
    { name: 'frontend', path: 'src/frontend' },
    { name: 'backend', path: 'src/backend' },
  ];
  // Task declares no packages -- no further restriction
  const readTaskFn = makeReadTaskFn({ packages: [] });
  const taskId = 'TASK-001';

  const filePath = join(PROJECT_ROOT, 'src', 'backend', 'server.js');
  const result = await validatePath(filePath, taskId, makeConfig(workingFolders), PROJECT_ROOT, readTaskFn);
  assert.equal(result.allowed, true);
});

test('TC-025: no taskId means no package restriction applied', async () => {
  const workingFolders = [
    { name: 'frontend', path: 'src/frontend' },
    { name: 'backend', path: 'src/backend' },
  ];

  const filePath = join(PROJECT_ROOT, 'src', 'backend', 'server.js');
  // No taskId passed -- no package check
  const result = await validatePath(filePath, null, makeConfig(workingFolders), PROJECT_ROOT);
  assert.equal(result.allowed, true);
});

test('TC-025: package restriction does not apply without working_folders', async () => {
  // No working_folders configured -- packages check is skipped
  const readTaskFn = makeReadTaskFn({ packages: ['frontend'] });
  const filePath = join(PROJECT_ROOT, 'src', 'backend', 'server.js');
  const result = await validatePath(filePath, 'TASK-001', makeConfig([]), PROJECT_ROOT, readTaskFn);
  // Empty working_folders means unrestricted -- path is within project root
  assert.equal(result.allowed, true);
});

// ---------------------------------------------------------------------------
// TC-026: Empty working_folders allows unrestricted access within project root
// ---------------------------------------------------------------------------

test('TC-026: empty working_folders array allows any path within project root', async () => {
  const paths = [
    join(PROJECT_ROOT, 'src', 'index.js'),
    join(PROJECT_ROOT, 'docs', 'guide.md'),
    join(PROJECT_ROOT, 'tests', 'unit.test.js'),
    join(PROJECT_ROOT, 'package.json'),
  ];
  for (const filePath of paths) {
    const result = await validatePath(filePath, null, makeConfig([]), PROJECT_ROOT);
    assert.equal(result.allowed, true, `${filePath} should be allowed with empty working_folders`);
  }
});

test('TC-026: missing working_folders key allows any path within project root', async () => {
  const filePath = join(PROJECT_ROOT, 'anywhere', 'file.txt');
  const result = await validatePath(filePath, null, makeConfig(undefined), PROJECT_ROOT);
  assert.equal(result.allowed, true);
});

test('TC-026: non-array working_folders treated as not configured', async () => {
  // working_folders: null should behave like not configured
  const config = { working_folders: null };
  const filePath = join(PROJECT_ROOT, 'anywhere', 'file.txt');
  const result = await validatePath(filePath, null, config, PROJECT_ROOT);
  assert.equal(result.allowed, true);
});
