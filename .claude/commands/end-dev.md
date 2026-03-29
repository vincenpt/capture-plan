---
description: Disable dev mode for the capture-plan plugin. Removes the symlink and restores the cached release copy.
---

# End Dev Mode

Remove the dev-mode symlink and restore the installed plugin cache.

## Procedure

### 1. Get the current version

Read `package.json` in the repo root to get the `version` field. Store it as `{VERSION}`.

### 2. Check current state

```bash
ls -la ~/.claude/plugins/cache/kriswill/capture-plan/{VERSION}
```

If it is **not** a symlink, tell the user dev mode is not active and stop.

### 3. Remove the symlink

```bash
rm ~/.claude/plugins/cache/kriswill/capture-plan/{VERSION}
```

### 4. Restore the backup

```bash
mv ~/.claude/plugins/cache/kriswill/capture-plan/{VERSION}.bak \
   ~/.claude/plugins/cache/kriswill/capture-plan/{VERSION}
```

If the `.bak` directory does not exist, tell the user to reinstall: `claude plugin install capture-plan@kriswill`

### 5. Confirm

```bash
ls -la ~/.claude/plugins/cache/kriswill/capture-plan/
```

Print: "Dev mode disabled — plugin hooks now run from the cached release copy (v{VERSION})."
