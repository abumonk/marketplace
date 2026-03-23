---
allowed-tools: Bash(git status:*), Bash(git add:*), Bash(git diff:*), Bash(git log:*), Bash(git branch:*), Bash(git commit:*), Bash(git push:*), Bash(mkdir:*), Bash(date:*), Bash(cat:*), Write
description: Wrap up session — stage all, commit, push, and write a session summary to docs/sessions/
---

## Context

- Working directory: !`pwd`
- Current branch: !`git branch --show-current`
- Git status (all changes): !`git status`
- Full diff of all changes: !`git diff HEAD`
- Recent commits (for style reference): !`git log --oneline -5`
- Today's date: !`date +%Y-%m-%d`

## Your task

Complete the following steps **in a single message** using parallel tool calls where possible.

### 1. Stage all changes

Run `git add -A` to stage everything shown above.

### 2. Commit

Write a concise commit message in conventional commit format (e.g. `feat:`, `fix:`, `chore:`, `docs:`), derived from the diff above. Commit with:

```
git commit -m "$(cat <<'EOF'
<your message here>

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

### 3. Push

Push to origin: `git push` (or `git push origin <branch>` if needed).

### 4. Write session summary

Create `docs/sessions/` if it does not exist (`mkdir -p docs/sessions`).

Write (or append) a session summary to `docs/sessions/<YYYY-MM-DD>.md` using today's actual date. Use the Write tool. If the file already exists, read it first and append a new `---` separated entry.

The summary must include:
- **Date/time**: today's date
- **Branch**: current branch name
- **Commit**: the commit message you used
- **Changes**: 3–8 bullet points summarizing what changed (derived from the diff — be specific, not generic)

### Important

Do all steps in a single message. Do not ask for confirmation. Do not output explanatory text — only tool calls.
