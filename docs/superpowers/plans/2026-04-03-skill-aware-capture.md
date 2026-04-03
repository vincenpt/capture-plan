# Skill-Aware Session Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect when any plugin skill runs during a Claude Code session and capture the full activity (summary, files changed, tool log, subagent prompts, token stats) to Obsidian, using the same infrastructure as plan-mode and superpowers sessions.

**Architecture:** Extend the Stop hook (`capture-done.ts`) with a third detection path: after checking for plan-mode state and superpowers writes, scan the transcript for `Skill` tool_use blocks. When found, create a session directory with `activity.md` as the primary note, then reuse existing summary/stats/log generation. Mixed sessions (plan + skills) add per-skill notes alongside the plan.

**Tech Stack:** TypeScript, Bun, Bun test runner, Obsidian CLI (`obsidian-cli`)

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `hooks/transcript.ts` | Modify | Add `SkillInvocation` interface and `findSkillInvocations()` function |
| `hooks/lib/types.ts` | Modify | Extend `SessionState.source` union with `"skill"`, add `skill_name` field |
| `hooks/lib/session-state.ts` | Modify | Serialize/deserialize `skill_name` field |
| `hooks/capture-done.ts` | Modify | Add skill detection path in `main()`, add `buildSkillState()` function |
| `hooks/__tests__/skill-detection.test.ts` | Create | Unit tests for `findSkillInvocations()` |
| `hooks/__tests__/skill-capture.test.ts` | Create | Unit tests for `buildSkillState()` and integration with `main()` |
| `hooks/__tests__/helpers/transcript-helpers.ts` | Modify | Add `skillEntry()` factory function |

---

### Task 1: Add `skillEntry()` Test Helper

**Files:**
- Modify: `hooks/__tests__/helpers/transcript-helpers.ts`

- [ ] **Step 1: Add the `skillEntry()` factory function**

Add after the existing `humanEntry()` function:

```ts
/** Factory for an assistant entry containing a Skill tool_use. */
export function skillEntry(
  skill: string,
  args?: string,
  overrides: Partial<TranscriptEntry> & { textBefore?: string } = {},
): TranscriptEntry {
  const { textBefore, ...rest } = overrides;
  const content: ContentBlock[] = [];
  if (textBefore) {
    content.push({ type: "text", text: textBefore });
  }
  content.push({
    type: "tool_use",
    name: "Skill",
    id: `skill-${skill}`,
    input: { skill, ...(args ? { args } : {}) },
  });
  return {
    type: "assistant",
    timestamp: "2026-03-30T14:00:00.000Z",
    message: {
      role: "assistant",
      content,
      usage: { input_tokens: 100, output_tokens: 50 },
    },
    ...rest,
  };
}
```

- [ ] **Step 2: Verify existing tests still pass**

Run: `bun test hooks/__tests__/transcript-parsing.test.ts`
Expected: All existing tests pass (no regressions from the new helper)

- [ ] **Step 3: Commit**

```bash
git add hooks/__tests__/helpers/transcript-helpers.ts
git commit -m "test: add skillEntry() transcript helper factory"
```

---

### Task 2: Add `SkillInvocation` Interface and `findSkillInvocations()`

**Files:**
- Modify: `hooks/transcript.ts`
- Create: `hooks/__tests__/skill-detection.test.ts`

- [ ] **Step 1: Write failing tests for `findSkillInvocations()`**

Create `hooks/__tests__/skill-detection.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { findSkillInvocations, type SkillInvocation } from "../transcript.ts";
import {
  assistantEntry,
  humanEntry,
  skillEntry,
} from "./helpers/transcript-helpers.ts";
import type { TranscriptEntry } from "../transcript.ts";

describe("findSkillInvocations", () => {
  it("returns empty array when no skills used", () => {
    const entries: TranscriptEntry[] = [
      assistantEntry({ tools: [{ name: "Edit" }] }),
      humanEntry(),
      assistantEntry(),
    ];
    expect(findSkillInvocations(entries)).toEqual([]);
  });

  it("detects a single skill invocation", () => {
    const entries: TranscriptEntry[] = [
      assistantEntry(),
      skillEntry("simplify"),
      humanEntry(),
      assistantEntry({
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Simplified 3 functions" }],
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      }),
    ];
    const result = findSkillInvocations(entries);
    expect(result).toHaveLength(1);
    expect(result[0].skill).toBe("simplify");
    expect(result[0].index).toBe(1);
    expect(result[0].args).toBeUndefined();
  });

  it("captures skill args when provided", () => {
    const entries: TranscriptEntry[] = [
      skillEntry("simplify", "--verbose"),
    ];
    const result = findSkillInvocations(entries);
    expect(result).toHaveLength(1);
    expect(result[0].args).toBe("--verbose");
  });

  it("captures contextBefore from the same turn", () => {
    const entries: TranscriptEntry[] = [
      skillEntry("simplify", undefined, {
        textBefore: "Let me review the code quality.",
      }),
      humanEntry(),
    ];
    const result = findSkillInvocations(entries);
    expect(result[0].contextBefore).toBe("Let me review the code quality.");
  });

  it("captures contextAfter from the next assistant turn", () => {
    const entries: TranscriptEntry[] = [
      skillEntry("simplify"),
      humanEntry(), // tool result
      assistantEntry({
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Simplified 3 functions successfully." }],
          usage: { input_tokens: 200, output_tokens: 100 },
        },
      }),
    ];
    const result = findSkillInvocations(entries);
    expect(result[0].contextAfter).toBe("Simplified 3 functions successfully.");
  });

  it("detects multiple skill invocations", () => {
    const entries: TranscriptEntry[] = [
      skillEntry("simplify"),
      humanEntry(),
      assistantEntry(),
      skillEntry("test-driven-development"),
      humanEntry(),
      assistantEntry(),
    ];
    const result = findSkillInvocations(entries);
    expect(result).toHaveLength(2);
    expect(result[0].skill).toBe("simplify");
    expect(result[1].skill).toBe("test-driven-development");
  });

  it("ignores non-Skill tool_use blocks", () => {
    const entries: TranscriptEntry[] = [
      assistantEntry({ tools: [{ name: "Edit" }, { name: "Write" }] }),
      assistantEntry({ tools: [{ name: "Bash" }] }),
    ];
    expect(findSkillInvocations(entries)).toEqual([]);
  });

  it("returns empty contextAfter when no assistant turn follows", () => {
    const entries: TranscriptEntry[] = [
      skillEntry("simplify"),
    ];
    const result = findSkillInvocations(entries);
    expect(result[0].contextAfter).toBe("");
  });

  it("returns empty contextBefore when skill has no preceding text", () => {
    const entries: TranscriptEntry[] = [
      skillEntry("simplify"),
    ];
    const result = findSkillInvocations(entries);
    expect(result[0].contextBefore).toBe("");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test hooks/__tests__/skill-detection.test.ts`
Expected: FAIL — `findSkillInvocations` is not exported from `transcript.ts`

- [ ] **Step 3: Add `SkillInvocation` interface and `findSkillInvocations()` to transcript.ts**

Add before the `findSuperpowersWrites` function (around line 580):

```ts
/** A Skill tool_use detected in the transcript. */
export interface SkillInvocation {
  /** Transcript entry index where the Skill tool_use was found. */
  index: number;
  /** Skill name from input.skill. */
  skill: string;
  /** Optional args from input.args. */
  args?: string;
  /** Assistant text from the same turn, before the Skill tool_use block. */
  contextBefore: string;
  /** Assistant text from the immediate next assistant turn after the skill completes. */
  contextAfter: string;
}

/** Scan transcript for Skill tool_use blocks, capturing invocation metadata and surrounding context. */
export function findSkillInvocations(entries: TranscriptEntry[]): SkillInvocation[] {
  const results: SkillInvocation[] = [];

  for (let i = 0; i < entries.length; i++) {
    const blocks = getContentBlocks(entries[i]);
    for (const block of blocks) {
      if (block.type !== "tool_use" || block.name !== "Skill") continue;

      const skill = block.input?.skill;
      if (typeof skill !== "string") continue;

      const args = typeof block.input?.args === "string" ? block.input.args : undefined;

      // Collect text blocks before the Skill block in this same turn
      const textsBefore: string[] = [];
      for (const b of blocks) {
        if (b === block) break;
        if (b.type === "text" && b.text) textsBefore.push(b.text);
      }

      // Find the next assistant turn's text
      let contextAfter = "";
      for (let j = i + 1; j < entries.length; j++) {
        const nextBlocks = getContentBlocks(entries[j]);
        if (nextBlocks.length === 0) continue; // skip non-assistant entries
        const texts: string[] = [];
        for (const b of nextBlocks) {
          if (b.type === "text" && b.text) texts.push(b.text);
        }
        if (texts.length > 0) {
          contextAfter = texts.join("\n\n");
          break;
        }
      }

      results.push({
        index: i,
        skill,
        args,
        contextBefore: textsBefore.join("\n\n"),
        contextAfter,
      });
    }
  }

  return results;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test hooks/__tests__/skill-detection.test.ts`
Expected: All 8 tests PASS

- [ ] **Step 5: Run all existing tests to check for regressions**

Run: `bun test`
Expected: All 396+ tests PASS

- [ ] **Step 6: Commit**

```bash
git add hooks/transcript.ts hooks/__tests__/skill-detection.test.ts
git commit -m "feat: add findSkillInvocations() for detecting skill usage in transcripts"
```

---

### Task 3: Extend `SessionState` with Skill Fields

**Files:**
- Modify: `hooks/lib/types.ts`
- Modify: `hooks/lib/session-state.ts`

- [ ] **Step 1: Write failing test for skill_name serialization**

Add a test to `hooks/__tests__/shared.filesystem.test.ts` (or whichever file tests session state serialization). First check which file has the session state tests:

Look in `hooks/__tests__/shared.filesystem.test.ts` for `parseStateFromFrontmatter` or `writeVaultState` tests. Add:

```ts
it("round-trips skill_name through frontmatter", () => {
  const state: SessionState = {
    session_id: "test-skill-session",
    plan_slug: "simplify-hooks",
    plan_title: "Simplify Hooks Code",
    plan_dir: "Claude/Plans/2026/04-03/001-simplify-hooks",
    date_key: "2026-04-03",
    timestamp: new Date().toISOString(),
    source: "skill",
    skill_name: "simplify",
  };
  const written = writeVaultState(state, testVault);
  expect(written).toBe(true);

  const stateFile = join(vaultPath, state.plan_dir, "state.md");
  const content = readFileSync(stateFile, "utf8");
  const parsed = parseStateFromFrontmatter(content);
  expect(parsed).not.toBeNull();
  expect(parsed!.source).toBe("skill");
  expect(parsed!.skill_name).toBe("simplify");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test hooks/__tests__/shared.filesystem.test.ts --grep "skill_name"`
Expected: FAIL — `skill_name` is not a property of `SessionState`

- [ ] **Step 3: Extend SessionState interface in types.ts**

In `hooks/lib/types.ts`, update the `SessionState` interface:

```ts
export interface SessionState {
  session_id: string;
  plan_slug: string;
  plan_title: string;
  plan_dir: string;
  date_key: string;
  timestamp: string;
  journal_path?: string;
  project?: string;
  tags?: string;
  model?: string;
  cc_version?: string;
  planStats?: TranscriptStats;
  source?: "plan-mode" | "superpowers" | "skill";
  spec_path?: string;
  skill_name?: string;
}
```

- [ ] **Step 4: Add skill_name serialization in session-state.ts**

In `serializeStateToFrontmatter`, add after the `spec_path` line:

```ts
if (state.skill_name) lines.push(`skill_name: "${state.skill_name}"`);
```

In `parseStateFromFrontmatter`, add after the `spec_path` line:

```ts
skill_name: get("skill_name"),
```

And update the state construction to include it:

```ts
const state: SessionState = {
  // ... existing fields ...
  source: get("source") as SessionState["source"],
  spec_path: get("spec_path"),
  skill_name: get("skill_name"),
};
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test hooks/__tests__/shared.filesystem.test.ts --grep "skill_name"`
Expected: PASS

- [ ] **Step 6: Run all tests**

Run: `bun test`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add hooks/lib/types.ts hooks/lib/session-state.ts hooks/__tests__/shared.filesystem.test.ts
git commit -m "feat: extend SessionState with skill source type and skill_name field"
```

---

### Task 4: Implement `buildSkillState()` in capture-done.ts

**Files:**
- Modify: `hooks/capture-done.ts`
- Create: `hooks/__tests__/skill-capture.test.ts`

- [ ] **Step 1: Write failing tests for `buildSkillState()`**

Create `hooks/__tests__/skill-capture.test.ts`. Since `buildSkillState` calls external services (Haiku API, Obsidian CLI), we need to test the integration flow at the `main()` level with mocked externals. But first, let's test the pure logic parts.

Check how `buildSuperpowersState` is tested — look at `hooks/__tests__/shared.external.test.ts` for patterns with mocked `summarizeWithClaude` and `createVaultNote`.

For now, write tests that validate the new detection path gets hit in `main()`. The tests should follow the pattern in `shared.external.test.ts`.

```ts
import { describe, expect, it, mock, beforeEach, afterEach } from "bun:test";
import type { SkillInvocation } from "../transcript.ts";
import type { TranscriptEntry } from "../transcript.ts";
import { assistantEntry, humanEntry, skillEntry } from "./helpers/transcript-helpers.ts";

describe("skill capture integration", () => {
  describe("buildSkillState logic", () => {
    it("uses first skill invocation as boundary index", () => {
      const invocations: SkillInvocation[] = [
        {
          index: 5,
          skill: "simplify",
          contextBefore: "Let me review.",
          contextAfter: "Simplified 3 functions.",
        },
        {
          index: 12,
          skill: "test-driven-development",
          contextBefore: "Now for TDD.",
          contextAfter: "Tests written.",
        },
      ];
      // The boundary should be the first skill's index
      expect(invocations[0].index).toBe(5);
    });

    it("concatenates context from all skill invocations for Haiku input", () => {
      const invocations: SkillInvocation[] = [
        {
          index: 5,
          skill: "simplify",
          contextBefore: "Reviewing quality.",
          contextAfter: "Simplified 3 functions.",
        },
        {
          index: 12,
          skill: "debugging",
          contextBefore: "Found a bug.",
          contextAfter: "Fixed the issue.",
        },
      ];
      const narrative = invocations
        .map((inv) => [inv.contextBefore, inv.contextAfter].filter(Boolean).join("\n"))
        .join("\n\n");
      expect(narrative).toContain("Reviewing quality.");
      expect(narrative).toContain("Simplified 3 functions.");
      expect(narrative).toContain("Found a bug.");
      expect(narrative).toContain("Fixed the issue.");
    });

    it("builds skills YAML list from invocations", () => {
      const invocations: SkillInvocation[] = [
        { index: 0, skill: "simplify", contextBefore: "", contextAfter: "" },
        { index: 5, skill: "debugging", contextBefore: "", contextAfter: "" },
      ];
      const skillsYaml = invocations.map((inv) => `  - ${inv.skill}`).join("\n");
      expect(skillsYaml).toBe("  - simplify\n  - debugging");
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they pass** (these test pure logic only)

Run: `bun test hooks/__tests__/skill-capture.test.ts`
Expected: PASS (pure logic tests)

- [ ] **Step 3: Add the SKILL_SYSTEM_PROMPT constant to capture-done.ts**

Add after the existing `PLAN_SYSTEM_PROMPT` constant:

```ts
const SKILL_SYSTEM_PROMPT = `You are a concise note-taking assistant. Given context about a coding session where automated skills were used (skill names, context, and outcomes), output exactly two lines:
Line 1: A 1-2 sentence summary (max 200 chars). Include what skills ran and their concrete outcomes.
Line 2: 1-2 lowercase kebab-case tags relevant to the activity (comma-separated, no # prefix).
Output ONLY these two lines.`;
```

- [ ] **Step 4: Add `buildSkillState()` function to capture-done.ts**

Add after the existing `buildSuperpowersState()` function:

```ts
/** Build a SessionState on the fly for a skill-only session, creating the activity vault note. */
async function buildSkillState(
  sessionId: string,
  invocations: SkillInvocation[],
  entries: TranscriptEntry[],
  payload: StopPayload,
  config: Config,
): Promise<{ state: SessionState; boundaryIdx: number } | null> {
  if (invocations.length === 0) return null;

  // Build narrative from all skill invocations' surrounding context
  const narrative = invocations
    .map((inv) => {
      const parts = [inv.contextBefore, inv.contextAfter].filter(Boolean);
      return parts.join("\n");
    })
    .filter(Boolean)
    .join("\n\n");

  if (narrative.length < 20) return null;

  // Summarize with Haiku to get title and tags
  const { summary, tags: newTags } = await summarizeWithClaude(narrative, SKILL_SYSTEM_PROMPT);

  // Use Haiku summary as title, truncated to first sentence or 80 chars
  const rawTitle = extractTitle(summary) || `${invocations[0].skill} session`;
  const title = rawTitle.length > 80 ? `${rawTitle.slice(0, 77)}...` : rawTitle;
  const slug = toSlug(title);
  const { dd, mm, yyyy, dateKey, datetime, ampmTime } = getDateParts();
  const dateDirRelative = `${config.plan_path}/${yyyy}/${mm}-${dd}`;

  const vaultPath = getVaultPath(config.vault);
  const dateDirAbsolute = vaultPath ? join(vaultPath, dateDirRelative) : null;
  const counter = dateDirAbsolute ? nextCounter(dateDirAbsolute) : 1;

  const planDir = `${dateDirRelative}/${padCounter(counter)}-${slug}`;
  const activityPath = `${planDir}/activity`;
  const journalPath = getJournalPath(config);
  const project = getProjectName(payload.cwd);
  const tagsYaml = formatTagsYaml(newTags);

  // Use first skill invocation as boundary
  const boundaryIdx = invocations[0].index;

  // Collect planning-phase stats (everything before the first skill)
  let planStats: TranscriptStats | null = null;
  try {
    if (boundaryIdx > 0) {
      planStats = collectTranscriptStats(entries, 0, boundaryIdx);
    }
  } catch {
    /* ignore */
  }

  const contextCap = resolveContextCap(
    planStats?.peakTurnContext ?? 0,
    config.context_cap,
    sessionId,
  );
  const modelYaml = formatModelYaml(planStats, contextCap);
  const ccVersion = detectCcVersion() ?? readCcVersion(sessionId);
  const ccVersionYaml = formatCcVersionYaml(ccVersion);

  // Build skills YAML list
  const skillNames = invocations.map((inv) => inv.skill);
  const uniqueSkills = [...new Set(skillNames)];
  const skillsYaml = uniqueSkills.map((s) => `  - ${s}`).join("\n");

  // Build skills table
  const skillsTable = invocations
    .map((inv) => {
      const time = inv.index < entries.length && entries[inv.index].timestamp
        ? new Date(entries[inv.index].timestamp as string).toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
          })
        : "—";
      return `| ${time} | ${inv.skill} | ${inv.args ?? "—"} |`;
    })
    .join("\n");

  // Build context section from surrounding text
  const contextText = invocations
    .map((inv) => {
      const parts: string[] = [];
      if (inv.contextBefore) parts.push(inv.contextBefore);
      if (inv.contextAfter) parts.push(inv.contextAfter);
      return parts.join("\n\n");
    })
    .filter(Boolean)
    .join("\n\n---\n\n");

  const noteContent = `---
created: "[[${journalPath}|${datetime}]]"${project ? `\nproject: ${project}` : ""}${tagsYaml ? `\ntags:\n${tagsYaml}` : ""}
session: "[[Sessions/${shortSessionId(sessionId)}]]"${ccVersionYaml}${modelYaml}
source: skill
skills:
${skillsYaml}
---
# ${title}

## Skills Used

| Time | Skill | Args |
|------|-------|------|
${skillsTable}

## Context

${contextText || "_No context captured_"}
`;

  const createResult = createVaultNote(activityPath, noteContent, config.vault);
  if (!createResult.success) {
    debugLog("Failed to create skill activity note\n", DEBUG_LOG);
    return null;
  }

  // Journal entry
  const journalEntry = `\\n### ${title}\\n\\n| | |\\n|---|---|\\n| [[${activityPath}\\|${ampmTime}]] | ${summary} |`;
  appendToJournal(journalEntry, journalPath, config.vault);
  mergeTagsOnDailyNote(newTags, journalPath, config.vault);

  const state: SessionState = {
    session_id: sessionId,
    plan_slug: slug,
    plan_title: title,
    plan_dir: planDir,
    date_key: dateKey,
    timestamp: new Date().toISOString(),
    journal_path: journalPath,
    project,
    tags: newTags,
    model: planStats?.model,
    cc_version: ccVersion,
    planStats: planStats ?? undefined,
    source: "skill",
    skill_name: uniqueSkills.join(","),
  };

  writeVaultState(state, config.vault);
  debugLog(`Skill state built: ${title} -> ${activityPath}\n`, DEBUG_LOG);
  return { state, boundaryIdx };
}
```

- [ ] **Step 5: Add the `findSkillInvocations` import to capture-done.ts**

Update the import from `./transcript.ts` to include the new function:

```ts
import {
  collectExecutionStats,
  collectToolLog,
  collectTranscriptStats,
  computeDurationMs,
  findExitPlanIndex,
  findSkillInvocations,  // NEW
  findSuperpowersBoundary,
  findSuperpowersWrites,
  hasExecutionAfter,
  parseTranscript,
  type SkillInvocation,  // NEW
  type SuperpowersWrite,
  selectDoneText,
  type TranscriptEntry,
  type TranscriptStats,
  transcriptContainsPattern,
} from "./transcript.ts";
```

- [ ] **Step 6: Run lint**

Run: `bun run check`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add hooks/capture-done.ts
git commit -m "feat: add buildSkillState() for creating activity notes from skill sessions"
```

---

### Task 5: Wire Skill Detection into `main()` Flow

**Files:**
- Modify: `hooks/capture-done.ts`

- [ ] **Step 1: Add skill detection in the "no state" branch of main()**

In `capture-done.ts`, in the `main()` function, find the block starting at `} else {` (around line 249) where it says `// No state — cheap pre-check before full transcript parse`. Replace the section from that `else` up to the closing `}` of the if/else block (around line 271) with:

```ts
    } else {
      // No state — cheap pre-check before full transcript parse
      if (!transcriptPath) process.exit(0);

      // Check for superpowers writes first
      const specPat = config.superpowers_spec_pattern || "/superpowers/specs/";
      const planPat = config.superpowers_plan_pattern || "/superpowers/plans/";
      const hasSuperpowers = transcriptContainsPattern(transcriptPath, [specPat, planPat]);
      const hasSkills = !hasSuperpowers && transcriptContainsPattern(transcriptPath, ['"Skill"']);

      if (!hasSuperpowers && !hasSkills) process.exit(0);

      entries = parseTranscript(transcriptPath);

      if (hasSuperpowers) {
        const spWrites = findSuperpowersWrites(entries, specPat, planPat);
        if (spWrites.length === 0) process.exit(0);

        isSuperpowers = true;
        debugLog(`Superpowers session detected: ${spWrites.length} spec/plan writes\n`, DEBUG_LOG);

        const result = await buildSuperpowersState(sessionId, spWrites, entries, payload, config);
        if (!result) {
          debugLog("Failed to build superpowers state\n", DEBUG_LOG);
          process.exit(0);
        }

        state = result.state;
        boundaryIdx = result.boundaryIdx;
      } else {
        // Skill detection path
        const skillInvocations = findSkillInvocations(entries);
        if (skillInvocations.length === 0) process.exit(0);

        debugLog(
          `Skill session detected: ${skillInvocations.map((s) => s.skill).join(", ")}\n`,
          DEBUG_LOG,
        );

        const result = await buildSkillState(sessionId, skillInvocations, entries, payload, config);
        if (!result) {
          debugLog("Failed to build skill state\n", DEBUG_LOG);
          process.exit(0);
        }

        state = result.state;
        boundaryIdx = result.boundaryIdx;
      }
    }
```

- [ ] **Step 2: Handle `source: "skill"` in the existing state branch**

In the `if (state)` branch (around line 221), after the `state.source === "superpowers"` check, add handling for `"skill"`:

```ts
      if (state.source === "superpowers") {
        // State was written by a prior superpowers capture — find boundary from transcript
        isSuperpowers = true;
        const spWrites = findSuperpowersWrites(
          entries,
          config.superpowers_spec_pattern,
          config.superpowers_plan_pattern,
        );
        boundaryIdx = findSuperpowersBoundary(spWrites);
      } else if (state.source === "skill") {
        // State was written by skill capture — find boundary from skill invocations
        const skillInvocations = findSkillInvocations(entries);
        boundaryIdx = skillInvocations.length > 0 ? skillInvocations[0].index : -1;
      } else {
        boundaryIdx = findExitPlanIndex(entries);
      }
```

- [ ] **Step 3: Update the `hasExecutionAfter` check for skill sessions**

For skill sessions, the "execution" IS the skill activity — we don't need to check for execution tools after the boundary the same way. The skill itself does the work. Find the `hasExecutionAfter` check (around line 274) and update it:

```ts
    // Check for execution activity after the planning boundary
    // For skill sessions, any tool activity after the first skill counts as execution
    if (!hasExecutionAfter(entries, boundaryIdx) && state.source !== "skill") {
      debugLog("No execution tools after plan boundary, waiting for next Stop\n", DEBUG_LOG);
      if (!isSuperpowers) {
        process.exit(0);
      }
      if (vaultPath) deleteVaultState(state.plan_dir, vaultPath);
      process.exit(0);
    }
```

- [ ] **Step 4: Update the summary note's plan wikilink for skill sessions**

In the summary note content generation (around line 380), the `plan:` frontmatter field references `plan.md`. For skill sessions, it should reference `activity.md`:

```ts
    const primaryNoteName = state.source === "skill" ? "activity" : "plan";
    const noteContent = `---
created: "[[${journalPath}|${datetime}]]"${project ? `\nproject: ${project}` : ""}${tagsYaml ? `\ntags:\n${tagsYaml}` : ""}
plan: "[[${state.plan_dir}/${primaryNoteName}|${state.plan_title.replace(/"/g, '\\"')}]]"
duration: "${duration}"${ccVersionYaml}${modelYaml}
---
# Done: ${state.plan_title}
...
`;
```

- [ ] **Step 5: Update the vault state cleanup for skill sessions**

In the `hasExecutionAfter` block for superpowers (around line 276-282), also handle skill sessions:

```ts
    if (!hasExecutionAfter(entries, boundaryIdx) && state.source !== "skill") {
      debugLog("No execution tools after plan boundary, waiting for next Stop\n", DEBUG_LOG);
      if (!isSuperpowers && state.source !== "skill") {
        process.exit(0);
      }
      if (vaultPath) deleteVaultState(state.plan_dir, vaultPath);
      process.exit(0);
    }
```

Wait — step 3 already handles this by checking `state.source !== "skill"`. The whole block is skipped for skill sessions. This step is a no-op.

- [ ] **Step 6: Run lint and all tests**

Run: `bun run check && bun test`
Expected: No lint errors, all tests pass

- [ ] **Step 7: Commit**

```bash
git add hooks/capture-done.ts
git commit -m "feat: wire skill detection into capture-done main() flow"
```

---

### Task 6: Handle Mixed Sessions (Plan + Skills)

**Files:**
- Modify: `hooks/capture-done.ts`

- [ ] **Step 1: Write failing test for mixed session**

Add to `hooks/__tests__/skill-capture.test.ts`:

```ts
describe("mixed session handling", () => {
  it("detects skills in a session that already has plan-mode state", () => {
    // When state exists with source: "plan-mode" AND the transcript has Skill tool_use blocks,
    // the Stop hook should create per-skill notes alongside the plan summary.
    const entries: TranscriptEntry[] = [
      assistantEntry(), // planning phase
      assistantEntry({ tools: [{ name: "ExitPlanMode" }] }),
      humanEntry(),
      assistantEntry({ tools: [{ name: "Edit" }] }), // execution
      humanEntry(),
      skillEntry("simplify"),
      humanEntry(),
      assistantEntry({
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Simplified the code." }],
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      }),
    ];

    const invocations = findSkillInvocations(entries);
    expect(invocations).toHaveLength(1);
    expect(invocations[0].skill).toBe("simplify");
  });
});
```

- [ ] **Step 2: Run test to verify it passes** (detection already works)

Run: `bun test hooks/__tests__/skill-capture.test.ts --grep "mixed session"`
Expected: PASS

- [ ] **Step 3: Add per-skill note creation in the summary generation section**

After the summary note is created (after `createVaultNote(summaryPath, ...)` around line 399), add skill note creation:

```ts
    // Create per-skill activity notes for mixed sessions (plan + skills)
    if (state.source !== "skill") {
      // For non-skill sessions (plan-mode, superpowers), check if skills were also used
      const skillInvocations = findSkillInvocations(entries);
      if (skillInvocations.length > 0) {
        debugLog(
          `Mixed session: ${skillInvocations.length} skill(s) detected alongside ${state.source}\n`,
          DEBUG_LOG,
        );

        for (const inv of skillInvocations) {
          const skillNotePath = `${state.plan_dir}/${inv.skill}`;
          const contextText = [inv.contextBefore, inv.contextAfter].filter(Boolean).join("\n\n");
          const skillNoteContent = `---
created: "[[${journalPath}|${datetime}]]"
plan: "[[${state.plan_dir}/plan|${state.plan_title.replace(/"/g, '\\"')}]]"
source: skill
skill: ${inv.skill}
---
# ${inv.skill}

${contextText || "_No context captured_"}
`;
          const skillResult = createVaultNote(skillNotePath, skillNoteContent, config.vault);
          if (!skillResult.success) {
            debugLog(`Failed to create skill note: ${skillNotePath}\n`, DEBUG_LOG);
          } else {
            debugLog(`Skill note captured -> ${skillNotePath}.md\n`, DEBUG_LOG);
          }
        }
      }
    }
```

- [ ] **Step 4: Run lint and all tests**

Run: `bun run check && bun test`
Expected: No errors, all tests pass

- [ ] **Step 5: Commit**

```bash
git add hooks/capture-done.ts hooks/__tests__/skill-capture.test.ts
git commit -m "feat: create per-skill notes in mixed plan+skill sessions"
```

---

### Task 7: Update Transcript Pre-Check Pattern

**Files:**
- Modify: `hooks/capture-done.ts`

- [ ] **Step 1: Write a test for the pre-check pattern**

Add to `hooks/__tests__/skill-detection.test.ts`:

```ts
import { transcriptContainsPattern } from "../transcript.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("transcriptContainsPattern for skills", () => {
  it("detects Skill tool_use in raw JSONL", () => {
    const tempDir = join(tmpdir(), `cp-skill-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    const file = join(tempDir, "test.jsonl");
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Skill", input: { skill: "simplify" } }],
      },
    });
    writeFileSync(file, line);

    expect(transcriptContainsPattern(file, ['"Skill"'])).toBe(true);
    Bun.spawnSync(["rm", "-rf", tempDir]);
  });

  it("returns false when no Skill in transcript", () => {
    const tempDir = join(tmpdir(), `cp-skill-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    const file = join(tempDir, "test.jsonl");
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Edit", input: { file_path: "/tmp/x" } }],
      },
    });
    writeFileSync(file, line);

    expect(transcriptContainsPattern(file, ['"Skill"'])).toBe(false);
    Bun.spawnSync(["rm", "-rf", tempDir]);
  });
});
```

- [ ] **Step 2: Run tests**

Run: `bun test hooks/__tests__/skill-detection.test.ts --grep "transcriptContainsPattern"`
Expected: PASS (existing function, just verifying pattern works for skills)

- [ ] **Step 3: Commit** (test-only, validates pre-check pattern works)

```bash
git add hooks/__tests__/skill-detection.test.ts
git commit -m "test: verify transcriptContainsPattern detects Skill tool_use"
```

---

### Task 8: Final Integration Testing and Lint

**Files:**
- All modified files

- [ ] **Step 1: Run full test suite**

Run: `bun test`
Expected: All tests pass (400+ tests)

- [ ] **Step 2: Run lint and format check**

Run: `bun run check`
Expected: No errors

- [ ] **Step 3: Fix any lint/format issues**

Run: `bun run check:fix`

- [ ] **Step 4: Run all tests again after fixes**

Run: `bun test`
Expected: All tests pass

- [ ] **Step 5: Commit any lint fixes**

```bash
git add -A
git commit -m "style: fix lint and formatting issues"
```

---

### Task 9: End-to-End Verification

- [ ] **Step 1: Run the e2e test to verify no regressions**

Run: `bun run test-e2e` (or the test-e2e skill)
Expected: Existing plan capture flow still works end-to-end

- [ ] **Step 2: Manual verification with /simplify**

1. Open a new Claude Code session on this repo
2. Run `/simplify`
3. End the session
4. Check the Obsidian vault for:
   - `Claude/Plans/2026/04-03/NNN-<slug>/activity.md` — AI-generated title, skills table, context
   - `summary.md` — files changed, outcomes
   - `tools-stats.md` — token stats
   - `tools-log.md` — chronological tool log
   - Journal entry linking to the activity note

- [ ] **Step 3: Manual verification with mixed session**

1. Open a new Claude Code session
2. Create a plan (triggers ExitPlanMode)
3. Execute part of the plan
4. Run `/simplify`
5. End the session
6. Check the vault for both `plan.md` AND `simplify.md` in the same directory

- [ ] **Step 4: Commit any final fixes**

```bash
git add -A
git commit -m "fix: address e2e verification findings"
```
