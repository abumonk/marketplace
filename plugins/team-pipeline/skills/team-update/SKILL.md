---
name: team-update
description: "[DEPRECATED] Use /reinit instead. Redirects to the reinit skill for pipeline upgrades."
disable-model-invocation: true
---

# Team Update (Deprecated)

This skill has been replaced by `/reinit`.

## Steps

1. Tell the user:
   ```
   /team-update is deprecated. Use /reinit instead.

   The reinit skill provides schema-driven upgrades that automatically detect
   and apply all missing infrastructure (directories, files, config fields)
   without a hardcoded migration list.

   Running /reinit now...
   ```

2. Run the `reinit` skill in upgrade mode. It will handle all migration needs.
