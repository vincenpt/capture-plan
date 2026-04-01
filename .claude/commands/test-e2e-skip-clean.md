---
description: "Run end-to-end test without cleanup. Preserves all vault output (plan, summary, tools-stats, tools-log, test-log) for inspection in Obsidian."
---

# E2E Test (Skip Cleanup)

Run the full capture-plan pipeline end-to-end, preserving all generated vault artifacts for manual inspection in Obsidian.

## Procedure

### 1. Check dev mode

```bash
ls -la ~/.claude/plugins/cache/kriswill/capture-plan/
```

If the cache directory is a symlink, the test runs against local code (dev mode). If it's a regular directory, warn the user: "Note: dev mode is not active — this will test the installed (released) version, not local code. Run `/start-dev` first to test local changes."

### 2. Run the test

```bash
bun hooks/e2e-test.ts --skip-clean
```

### 3. Report

Relay the structured pass/fail output to the user. Tell them the vault path where test artifacts are preserved — they can browse plan.md, summary.md, tools-stats.md, tools-log.md, and test-log.md directly in Obsidian.
