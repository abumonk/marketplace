/**
 * Unit tests for lib/tools/agent-memory.js
 *
 * Tests the exported helper functions: validateMemoryFilename, truncateToLines, searchInContent
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateMemoryFilename, truncateToLines, searchInContent } from '../lib/tools/agent-memory.js';

// ---------------------------------------------------------------------------
// validateMemoryFilename
// ---------------------------------------------------------------------------

test('validateMemoryFilename: rejects paths with ".."', () => {
  const err = validateMemoryFilename('../../../etc/passwd');
  assert.ok(err !== null);
  assert.ok(err.includes('..'));
});

test('validateMemoryFilename: rejects paths with forward slash', () => {
  const err = validateMemoryFilename('subdir/file.md');
  assert.ok(err !== null);
});

test('validateMemoryFilename: rejects paths with backslash', () => {
  const err = validateMemoryFilename('subdir\\file.md');
  assert.ok(err !== null);
});

test('validateMemoryFilename: rejects files not ending in .md', () => {
  const err = validateMemoryFilename('MEMORY.txt');
  assert.ok(err !== null);
  assert.ok(err.includes('.md'));
});

test('validateMemoryFilename: accepts valid MEMORY.md', () => {
  assert.equal(validateMemoryFilename('MEMORY.md'), null);
});

test('validateMemoryFilename: accepts valid topic file', () => {
  assert.equal(validateMemoryFilename('build-errors.md'), null);
  assert.equal(validateMemoryFilename('test-failures.md'), null);
});

test('validateMemoryFilename: rejects empty string', () => {
  const err = validateMemoryFilename('');
  assert.ok(err !== null);
});

// ---------------------------------------------------------------------------
// truncateToLines
// ---------------------------------------------------------------------------

test('truncateToLines: returns full content when under limit', () => {
  const content = 'line1\nline2\nline3';
  const result = truncateToLines(content, 10);
  assert.equal(result.content, content);
  assert.equal(result.truncated, false);
  assert.equal(result.lines, 3);
});

test('truncateToLines: truncates when over limit', () => {
  const content = 'line1\nline2\nline3\nline4\nline5';
  const result = truncateToLines(content, 3);
  assert.equal(result.content, 'line1\nline2\nline3');
  assert.equal(result.truncated, true);
  assert.equal(result.lines, 5);
});

test('truncateToLines: enforces 200-line MEMORY.md limit', () => {
  const lines = Array.from({ length: 250 }, (_, i) => `line ${i + 1}`);
  const content = lines.join('\n');
  const result = truncateToLines(content, 200);
  assert.equal(result.truncated, true);
  assert.equal(result.lines, 250);
  assert.equal(result.content.split('\n').length, 200);
});

// ---------------------------------------------------------------------------
// searchInContent
// ---------------------------------------------------------------------------

test('searchInContent: finds case-insensitive matches', () => {
  const content = 'Build error in webpack\nAnother line\nwebpack timeout issue';
  const matches = searchInContent(content, 'webpack', 'coder', 'build-errors.md');
  assert.equal(matches.length, 2);
  assert.equal(matches[0].lineNumber, 1);
  assert.equal(matches[1].lineNumber, 3);
});

test('searchInContent: case-insensitive match (uppercase query)', () => {
  const content = 'WEBPACK is the build tool\nwebpack errors are common';
  const matches = searchInContent(content, 'webpack', 'coder', 'build-errors.md');
  assert.equal(matches.length, 2);
});

test('searchInContent: returns empty for no matches', () => {
  const content = 'No relevant content here\nJust random text';
  const matches = searchInContent(content, 'typescript', 'coder', 'build-errors.md');
  assert.equal(matches.length, 0);
});

test('searchInContent: includes role and file in results', () => {
  const content = 'jest timeout in ci';
  const matches = searchInContent(content, 'jest', 'coder', 'test-failures.md');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].role, 'coder');
  assert.equal(matches[0].file, 'test-failures.md');
  assert.equal(matches[0].lineNumber, 1);
});
