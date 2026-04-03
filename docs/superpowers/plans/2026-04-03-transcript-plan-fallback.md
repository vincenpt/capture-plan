# Transcript Plan Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When ExitPlanMode fires with `plan: null`, fall back to extracting plan content from the last 3 assistant messages in the transcript JSONL.

**Architecture:** New `extractPlanText` function in `transcript.ts` mirrors the existing `extractConclusionText` pattern but walks backward from the ExitPlanMode index instead of from the end of the array. Integration in `capture-plan.ts` adds the fallback between the existing extraction attempt and the early exit, reusing parsed entries for the later stats collection.

**Tech Stack:** TypeScript, Bun test runner

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `hooks/transcript.ts` | Modify | Add `extractPlanText` function |
| `hooks/capture-plan.ts` | Modify | Add `transcript_path` to HookPayload, add fallback logic, refactor stats to reuse parsed entries |
| `hooks/__tests__/transcript-parsing.test.ts` | Modify | Add `extractPlanText` tests |

---

### Task 1: Add `extractPlanText` to transcript.ts (TDD)

**Files:**
- Modify: `hooks/__tests__/transcript-parsing.test.ts`
- Modify: `hooks/transcript.ts:187-208`
- Test: `hooks/__tests__/transcript-parsing.test.ts`

- [ ] **Step 1: Write failing tests for `extractPlanText`**

Add to `hooks/__tests__/transcript-parsing.test.ts`. Import `extractPlanText` alongside the existing imports from `../transcript.ts` at line 6. Add this describe block at the end of the file:

```typescript
describe("extractPlanText", () => {
  it("collects last 3 assistant text messages before exitIdx", () => {
    const entries: TranscriptEntry[] = [
      assistantEntry({ message: { role: "assistant", content: [{ type: "text", text: "Analysis of the bug" }] } }),
      assistantEntry({ message: { role: "assistant", content: [{ type: "text", text: "Here is what I found" }] } }),
      assistantEntry({ message: { role: "assistant", content: [{ type: "text", text: "Proposed fix approach" }] } }),
      assistantEntry({ message: { role: "assistant", content: [{ type: "text", text: "Final plan summary" }] } }),
      assistantEntry({ tools: [{ name: "ExitPlanMode" }] }), // exitIdx = 4
    ];
    // Should get last 3 before exitIdx (indices 1, 2, 3)
    expect(extractPlanText(entries, 4)).toBe(
      "Here is what I found\n\nProposed fix approach\n\nFinal plan summary",
    );
  });

  it("returns empty string when no text before exitIdx", () => {
    const entries: TranscriptEntry[] = [
      assistantEntry({ tools: [{ name: "Read" }] }),
      assistantEntry({ tools: [{ name: "Grep" }] }),
      assistantEntry({ tools: [{ name: "ExitPlanMode" }] }),
    ];
    expect(extractPlanText(entries, 2)).toBe("");
  });

  it("skips tool_use-only entries", () => {
    const entries: TranscriptEntry[] = [
      assistantEntry({ message: { role: "assistant", content: [{ type: "text", text: "Plan content" }] } }),
      assistantEntry({ tools: [{ name: "Read" }] }),
      assistantEntry({ message: { role: "assistant", content: [{ type: "text", text: "More analysis" }] } }),
      assistantEntry({ tools: [{ name: "ExitPlanMode" }] }),
    ];
    expect(extractPlanText(entries, 3)).toBe("Plan content\n\nMore analysis");
  });

  it("respects maxEntries parameter", () => {
    const entries: TranscriptEntry[] = [
      assistantEntry({ message: { role: "assistant", content: [{ type: "text", text: "First" }] } }),
      assistantEntry({ message: { role: "assistant", content: [{ type: "text", text: "Second" }] } }),
      assistantEntry({ message: { role: "assistant", content: [{ type: "text", text: "Third" }] } }),
      assistantEntry({ tools: [{ name: "ExitPlanMode" }] }),
    ];
    expect(extractPlanText(entries, 3, 1)).toBe("Third");
  });

  it("returns text in chronological order", () => {
    const entries: TranscriptEntry[] = [
      assistantEntry({ message: { role: "assistant", content: [{ type: "text", text: "Alpha" }] } }),
      assistantEntry({ message: { role: "assistant", content: [{ type: "text", text: "Beta" }] } }),
      assistantEntry({ tools: [{ name: "ExitPlanMode" }] }),
    ];
    const result = extractPlanText(entries, 2);
    expect(result).toBe("Alpha\n\nBeta");
    expect(result.indexOf("Alpha")).toBeLessThan(result.indexOf("Beta"));
  });

  it("skips human entries", () => {
    const entries: TranscriptEntry[] = [
      assistantEntry({ message: { role: "assistant", content: [{ type: "text", text: "My analysis" }] } }),
      humanEntry(),
      assistantEntry({ message: { role: "assistant", content: [{ type: "text", text: "After clarification" }] } }),
      assistantEntry({ tools: [{ name: "ExitPlanMode" }] }),
    ];
    expect(extractPlanText(entries, 3)).toBe("My analysis\n\nAfter clarification");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test transcript-parsing.test.ts 2>&1 | tail -20`
Expected: FAIL — `extractPlanText` is not exported from `../transcript.ts`

- [ ] **Step 3: Implement `extractPlanText`**

Add to `hooks/transcript.ts`, directly after `extractConclusionText` (after line 208):

```typescript
/** Collect text from the last N assistant entries before a given index, in chronological order. */
export function extractPlanText(
  entries: TranscriptEntry[],
  beforeIdx: number,
  maxEntries = 3,
): string {
  const collected: string[] = [];
  for (let i = beforeIdx - 1; i >= 0 && collected.length < maxEntries; i--) {
    const blocks = getContentBlocks(entries[i]);
    const texts: string[] = [];
    for (const block of blocks) {
      if (block.type === "text" && block.text) {
        texts.push(block.text);
      }
    }
    if (texts.length > 0) collected.push(texts.join("\n\n"));
  }
  collected.reverse();
  return collected.join("\n\n");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test transcript-parsing.test.ts 2>&1 | tail -20`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add hooks/transcript.ts hooks/__tests__/transcript-parsing.test.ts
git commit -m "feat: add extractPlanText for transcript-based plan fallback"
```

---

### Task 2: Integrate transcript fallback into capture-plan.ts

**Files:**
- Modify: `hooks/capture-plan.ts:43-54` (HookPayload interface)
- Modify: `hooks/capture-plan.ts:86-134` (main function)

- [ ] **Step 1: Add `transcript_path` to `HookPayload`**

In `hooks/capture-plan.ts`, add the field to the interface at line 43:

```typescript
interface HookPayload {
  session_id: string;
  transcript_path?: string;
  hook_event_name: string;
  tool_name: string;
  cwd?: string;
  tool_input: {
    plan?: string;
    planFilePath?: string;
    [key: string]: unknown;
  };
  tool_response?: { plan?: string; filePath?: string; [key: string]: unknown } | string;
}
```

- [ ] **Step 2: Add `extractPlanText` to imports**

In `hooks/capture-plan.ts`, add `extractPlanText` to the import from `./transcript.ts` at line 37:

```typescript
import {
  collectTranscriptStats,
  extractPlanText,
  findExitPlanIndex,
  parseTranscript,
  type TranscriptStats,
} from "./transcript.ts";
```

- [ ] **Step 3: Add transcript fallback in main function**

Replace lines 98-134 of `hooks/capture-plan.ts` (from `const extraction =` through the stats collection `try/catch` block) with:

```typescript
    let extraction = await extractPlanContent(payload);

    // Transcript fallback: parse once, reuse for both plan extraction and stats
    let entries: TranscriptEntry[] | null = null;
    let exitIdx = -1;
    const transcriptPath =
      payload.transcript_path || findTranscriptPath(sessionId, payload.cwd);

    if ((!extraction || extraction.content.length < 20) && transcriptPath) {
      try {
        entries = parseTranscript(transcriptPath);
        exitIdx = findExitPlanIndex(entries);
        if (exitIdx >= 0) {
          const planText = extractPlanText(entries, exitIdx);
          if (planText.length >= 20) {
            extraction = { content: planText, source: "transcript", file: "" };
            debugLog(`Plan extracted from transcript (${planText.length} chars)\n`, DEBUG_LOG);
          }
        }
      } catch (err) {
        debugLog(`Transcript fallback failed: ${err}\n`, DEBUG_LOG);
      }
    }

    if (!extraction || extraction.content.length < 20) {
      debugLog("No valid plan content\n", DEBUG_LOG);
      process.exit(0);
    }

    const { content: planContent, source: planSource, file: planFile } = extraction;
    const title = extractTitle(planContent);
    const slug = toSlug(title);
    const { dd, mm, yyyy, dateKey, datetime, ampmTime } = getDateParts();

    const config = await loadConfig(payload.cwd);
    const dateDirRelative = `${config.plan_path}/${yyyy}/${mm}-${dd}`;

    debugLog(
      `HOOK=${hookEvent} SRC=${planSource} FILE=${planFile} TITLE=${title} SLUG=${slug} DATE_DIR=${dateDirRelative}\n`,
      DEBUG_LOG,
    );

    // Collect planning-phase stats from transcript (reuse parsed entries if available)
    let stats: TranscriptStats | null = null;
    try {
      if (!entries && transcriptPath) {
        entries = parseTranscript(transcriptPath);
        exitIdx = findExitPlanIndex(entries);
      }
      if (entries && exitIdx >= 0) {
        stats = collectTranscriptStats(entries, 0, exitIdx);
        debugLog(
          `Transcript stats collected: ${stats.totalToolCalls} tool calls, model=${stats.model}\n`,
          DEBUG_LOG,
        );
      }
    } catch (err) {
      debugLog(`Failed to collect transcript stats: ${err}\n`, DEBUG_LOG);
    }
```

Note: also add `type TranscriptEntry` to the import from `./transcript.ts`:

```typescript
import {
  collectTranscriptStats,
  extractPlanText,
  findExitPlanIndex,
  parseTranscript,
  type TranscriptEntry,
  type TranscriptStats,
} from "./transcript.ts";
```

- [ ] **Step 4: Run full test suite**

Run: `bun test 2>&1 | tail -10`
Expected: All tests PASS (no regressions)

- [ ] **Step 5: Run lint and format check**

Run: `bun run check 2>&1 | tail -10`
Expected: Clean output, no errors

- [ ] **Step 6: Commit**

```bash
git add hooks/capture-plan.ts
git commit -m "feat: fall back to transcript when plan content is null"
```

---

### Task 3: Verification

- [ ] **Step 1: Run full test suite**

Run: `bun test 2>&1 | tail -10`
Expected: All tests PASS

- [ ] **Step 2: Run lint + format**

Run: `bun run check 2>&1 | tail -10`
Expected: No errors

- [ ] **Step 3: Manual test (if desired)**

Enter plan mode in a Claude Code session within this project, discuss something briefly, call ExitPlanMode without writing the plan file. Check:
1. `/tmp/capture-plan-debug.log` should show `Plan extracted from transcript (N chars)` instead of `No valid plan content`
2. A new plan note should appear in the Obsidian vault under `Claude/Plans/YYYY/MM-DD/`
