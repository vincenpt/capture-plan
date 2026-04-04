# Configurable Date Directory Schemes

## Problem

The plugin uses two different date directory structures that cannot be changed:
- Plans: `yyyy/mm-dd` (compact, numeric)
- Journal: `yyyy/mm-MonthName/dd-DayName` (human-readable)

Users should be able to choose the date directory scheme for each path independently.

## Design

### Named Schemes

Four named schemes, each defining how date segments are formatted:

| Scheme | Pattern | Example (Apr 3, 2026) |
|--------|---------|----------------------|
| `calendar` | `yyyy/mm-MonthName/dd-DayName` | `2026/04-April/03-Friday` |
| `compact` | `yyyy/mm-dd` | `2026/04-03` |
| `monthly` | `yyyy/mm-MonthName/dd` | `2026/04-April/03` |
| `flat` | `yyyy-mm-dd` | `2026-04-03` |

Default for both paths: `calendar`.

### Configuration

TOML grouped tables, configurable independently:

```toml
[plan]
path = "Claude/Plans"
date_scheme = "calendar"

[journal]
path = "Journal"
date_scheme = "calendar"
```

Backward compatible: old flat keys (`plan_path`, `journal_path`) still parsed during config loading. New `[plan]`/`[journal]` tables take precedence.

### New Types

```typescript
type DateScheme = "calendar" | "compact" | "monthly" | "flat";

interface PathConfig {
  path: string;
  date_scheme: DateScheme;
}

interface Config {
  vault?: string;
  plan: PathConfig;
  journal: PathConfig;
  context_cap?: number;
  superpowers_spec_pattern?: string;
  superpowers_plan_pattern?: string;
}
```

### Core Functions

**`formatDatePath(scheme, dateParts)`** in `dates.ts` — returns the date segment string for a given scheme. Single source of truth for date directory formatting.

**`getPlanDatePath(config, dateParts)`** in `obsidian.ts` — combines `config.plan.path` with `formatDatePath`. Replaces 5 duplicated inline constructions.

**`detectDateScheme(dateSegment)`** in `dates.ts` — regex-based detection of which scheme produced a directory path. Used by backport-journal to handle mixed-scheme vaults.

### Backport-Journal Auto-Detection

`getImportedSlugs` currently hard-codes `DATE_DIR_PATTERN = /^(\d{2})-(\d{2})$/` which only matches the `compact` scheme. Replace with a recursive directory walker that finds `NNN-slug` plan directories at any depth under year directories, regardless of intermediate date structure.

### Affected Call Sites

| File | What changes |
|------|-------------|
| `hooks/lib/dates.ts` | Add `DateScheme`, `formatDatePath`, `detectDateScheme` |
| `hooks/lib/types.ts` | Restructure `Config` with `PathConfig` |
| `hooks/lib/config.ts` | Backward-compat config loading, new defaults |
| `hooks/lib/obsidian.ts` | Add `getPlanDatePath`, update `getJournalPathForDate` |
| `hooks/lib/session-state.ts` | `scanForVaultState` uses `formatDatePath` for date segments |
| `hooks/capture-plan.ts` | Use `getPlanDatePath` |
| `hooks/capture-done.ts` (2 sites) | Use `getPlanDatePath` |
| `hooks/backport-journal.ts` | Recursive walker, `getPlanDatePath`, `config.plan.path` |
| `hooks/e2e-test.ts` | Use `getPlanDatePath`, update config references |
| `capture-plan.toml` | Grouped table format |

### Layout Migration

When a user changes their scheme, a migration system keeps the vault consistent rather than leaving mixed layouts.

**Detection** (in hooks): During `capture-plan.ts` execution, `detectVaultSchemes()` scans the vault's plan directory. If directories matching a scheme other than the configured one are found, a warning is logged suggesting the user run `/capture-plan:migrate-layout`.

**Migration script** (`hooks/migrate-layout.ts`): Standalone entry point with `--dry-run`, `--plan-only`, `--journal-only` flags.

- Scans plan tree for `NNN-slug` directories, determines each parent's scheme from directory naming patterns
- Scans journal tree for `.md` leaf files, determines scheme from path structure
- Derives actual dates from directory names to compute target paths:
  - `compact` (`yyyy/mm-dd`): parse yyyy, mm, dd → `new Date(yyyy, mm-1, dd)` → get monthName, dayName
  - `calendar` (`yyyy/mm-MonthName/dd-DayName`): parse mm, dd from numeric prefixes
  - `monthly` (`yyyy/mm-MonthName/dd`): same
  - `flat` (`yyyy-mm-dd`): parse all from single segment
- `--dry-run`: prints planned moves as a diff
- Execute mode: creates target dirs, moves entries, removes empty source dirs

**Migration skill** (`skills/migrate-layout/`): Instructs Claude to run the script with `--dry-run`, show the diff, ask the user for confirmation, then execute.

### Mixed Vault Safety

Even without migration, the plugin operates safely on mixed vaults:
- `capture-done.ts` reads `plan_dir` from the state file (absolute path), not reconstructed
- `scanForVaultState` uses the current config scheme to scan recent directories
- `getImportedSlugs` uses recursive walking, scheme-agnostic

### New Files

| File | Purpose |
|------|---------|
| `hooks/lib/migration.ts` | `detectVaultSchemes()`, `parseDateFromPath()` |
| `hooks/migrate-layout.ts` | CLI migration script |
| `skills/migrate-layout/skill.md` | Migration skill for Claude |

### Affected Call Sites

| File | What changes |
|------|-------------|
| `hooks/lib/dates.ts` | Add `DateScheme`, `formatDatePath`, `detectDateScheme` |
| `hooks/lib/types.ts` | Restructure `Config` with `PathConfig` |
| `hooks/lib/config.ts` | Backward-compat config loading, new defaults |
| `hooks/lib/obsidian.ts` | Add `getPlanDatePath`, update `getJournalPathForDate` |
| `hooks/lib/session-state.ts` | `scanForVaultState` uses `formatDatePath` for date segments |
| `hooks/capture-plan.ts` | Use `getPlanDatePath`, add scheme mismatch detection |
| `hooks/capture-done.ts` (2 sites) | Use `getPlanDatePath` |
| `hooks/backport-journal.ts` | Recursive walker, `getPlanDatePath`, `config.plan.path` |
| `hooks/e2e-test.ts` | Use `getPlanDatePath`, update config references |
| `capture-plan.toml` | Grouped table format |
