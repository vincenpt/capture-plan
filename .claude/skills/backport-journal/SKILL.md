---
name: backport-journal
description: Backport existing plans into the Obsidian daily journal. Use when plans exist in the vault but are missing journal entries.
---

# Backport Journal

Retroactively create daily journal entries for plans that exist in the Obsidian vault but have no corresponding journal entries.

## Procedure

### 1. Discover plans

Run the discovery script from the plugin root directory to list all plans:

```bash
bun hooks/backport-journal.ts --list
```

Parse the JSON output. Each entry has: `planDir`, `title`, `date`, `hasJournalEntry`. Count how many plans exist total and how many already have journal entries.

Tell the user: "Found N plans, M already have journal entries, K are missing entries."

If no plans are missing entries, inform the user and stop.

### 2. Ask selection mode

Use `AskUserQuestion` with these options:

- **All plans** — Backport all plans missing journal entries
- **Date range** — Specify start and end dates
- **Specific plans** — Pick individual plans from the list

### 3. Gather selection details

**If "Date range"**: Ask the user for start date and end date (YYYY-MM-DD format).

**If "Specific plans"**: Display a numbered list of plans missing journal entries (format: `N. [YYYY-MM-DD] Title`). Ask the user which numbers they want (comma-separated). Map their selections back to `planDir` values.

### 4. Ask summarization preference

Use `AskUserQuestion` with these options:

- **AI summaries (Claude Haiku)** — Richer, more descriptive summaries (uses API calls)
- **Fast text extraction** — Quick summaries from plan content, no API calls

### 5. Dry run

Execute the script with `--dry-run` and the appropriate filters:

```bash
# All plans
bun hooks/backport-journal.ts --all --dry-run [--skip-summarize]

# Date range
bun hooks/backport-journal.ts --all --from=YYYY-MM-DD --to=YYYY-MM-DD --dry-run [--skip-summarize]

# Specific plans
bun hooks/backport-journal.ts --plans=dir1,dir2,dir3 --dry-run [--skip-summarize]
```

Add `--skip-summarize` if the user chose fast text extraction.

Parse the JSON result and display a summary: "Will create N journal entries, M will be skipped (already exist), E errors."

If there are errors, show them to the user.

### 6. Confirm

Use `AskUserQuestion` to confirm:

- **Proceed** — Create the journal entries
- **Cancel** — Abort without changes

### 7. Execute

Run the same command without `--dry-run`:

```bash
bun hooks/backport-journal.ts --all [--skip-summarize]
```

Parse the JSON result and display the final report: "Created N journal entries. M skipped. E errors."

If there were errors, list them for the user.
