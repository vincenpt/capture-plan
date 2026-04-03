# Transcript Fallback for Plan Extraction

## Problem

When ExitPlanMode fires with `plan: null` in `tool_response` (because the LLM never wrote the plan file), all four extraction paths in `extractPlanContent` fail and the hook exits without capturing anything. The session has no record in the Obsidian vault.

This happens when the LLM decides a task is too simple for a formal plan file but still uses plan mode (enters plan mode, analyzes, calls ExitPlanMode without writing to the plan file path).

## Solution

Add a transcript-based fallback to `capture-plan.ts`. The transcript JSONL always exists and contains every assistant message from the planning conversation. When standard extraction fails, parse the transcript and collect the last 3 assistant text messages before the ExitPlanMode entry.

## Changes

### 1. New function: `extractPlanText` in `hooks/transcript.ts`

```typescript
export function extractPlanText(
  entries: TranscriptEntry[],
  exitIdx: number,
  maxEntries = 3,
): string
```

- Walks backward from `exitIdx` (exclusive), collecting assistant text blocks
- Stops after `maxEntries` assistant messages with text content
- Returns concatenated text in chronological order (same pattern as `extractConclusionText`)
- Returns empty string if no text found

This mirrors `extractConclusionText` but operates on the planning phase (before ExitPlanMode) rather than the execution phase (after ExitPlanMode).

### 2. Add `transcript_path` to `HookPayload` in `hooks/capture-plan.ts`

Claude Code already includes `transcript_path` in the hook payload JSON, but the `HookPayload` interface doesn't declare it. Add:

```typescript
interface HookPayload {
  session_id: string;
  transcript_path?: string;  // <-- add
  // ... rest unchanged
}
```

### 3. Transcript fallback in `capture-plan.ts` main flow

After `extractPlanContent` returns null (line 98-102), before exiting:

1. Resolve transcript path: `payload.transcript_path` or `findTranscriptPath(sessionId, payload.cwd)`
2. Parse transcript with `parseTranscript`
3. Find ExitPlanMode with `findExitPlanIndex`
4. Call `extractPlanText(entries, exitIdx)` to get last 3 assistant messages
5. If result >= 20 chars, use it with `source: "transcript"`

Additionally, refactor lines 117-134 to reuse the already-parsed entries when the transcript was read during fallback, avoiding a redundant file read.

### 4. Tests

- `hooks/__tests__/transcript-parsing.test.ts`: Unit tests for `extractPlanText`
  - Returns last 3 assistant text messages before exitIdx
  - Returns empty string when no text before exitIdx
  - Skips tool_use-only entries (no text blocks)
  - Respects maxEntries parameter
  - Returns text in chronological order
- `hooks/__tests__/capture-plan integration`: Verify the fallback path triggers when `tool_response.plan` is null but transcript has content

## Files Modified

- `hooks/transcript.ts` — add `extractPlanText`
- `hooks/capture-plan.ts` — add `transcript_path` to HookPayload, add fallback logic, refactor stats collection to reuse parsed entries
- `hooks/__tests__/transcript-parsing.test.ts` — tests for `extractPlanText`

## Verification

```bash
bun test transcript-parsing.test.ts   # new extractPlanText tests
bun test                               # full suite regression
bun run check                          # lint + format
```

Manual: enter plan mode, call ExitPlanMode without writing the plan file, verify the hook captures from transcript.
