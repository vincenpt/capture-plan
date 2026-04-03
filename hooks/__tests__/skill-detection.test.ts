import { describe, expect, it } from "bun:test";
import type { TranscriptEntry } from "../transcript.ts";
import { findSkillInvocations } from "../transcript.ts";
import { assistantEntry, humanEntry, skillEntry } from "./helpers/transcript-helpers.ts";

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
    const entries: TranscriptEntry[] = [skillEntry("simplify", "--verbose")];
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
    const entries: TranscriptEntry[] = [skillEntry("simplify")];
    const result = findSkillInvocations(entries);
    expect(result[0].contextAfter).toBe("");
  });

  it("returns empty contextBefore when skill has no preceding text", () => {
    const entries: TranscriptEntry[] = [skillEntry("simplify")];
    const result = findSkillInvocations(entries);
    expect(result[0].contextBefore).toBe("");
  });
});
