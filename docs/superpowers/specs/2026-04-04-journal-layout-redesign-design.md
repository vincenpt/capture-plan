# Journal Layout Redesign

## Context

The current daily journal format uses repeated H3 headings with 2-column tables per entry. This produces duplicate headings when the same plan is iterated on, ugly time column wrapping, cramped summary text, and no YAML frontmatter for Obsidian indexing/filtering. The redesign replaces this with callout-based entries grouped by title, rich per-revision metadata, and structured frontmatter properties.

## Design

### Journal Note Frontmatter

Each daily journal note gets YAML frontmatter properties that Obsidian indexes for search, filtering, and Dataview queries:

```yaml
---
date: 2026-04-04
day: Saturday
plans: 4
projects:
  - capture-plan
  - my-app
tags:
  - claude-session
  - date-schemes
  - config
---
```

| Property   | Type   | Description                                        |
|------------|--------|----------------------------------------------------|
| `date`     | date   | ISO date (YYYY-MM-DD). Enables Dataview date queries |
| `day`      | text   | Weekday name for quick visual scanning               |
| `plans`    | number | Count of captures (plan + summary each increment). Activity metric |
| `projects` | list   | Unique project names from all entries                |
| `tags`     | list   | Merged tags from all entries + `claude-session`      |

**Management:** On first entry of the day, create the journal note with initial frontmatter. On subsequent entries, increment `plans`, merge into `projects` and `tags` using the Obsidian CLI `property:read`/`property:set` commands. The existing `mergeTagsOnDailyNote` function is already doing this for tags — extend it to cover `plans`, `projects`, and `date`/`day`.

### Entry Format: Callout Blocks

Each entry uses the `[!plan]+` custom callout type (expanded by default, collapsible):

```markdown
> [!plan]+ Configurable Date Directory Schemes
> `capture-plan` · `plan-mode`
>
> - **2:11 PM** [[001-.../plan|plan]] `opus-4(200k)`
>   Add configurable date directory schemes so paths use different formats.
>   #date-schemes #config
> - **2:41 PM** [[002-.../plan|plan]] `opus-4(200k)`
>   Revised approach using grouped TOML tables instead of flat keys.
>   #config
> - **5:30 PM** [[002-.../summary|done]] `opus-4(200k)`
>   Implemented date schemes with 4 formats and vault migration CLI.
>   #config #migration
```

**Callout header line:** `> [!plan]+ {title}`
- `[!plan]` is a custom callout type — renders in Obsidian without CSS (pencil icon), can be styled with a CSS snippet
- `+` makes it default-expanded and collapsible
- Title is the plan title

**Metadata line:** `> \`{project}\` · \`{source}\``
- Project name in backticks (omit if project is empty — line becomes just `` `{source}` ``)
- Source type in backticks: `plan-mode`, `superpowers`, or `skill`

**Revision bullets:** Each plan or summary capture adds a bullet:
- `**{time}**` — 12-hour AM/PM format, bold
- `[[{path}|{type}]]` — wikilink to the plan or summary note, display text is `plan` or `done`
- `` `{model}({contextCap})` `` — model and context cap in backticks
- Summary text on the next line (indented under the bullet)
- Tags as `#hashtags` on the next line (indented under the bullet)

### Grouping Logic

When a new entry arrives, check if a callout with the same title already exists in the journal:

1. **Read** the journal file from the vault filesystem (using `getVaultPath` + `Bun.file`)
2. **Search** for `> [!plan]+ {title}` in the file content
3. **If found:** Insert the new revision bullet at the end of that callout block (before the blank line that terminates it)
4. **If not found:** Append a new callout block at the end of the file

This replaces the current `appendRowToJournalSection` pattern in `session-state.ts`, which does the same thing for table rows under `### {title}` headers.

**Callout boundary detection:** A callout block ends when a line does NOT start with `>` (or at EOF). The last `> - **` line is the last revision. Insert the new revision after the last line starting with `>` in that callout block.

### Blank Line Between Callouts

Callout blocks MUST be separated by a blank line (no `>` prefix) for Obsidian to parse them as separate blocks. Without this, the second callout renders as raw text (confirmed in Obsidian testing). The appended content should start with `\n\n` and each callout block should be a self-contained `>` block.

### Files to Modify

| File | Changes |
|------|---------|
| `hooks/capture-plan.ts` | Replace table-format `journalEntry` (line 193) with callout format. Add frontmatter management calls after `appendToJournal`. |
| `hooks/capture-done.ts` | Replace table-format journal entries (lines 163, 314, 710, 723-726) with callout revision format. Update `appendRowToJournalSection` call to use new callout-based equivalent. |
| `hooks/lib/session-state.ts` | Refactor `appendRowToJournalSection` → `appendRevisionToCallout`. New function finds `> [!plan]+ {title}`, inserts revision bullet at end of callout block. |
| `hooks/lib/obsidian.ts` | Add `updateJournalFrontmatter(journalPath, props, vault)` to manage `date`, `day`, `plans`, `projects` properties. Extend `mergeTagsOnDailyNote` or fold it into the new function. |
| `hooks/backport-journal.ts` | Update journal entry format (line 337) from table to callout. |

### New Functions

**`formatJournalRevision(time, planPath, linkText, model, contextCap, summary, tags): string`**
Returns a single revision bullet string:
```
> - **2:11 PM** [[path|plan]] `opus-4(200k)`
>   Summary text here.
>   #tag1 #tag2
```

**`formatJournalCallout(title, project, source, revision): string`**
Returns a complete callout block:
```
> [!plan]+ Title
> `project` · `source`
>
> - **time** [[path|plan]] `model`
>   Summary text.
>   #tags
```

**`appendRevisionToCallout(title, revision, journalFilePath): Promise<boolean>`**
Replaces `appendRowToJournalSection`. Reads the journal file, finds the callout by title, inserts the revision at the end of that callout block. Returns `true` if the callout was found and modified, `false` if not found (caller should append a new callout).

**`updateJournalFrontmatter(journalPath, { date, day, project, tags }, vault): void`**
Sets/updates frontmatter properties on the journal note:
- `date` and `day`: set once on creation (idempotent `property:set`)
- `plans`: read current value via `property:read`, increment by 1, `property:set` new value
- `projects`: read current list, add project if not already present, set new list
- `tags`: existing `mergeTagsOnDailyNote` logic, keep as-is
- If `project` is empty string (no cwd), skip the `projects` merge

**`formatModelLabel(model, contextCap): string`**
Returns compact model display: `` `opus-4(200k)` `` or empty string if no model info.
Uses `stats.model` and `contextCapLabel(contextCap)` from existing helpers.

### Source Type Display

The `source` metadata on the callout header line comes from `SessionState.source`:

| Source       | Display     | When                                 |
|-------------|-------------|--------------------------------------|
| `plan-mode` | `plan-mode` | Standard ExitPlanMode capture        |
| `superpowers` | `superpowers` | Superpowers spec/plan write detected |
| `skill`     | `skill`     | Skill invocation detected            |

### Link Text Convention

The wikilink display text distinguishes entry types:

| Type    | Link text | Example                         |
|---------|-----------|---------------------------------|
| Plan    | `plan`    | `[[001-.../plan\|plan]]`        |
| Summary | `done`    | `[[001-.../summary\|done]]`     |
| Activity| `activity`| `[[001-.../activity\|activity]]` |

### Backward Compatibility

- Existing journal entries in the old table format are left unchanged — no migration
- The new `appendRevisionToCallout` function only looks for `> [!plan]+` callouts, so it won't match old `### Title` sections
- `capture-done.ts` fallback path (line 723-726) should use the new callout format for creating fresh entries
- Old `appendRowToJournalSection` can be removed once all callers switch to the new function

### CSS Snippet (Optional)

Users can add a CSS snippet to style `[!plan]` callouts with custom colors. Without it, Obsidian renders them with a default gray pencil icon, which is functional but can be enhanced:

```css
.callout[data-callout="plan"] {
  --callout-color: 137, 180, 250;
  --callout-icon: lucide-file-text;
}
```

This is optional and not part of the plugin — just a recommendation users can add.

## Verification

1. **Unit tests:** Update existing journal-related tests in `hooks/__tests__/shared.filesystem.test.ts` to test callout format generation and grouping logic
2. **Manual test:** Run the e2e test skill (`/test-e2e-skip-clean`) and verify the journal output in Obsidian
3. **Rendering check:** Open the generated journal in Obsidian and verify:
   - Frontmatter properties render in the Properties panel
   - Callout blocks render with collapse toggle
   - Wikilinks to plan/summary notes are clickable
   - Tags render as colored pills
   - Multiple entries with the same title are grouped in one callout
   - Blank lines between callouts prevent rendering glitches
4. **Backward compat:** Verify existing old-format journals are not broken by the changes
5. Run `bun check` and `bun test` pass
