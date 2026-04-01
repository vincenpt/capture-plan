---
description: "Run end-to-end test of the capture-plan hook lifecycle against the real Obsidian vault. Cleans up test artifacts after validation."
---

# E2E Test

Run the full capture-plan pipeline end-to-end: SessionStart → capture-plan (ExitPlanMode) → capture-done (Stop) → journal validation.

Uses real Obsidian CLI and vault with synthetic payloads and transcript data.

## Procedure

### 1. Check dev mode

```bash
ls -la ~/.claude/plugins/cache/kriswill/capture-plan/
```

If the cache directory is a symlink, the test runs against local code (dev mode). If it's a regular directory, warn the user: "Note: dev mode is not active — this will test the installed (released) version, not local code. Run `/start-dev` first to test local changes."

### 2. Run the test

```bash
bun hooks/e2e-test.ts
```

### 3. Report

Relay the structured pass/fail output to the user. If any checks failed, suggest investigating:
- `/tmp/capture-plan-debug.log`
- `/tmp/capture-done-debug.log`
