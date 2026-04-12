---
description: Disable dev mode for the capture-plan plugin. Removes symlinks and restores the cached release copies for both hooks and skills.
---

# End Dev Mode

Run `bun scripts/dev-mode.ts stop` and report the output.

The script removes the dev-mode symlinks and restores the original cached directories from `.bak` backups. If a backup is missing, it prints reinstall instructions.
