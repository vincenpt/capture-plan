---
name: rewrite-journal
description: Rewrite the Obsidian daily journal for a selected day from existing plan/summary notes. Use when journal entries are missing, corrupted, or need regeneration.
---

# Rewrite Journal

Reconstruct the daily journal for a selected day by reading all plan, summary, and activity notes in the vault for that date. The existing journal file is backed up before rewriting.

## Procedure

### 1. Discover available days

Run the discovery script from the plugin root directory:

```bash
bun ${CLAUDE_PLUGIN_ROOT}/hooks/rewrite-journal.ts --list-days 2>/dev/null
```

Parse the JSON output. Each entry has: `date`, `dayName`, `planCount`, `hasJournal`, `hasBackup`.

Tell the user: "Found N days with plans in the vault."

If no days found, inform the user and stop.

### 2. Ask which day to rewrite

List the available days, formatted as:

```
YYYY-MM-DD (DayName) — N plans [journal exists | no journal] [backup exists]
```

Use `AskUserQuestion` to let the user pick a day. Default to today if today is in the list.

If the selected day already has a backup file, warn the user that the existing backup will be overwritten.

### 3. Ask summarization preference

Use `AskUserQuestion` with these options:

- **AI summaries (Claude Haiku)** — Richer, more descriptive summaries (uses API calls)
- **Fast text extraction** — Quick summaries from note content, no API calls

### 4. Dry run

Run the script in dry-run mode:

```bash
bun ${CLAUDE_PLUGIN_ROOT}/hooks/rewrite-journal.ts --day=YYYY-MM-DD --dry-run [--skip-summarize] 2>/dev/null
```

Add `--skip-summarize` if the user chose fast text extraction.

Parse the JSON result and show: "Will rewrite journal for YYYY-MM-DD: N plans to process. Current journal will be backed up."

If there are errors, show them to the user.

### 5. Confirm

Use `AskUserQuestion` to confirm:

- **Proceed** — Rewrite the journal
- **Cancel** — Abort without changes

### 6. Execute

Run the same command without `--dry-run`:

```bash
bun ${CLAUDE_PLUGIN_ROOT}/hooks/rewrite-journal.ts --day=YYYY-MM-DD [--skip-summarize]
```

Progress lines appear on stderr during summarization (e.g. `[3/40] Summarized: 01-my-slug (plan)`).

Parse the JSON result and display: "Rewrote journal for YYYY-MM-DD: N callouts created, M revisions written. Backup saved."

If there were errors, list them for the user.

### 7. Ask about backup cleanup

Use `AskUserQuestion` with these options:

- **Remove backup** — Delete the .bak.md backup file
- **Keep backup** — Leave backup for manual review

If the user chooses to remove:

```bash
bun ${CLAUDE_PLUGIN_ROOT}/hooks/rewrite-journal.ts --remove-backup --day=YYYY-MM-DD 2>/dev/null
```

Confirm removal to the user.
