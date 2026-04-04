---
name: migrate-layout
description: Migrate vault date directory layout to match the configured scheme. Use when changing date_scheme in capture-plan.toml and existing vault directories use a different layout.
---

# Migrate Layout

Migrate existing vault plan directories and journal files from one date directory scheme to another.

## When to use

After changing `date_scheme` in the `[plan]` or `[journal]` section of `capture-plan.toml`. The capture-plan hook will log a warning if it detects a layout mismatch.

## Procedure

### 1. Preview changes

Run the migration script in dry-run mode from the plugin root:

```bash
bun hooks/migrate-layout.ts --dry-run
```

Show the full output to the user. This lists every directory/file that would be moved, with source and target paths.

### 2. Confirm with user

Ask the user to confirm before proceeding. Show the count of items to be moved. If no moves are needed, report that the vault is already consistent and stop.

### 3. Execute migration

Run without `--dry-run`:

```bash
bun hooks/migrate-layout.ts
```

This will:
- Create target directories as needed
- Move plan directories and journal files to the new layout
- Clean up empty source directories
- Print a summary of what was done

### Flags

- `--dry-run` — Show what would be moved without making changes
- `--plan-only` — Only migrate plan directories
- `--journal-only` — Only migrate journal files

### Troubleshooting

If the script reports "Cannot resolve vault path", the user needs to check their `capture-plan.toml` config and ensure the Obsidian CLI is installed and the vault name is correct.
