---
name: start-dev
description: Enable dev mode for the capture-plan plugin. Symlinks the plugin cache to the local repo so edits take effect immediately without releasing.
---

# Start Dev Mode

Symlink the installed plugin cache to the local repository so that hook changes take effect immediately.

## Procedure

### 1. Get the current version

Read `package.json` in the repo root to get the `version` field. Store it as `{VERSION}`.

### 2. Check current state

```bash
ls -la ~/.claude/plugins/cache/kriswill/capture-plan/{VERSION}
```

If it is already a symlink, tell the user dev mode is already active and stop.

### 3. Back up the cached copy

```bash
mv ~/.claude/plugins/cache/kriswill/capture-plan/{VERSION} \
   ~/.claude/plugins/cache/kriswill/capture-plan/{VERSION}.bak
```

### 4. Create the symlink

The repo root is the directory containing this skill file. Use the absolute path to the repo root.

```bash
ln -s /Users/k/src/github/kriswill/capture-plan \
      ~/.claude/plugins/cache/kriswill/capture-plan/{VERSION}
```

### 5. Confirm

```bash
ls -la ~/.claude/plugins/cache/kriswill/capture-plan/
```

Print: "Dev mode enabled — plugin hooks now run from the local repo. Changes take effect on the next hook invocation."
