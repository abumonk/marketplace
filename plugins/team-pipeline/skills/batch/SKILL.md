---
name: batch
description: Bulk operation skill — accepts a file pattern and operation description, decomposes into per-file units, executes sequentially
context: fork
agent: coder
model: sonnet
allowed-tools: [Read, Glob, Grep, Write, Edit]
disable-model-invocation: true
argument-hint: "<file_pattern> <operation_description>"
---

# Batch

Apply a consistent operation to all files matching a glob pattern. Executes sequentially with per-file success/failure reporting.

**Important**: Commit your working tree before running /batch. The skill modifies files in place without undo — uncommitted changes should be stashed or committed first.

## Steps

### 1. Parse Arguments

`$ARGUMENTS` contains two parts separated by a space:
- **File pattern**: a glob pattern (e.g., `src/**/*.ts`, `packages/*/src/index.ts`)
- **Operation description**: what to do to each file (e.g., "add JSDoc comments to all exported functions", "convert default exports to named exports")

If arguments are missing or ambiguous, ask the user:
1. "What file pattern should I target? (e.g., `src/**/*.ts`)"
2. "What operation should I perform on each file?"

### 2. Discover Matching Files

Use Glob to find all files matching the pattern. Display the file list:

```
Batch target: {pattern}
Operation: {description}
Matched: {n} files

Files:
  1. {path}
  2. {path}
  ...
```

- If 0 files match: report the error and STOP.
- If more than 30 files match: warn "More than 30 files matched. Consider narrowing the pattern. Proceed with first 30? [yes/narrow]"

### 3. Validate Operation Safety

Read the first 3 files to understand the current state. Determine:
- Is the operation **mechanical** (find-replace, add boilerplate) or **semantic** (requires understanding context)?
- Are there files that should be excluded (generated files, vendored code, `*.min.js`, `*.d.ts`)?

Display analysis and ask for confirmation:
```
Operation analysis:
  Type: mechanical / semantic
  Risk: low / medium / high

{If any files should be excluded:}
  Recommend excluding: {list}

Proceed? [yes / adjust / cancel]
```

### 4. Generate Operation Template

Based on the first 3 file samples, create a specific instruction template for the operation. Show the template and a preview on the first file:

```
Operation template:
  For each file:
  1. {specific step 1}
  2. {specific step 2}
  3. {verify: check the result}

Preview on {first_file}:
  {planned change summary}

Apply this template to all {n} files? [yes / adjust / preview-more]
```

### 5. Execute Sequentially

For each file in the list:
1. Read the file
2. Apply the operation template
3. Write/Edit the file
4. Log: `  [{n}/{total}] {path} — {change summary or 'skipped: {reason}' or 'error: {message}'}`

If an error occurs on a file, log it and continue with the next file. Do not abort the entire batch.

### 6. Summary Report

After all files are processed, output:

```
---BATCH-START---
# Batch Report
Generated: {timestamp}

## Summary
| Field | Value |
|-------|-------|
| Pattern | {pattern} |
| Operation | {description} |
| Total files | {n} |
| Succeeded | {n} |
| Skipped | {n} |
| Failed | {n} |

## Changes
| # | File | Status | Change |
|---|------|--------|--------|
| 1 | {path} | ok | {summary} |
| 2 | {path} | skipped | {reason} |
| 3 | {path} | error | {error message} |

## Failed Files
{Details of errors, if any. Each with the error message and suggested manual fix.}
---BATCH-END---
```

### 7. Verification

Ask: "Run build/test to verify changes? [yes/no]"

If yes, read `build_command` and `test_command` from `.agent/config.md` and run them. Report results. If they fail, list the failed files and suggest reverting with `git checkout {file}`.
