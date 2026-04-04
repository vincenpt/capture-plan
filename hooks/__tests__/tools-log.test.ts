import { describe, expect, it } from "bun:test";
import {
  aggregateSidechainStats,
  formatAskUserQuestion,
  formatToolArgs,
  formatToolsLogContent,
} from "../shared.ts";
import type { ToolLog, TurnLogEntry } from "../transcript.ts";

describe("formatToolArgs", () => {
  it("formats file_path as table with backticks", () => {
    const { table, codeFence } = formatToolArgs("Read", { file_path: "/src/foo.ts" });
    expect(table).toContain("| **Read** | |");
    expect(table).toContain("| file_path | `/src/foo.ts` |");
    expect(codeFence).toBe("");
  });

  it("puts each arg on its own table row", () => {
    const { table } = formatToolArgs("Grep", { pattern: "hello", path: "/src" });
    expect(table).toContain("| pattern | hello |");
    expect(table).toContain("| path | `/src` |");
  });

  it("truncates long string values", () => {
    const longVal = "a".repeat(150);
    const { table } = formatToolArgs("Agent", { description: longVal });
    expect(table).toContain("a".repeat(60));
    expect(table).toContain("… [150 total]");
  });

  it("shows length only for old_string and new_string", () => {
    const { table } = formatToolArgs("Edit", {
      old_string: "original code here",
      new_string: "replacement code here",
    });
    expect(table).toContain("| old_string | [18 chars] |");
    expect(table).toContain("| new_string | [21 chars] |");
  });

  it("handles boolean and number values with backticks", () => {
    const { table } = formatToolArgs("Grep", { multiline: true, offset: 42 });
    expect(table).toContain("| multiline | `true` |");
    expect(table).toContain("| offset | `42` |");
  });

  it("handles object values with JSON stringification", () => {
    const { table } = formatToolArgs("SomeTool", { options: { a: 1 } });
    expect(table).toContain('| options | {"a":1} |');
  });

  it("skips null and undefined values", () => {
    const { table } = formatToolArgs("Read", {
      file_path: "/src/foo.ts",
      extra: null,
      missing: undefined,
    });
    expect(table).toContain("| file_path | `/src/foo.ts` |");
    expect(table).not.toContain("extra");
    expect(table).not.toContain("missing");
  });

  it("returns empty table and codeFence for empty input", () => {
    const { table, codeFence } = formatToolArgs("Read", {});
    expect(table).toBe("");
    expect(codeFence).toBe("");
  });

  it("renders Bash command as separate code fence", () => {
    const { table, codeFence } = formatToolArgs("Bash", {
      command: "bun test 2>&1 | tail -30",
    });
    expect(table).toBe("");
    expect(codeFence).toBe("```sh\nbun test 2>&1 | tail -30\n```");
  });

  it("renders Bash args in table and command in code fence", () => {
    const { table, codeFence } = formatToolArgs("Bash", {
      command: "ls -la",
      description: "List files",
      timeout: 30000,
    });
    expect(table).toContain("| description | List files |");
    expect(table).toContain("| timeout | `30000` |");
    expect(codeFence).toBe("```sh\nls -la\n```");
  });

  it("escapes pipe characters in table cells", () => {
    const { table } = formatToolArgs("Grep", { pattern: "foo|bar" });
    expect(table).toContain("| pattern | foo\\|bar |");
  });

  it("preserves full Agent prompt without truncation", () => {
    const longPrompt = "Search for ".repeat(20); // 220 chars, over ARG_MAX_LEN
    const { table } = formatToolArgs("Agent", { prompt: longPrompt });
    expect(table).toContain(longPrompt.replace(/\|/g, "\\|"));
    expect(table).not.toContain("… [");
  });

  it("renders Agent prompt newlines as <br>", () => {
    const { table } = formatToolArgs("Agent", { prompt: "line one\nline two\nline three" });
    expect(table).toContain("line one<br>line two<br>line three");
  });

  it("extracts only plan title for ExitPlanMode", () => {
    const planContent = "# My Great Plan\n\nSome details here\n- step 1\n- step 2";
    const { table } = formatToolArgs("ExitPlanMode", {
      plan: planContent,
      allowedPrompts: [{ tool: "Bash", prompt: "run tests" }],
    });
    expect(table).toContain("| plan | My Great Plan |");
    expect(table).not.toContain("allowedPrompts");
    expect(table).not.toContain("Some details");
  });

  it("renders Write content as 5-line head code fence", () => {
    const content = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n");
    const { table, codeFence } = formatToolArgs("Write", {
      file_path: "/src/app.ts",
      content,
    });
    expect(table).toContain("| file_path | `/src/app.ts` |");
    expect(table).not.toContain("content");
    expect(codeFence).toContain("```typescript");
    expect(codeFence).toContain("line 1");
    expect(codeFence).toContain("line 5");
    expect(codeFence).not.toContain("line 6");
    expect(codeFence).toContain("... [truncated, 20 lines total]");
  });

  it("renders Write content without truncation when ≤5 lines", () => {
    const content = "line 1\nline 2\nline 3";
    const { codeFence } = formatToolArgs("Write", {
      file_path: "/src/app.ts",
      content,
    });
    expect(codeFence).toContain("line 3");
    expect(codeFence).not.toContain("truncated");
  });

  it("renders ctx_execute code in language-typed fence", () => {
    const { table, codeFence } = formatToolArgs("mcp__ctx_execute", {
      language: "python",
      code: "print('hello')",
    });
    expect(codeFence).toBe("```python\nprint('hello')\n```");
    expect(table).not.toContain("language");
    expect(table).not.toContain("code");
  });

  it("backticks code-like values (paths, globs, enums)", () => {
    const { table } = formatToolArgs("Glob", { pattern: "src/**/*.ts" });
    expect(table).toContain("| pattern | `src/**/*.ts` |");
  });

  it("backticks subagent_type values", () => {
    const { table } = formatToolArgs("Agent", {
      subagent_type: "Explore",
      description: "Find things",
    });
    expect(table).toContain("| subagent_type | `Explore` |");
  });

  it("detects file-extension-like values as code", () => {
    const { table } = formatToolArgs("SomeTool", { glob: "*.tsx" });
    expect(table).toContain("| glob | `*.tsx` |");
  });

  it("replaces Agent prompt with wikilink when agentPromptLink provided", () => {
    const { table } = formatToolArgs(
      "Agent",
      { prompt: "Full markdown prompt content...", description: "Explore hooks" },
      { agentPromptLink: "[[plan/agents/7-1-explore-hooks\\|Explore hooks]]" },
    );
    expect(table).toContain("[[plan/agents/7-1-explore-hooks\\|Explore hooks]]");
    expect(table).not.toContain("Full markdown prompt content");
  });

  it("includes error mark in table header when provided", () => {
    const { table } = formatToolArgs("Grep", { pattern: "hello" }, { errorMark: " ❌" });
    expect(table).toContain("| **Grep** ❌ | |");
  });

  it("omits error mark from table header when not provided", () => {
    const { table } = formatToolArgs("Grep", { pattern: "hello" });
    expect(table).toContain("| **Grep** | |");
    expect(table).not.toContain("❌");
  });
});

describe("formatAskUserQuestion", () => {
  const singleQuestion = {
    questions: [
      {
        question: "Which component pattern should we use for the widget?",
        header: "Pattern",
        options: [
          { label: "Functional (Recommended)", description: "Stateless functional component" },
          { label: "Class-based", description: "Traditional class component" },
        ],
        multiSelect: false,
      },
    ],
  };

  it("renders question text in italics in table value column", () => {
    const { table } = formatAskUserQuestion(singleQuestion);
    expect(table).toContain(
      "| question | *Which component pattern should we use for the widget?* |",
    );
  });

  it("renders header field in table when present", () => {
    const { table } = formatAskUserQuestion(singleQuestion);
    expect(table).toContain("| header | Pattern |");
  });

  it("renders AskUserQuestion in bold in table header", () => {
    const { table } = formatAskUserQuestion(singleQuestion);
    expect(table).toContain("| **AskUserQuestion** | |");
  });

  it("renders choices with selected answer checked", () => {
    const { codeFence } = formatAskUserQuestion(singleQuestion, {
      answer: "Functional (Recommended)",
    });
    expect(codeFence).toContain("- [x] **Functional (Recommended)** -- Stateless functional");
    expect(codeFence).toContain("- [ ] Class-based -- Traditional class component");
  });

  it("renders all choices unchecked when no answer provided", () => {
    const { codeFence } = formatAskUserQuestion(singleQuestion);
    expect(codeFence).toContain("- [ ] Functional (Recommended)");
    expect(codeFence).toContain("- [ ] Class-based");
    expect(codeFence).not.toContain("[x]");
  });

  it("renders all choices unchecked when answer does not match any option", () => {
    const { codeFence } = formatAskUserQuestion(singleQuestion, { answer: "Other" });
    expect(codeFence).not.toContain("[x]");
  });

  it("truncates long question text", () => {
    const longQ = {
      questions: [{ question: "A".repeat(150), options: [] }],
    };
    const { table } = formatAskUserQuestion(longQ);
    expect(table).toContain("A".repeat(120));
    expect(table).toContain("...*");
    expect(table).not.toContain("A".repeat(150));
  });

  it("handles question with no options", () => {
    const noOpts = { questions: [{ question: "What name?" }] };
    const { table, codeFence } = formatAskUserQuestion(noOpts);
    expect(table).toContain("*What name?*");
    expect(codeFence).toBe("");
  });

  it("handles options without descriptions", () => {
    const noDesc = {
      questions: [{ question: "Pick one", options: [{ label: "A" }, { label: "B" }] }],
    };
    const { codeFence } = formatAskUserQuestion(noDesc, { answer: "A" });
    expect(codeFence).toContain("- [x] **A**");
    expect(codeFence).toContain("- [ ] B");
    expect(codeFence).not.toContain("--");
  });

  it("renders multiple questions as separate table+choices blocks", () => {
    const multi = {
      questions: [
        { question: "First?", options: [{ label: "A" }, { label: "B" }] },
        { question: "Second?", options: [{ label: "X" }, { label: "Y" }] },
      ],
    };
    const { table, codeFence } = formatAskUserQuestion(multi);
    expect(table).toContain("*First?*");
    expect(table).toContain("*Second?*");
    expect(codeFence).toContain("- [ ] A");
    expect(codeFence).toContain("- [ ] X");
  });

  it("falls back to generic formatting for unparseable questions", () => {
    const invalid = { questions: "not an array" };
    const { table } = formatAskUserQuestion(invalid);
    expect(table).toContain("| **AskUserQuestion** | |");
    expect(table).toContain("| questions | not an array |");
  });

  it("includes error mark in table header", () => {
    const { table } = formatAskUserQuestion(singleQuestion, { errorMark: " ❌" });
    expect(table).toContain("| **AskUserQuestion** ❌ | |");
  });

  it("escapes pipe characters in question and option text", () => {
    const pipes = {
      questions: [
        {
          question: "Use foo|bar?",
          options: [{ label: "opt|A", description: "desc|val" }],
        },
      ],
    };
    const { table, codeFence } = formatAskUserQuestion(pipes, { answer: "opt|A" });
    expect(table).toContain("foo\\|bar");
    expect(codeFence).toContain("opt\\|A");
    expect(codeFence).toContain("desc\\|val");
  });
});

describe("formatToolsLogContent", () => {
  const baseLogOpts = {
    planTitle: "My Plan",
    planDir: "Claude/Plans/2026/03-30/001-my-plan",
    journalPath: "Daily/2026/03-30",
    datetime: "2026-03-30 2:00 PM",
    project: "test-project",
  };

  const makeTurnLog = (overrides?: Partial<ToolLog>): ToolLog => ({
    turns: [
      {
        turnNumber: 1,
        timestamp: "2026-03-30T14:00:00.000Z",
        durationMs: 3000,
        tokensIn: 1200,
        tokensOut: 500,
        justification: "Checking the implementation",
        tools: [
          { seq: 1, name: "Read", input: { file_path: "/src/foo.ts" }, isError: false },
          { seq: 2, name: "Grep", input: { pattern: "hello" }, isError: true },
        ],
        isSidechain: false,
      },
    ],
    totalToolCalls: 2,
    totalErrors: 1,
    ...overrides,
  });

  it("returns null when both phases are null", () => {
    expect(formatToolsLogContent({ ...baseLogOpts, planLog: null, execLog: null })).toBeNull();
  });

  it("includes frontmatter with correct stats", () => {
    const result = formatToolsLogContent({
      ...baseLogOpts,
      planLog: makeTurnLog(),
      execLog: null,
    });
    const md = result?.markdown ?? "";
    expect(md).toContain("total_tool_calls: 2");
    expect(md).toContain("total_errors: 1");
    expect(md).toContain("total_turns: 1");
    expect(md).toContain("planning_calls: 2");
    expect(md).not.toContain("execution_calls:");
    expect(md).toContain("project: test-project");
  });

  it("includes plan backlink in frontmatter", () => {
    const result = formatToolsLogContent({
      ...baseLogOpts,
      planLog: makeTurnLog(),
      execLog: null,
    });
    expect(result?.markdown).toContain("[[Claude/Plans/2026/03-30/001-my-plan/plan|My Plan]]");
  });

  it("renders planning phase with turn headers and block references", () => {
    const result = formatToolsLogContent({
      ...baseLogOpts,
      planLog: makeTurnLog(),
      execLog: null,
    });
    const md = result?.markdown ?? "";
    expect(md).toContain("## Planning Phase");
    expect(md).toContain("### Turn 1: Read, Grep");
    expect(md).toContain("3.0s");
    expect(md).toContain("1,200 in");
    expect(md).toContain("500 out");
    expect(md).toContain("^turn-1");
  });

  it("renders justification as blockquote", () => {
    const result = formatToolsLogContent({
      ...baseLogOpts,
      planLog: makeTurnLog(),
      execLog: null,
    });
    expect(result?.markdown).toContain("> Checking the implementation");
  });

  it("renders tool names in heading and error mark in table header", () => {
    const result = formatToolsLogContent({
      ...baseLogOpts,
      planLog: makeTurnLog(),
      execLog: null,
    });
    const md = result?.markdown ?? "";
    // Tool names in turn heading
    expect(md).toContain("### Turn 1: Read, Grep");
    // Bold tool names in table headers
    expect(md).toContain("| **Read** | |");
    expect(md).toContain("| **Grep** ❌ | |");
    // Table args still present
    expect(md).toContain("| file_path | `/src/foo.ts` |");
    expect(md).toContain("| pattern | hello |");
  });

  it("renders both phases", () => {
    const result = formatToolsLogContent({
      ...baseLogOpts,
      planLog: makeTurnLog(),
      execLog: makeTurnLog({
        turns: [
          {
            turnNumber: 1,
            timestamp: "2026-03-30T14:05:00.000Z",
            durationMs: 1000,
            tokensIn: 500,
            tokensOut: 200,
            justification: "",
            tools: [{ seq: 3, name: "Edit", input: { file_path: "a.ts" }, isError: false }],
            isSidechain: false,
          },
        ],
        totalToolCalls: 1,
        totalErrors: 0,
      }),
    });
    const md = result?.markdown ?? "";
    expect(md).toContain("## Planning Phase");
    expect(md).toContain("## Execution Phase");
    expect(md).toContain("total_tool_calls: 3");
    expect(md).toContain("planning_calls: 2");
    expect(md).toContain("execution_calls: 1");
  });

  it("marks subagent turns with sidechain indicator", () => {
    const log = makeTurnLog({
      turns: [
        {
          turnNumber: 1,
          timestamp: "2026-03-30T14:00:00.000Z",
          durationMs: 1000,
          tokensIn: 100,
          tokensOut: 50,
          justification: "",
          tools: [{ seq: 1, name: "Bash", input: { command: "ls" }, isError: false }],
          isSidechain: true,
          agentId: "sub-1",
        },
      ],
      totalToolCalls: 1,
      totalErrors: 0,
    });
    const result = formatToolsLogContent({
      ...baseLogOpts,
      planLog: null,
      execLog: log,
    });
    const md = result?.markdown ?? "";
    expect(md).toContain("🔀");
    expect(md).toContain("*Subagent: sub-1*");
  });

  it("includes title in heading", () => {
    const result = formatToolsLogContent({
      ...baseLogOpts,
      planLog: makeTurnLog(),
      execLog: null,
    });
    expect(result?.markdown).toContain("# Tool Log: My Plan");
  });

  it("includes cc_version when provided", () => {
    const result = formatToolsLogContent({
      ...baseLogOpts,
      planLog: makeTurnLog(),
      execLog: null,
      ccVersion: "1.0.30",
    });
    expect(result?.markdown).toContain('cc_version: "1.0.30"');
  });

  it("includes model when provided", () => {
    const result = formatToolsLogContent({
      ...baseLogOpts,
      planLog: makeTurnLog(),
      execLog: null,
      model: "claude-opus-4-6",
    });
    expect(result?.markdown).toContain("model: claude-opus-4-6");
  });

  it("returns empty agentFiles when no Agent tools present", () => {
    const result = formatToolsLogContent({
      ...baseLogOpts,
      planLog: makeTurnLog(),
      execLog: null,
    });
    expect(result?.agentFiles).toEqual([]);
  });

  it("collects agent files with frontmatter and replaces prompt with wikilink", () => {
    const log: ToolLog = {
      turns: [
        {
          turnNumber: 7,
          timestamp: "2026-03-30T14:00:00.000Z",
          durationMs: 5000,
          tokensIn: 31167,
          tokensOut: 1332,
          justification: "",
          tools: [
            {
              seq: 1,
              name: "Agent",
              input: {
                subagent_type: "Plan",
                description: "Explore hooks and config",
                prompt: "# Full markdown\n\nWith **bold** and lists\n- item 1",
              },
              isError: false,
            },
          ],
          isSidechain: false,
        },
      ],
      totalToolCalls: 1,
      totalErrors: 0,
    };
    const result = formatToolsLogContent({
      ...baseLogOpts,
      planLog: null,
      execLog: log,
    });
    expect(result).not.toBeNull();
    // Agent file collected
    expect(result?.agentFiles).toHaveLength(1);
    expect(result?.agentFiles[0].path).toBe(
      "Claude/Plans/2026/03-30/001-my-plan/agents/7-plan-my-plan",
    );
    // Content includes frontmatter followed by prompt
    const content = result?.agentFiles[0].content ?? "";
    expect(content).toMatch(/^---\n/);
    expect(content).toContain("# Full markdown");
    expect(content).toContain("subagent_type: plan");
    expect(content).toContain('description: "Explore hooks and config"');
    expect(content).toContain("dispatched_at:");
    expect(content).toContain("tools-log#^turn-7|Turn 7");
    expect(content).toContain("[[Daily/2026/03-30|2026-03-30 2:00 PM]]");
    expect(content).toContain("[[Claude/Plans/2026/03-30/001-my-plan/plan|My Plan]]");
    // Wikilink in markdown
    expect(result?.markdown).toContain(
      "[[Claude/Plans/2026/03-30/001-my-plan/agents/7-plan-my-plan\\|Explore hooks and config]]",
    );
    // Original prompt text NOT in markdown
    expect(result?.markdown).not.toContain("With **bold** and lists");
    // Description skipped when prompt link present
    expect(result?.markdown).not.toContain("| description |");
    // Agent table header is bolded
    expect(result?.markdown).toContain("| **Agent** | |");
    // Tool name in heading with block ref
    expect(result?.markdown).toContain("### Turn 7: Agent");
    expect(result?.markdown).toContain("^turn-7");
  });

  it("uses fallback slug when Agent has no description and omits description from frontmatter", () => {
    const log: ToolLog = {
      turns: [
        {
          turnNumber: 3,
          timestamp: "2026-03-30T14:00:00.000Z",
          durationMs: 1000,
          tokensIn: 100,
          tokensOut: 50,
          justification: "",
          tools: [
            {
              seq: 1,
              name: "Agent",
              input: { prompt: "Do something" },
              isError: false,
            },
          ],
          isSidechain: false,
        },
      ],
      totalToolCalls: 1,
      totalErrors: 0,
    };
    const result = formatToolsLogContent({
      ...baseLogOpts,
      planLog: null,
      execLog: log,
    });
    expect(result?.agentFiles[0].path).toContain("agents/3-agent-my-plan");
    expect(result?.markdown).toContain("\\|agent-prompt]]");
    // Frontmatter should NOT include description when using default fallback
    const content = result?.agentFiles[0].content ?? "";
    expect(content).toContain("subagent_type: agent");
    expect(content).not.toContain("description:");
  });

  it("agent frontmatter includes sidechain stats when blockId matches", () => {
    const log: ToolLog = {
      turns: [
        {
          turnNumber: 5,
          timestamp: "2026-03-30T14:00:00.000Z",
          durationMs: 2000,
          tokensIn: 5000,
          tokensOut: 1000,
          justification: "",
          tools: [
            {
              seq: 1,
              name: "Agent",
              input: {
                subagent_type: "Explore",
                description: "Search codebase",
                prompt: "Find all tests",
              },
              isError: false,
              blockId: "toolu_abc123",
            },
          ],
          isSidechain: false,
        },
        {
          turnNumber: 6,
          timestamp: "2026-03-30T14:00:02.000Z",
          durationMs: 3000,
          tokensIn: 8000,
          tokensOut: 2000,
          justification: "",
          tools: [
            { seq: 2, name: "Glob", input: { pattern: "**/*.ts" }, isError: false },
            { seq: 3, name: "Read", input: { file_path: "a.ts" }, isError: false },
          ],
          isSidechain: true,
          agentId: "toolu_abc123",
        },
        {
          turnNumber: 7,
          timestamp: "2026-03-30T14:00:05.000Z",
          durationMs: 1500,
          tokensIn: 4000,
          tokensOut: 800,
          justification: "",
          tools: [{ seq: 4, name: "Grep", input: { pattern: "test" }, isError: false }],
          isSidechain: true,
          agentId: "toolu_abc123",
        },
      ],
      totalToolCalls: 4,
      totalErrors: 0,
    };
    const result = formatToolsLogContent({
      ...baseLogOpts,
      planLog: null,
      execLog: log,
      model: "claude-opus-4-6",
    });
    const content = result?.agentFiles[0].content ?? "";
    expect(content).toContain("tokens_in: 12000");
    expect(content).toContain("tokens_out: 2800");
    expect(content).toContain("tool_calls: 3");
    expect(content).toContain("sidechain_turns: 2");
    expect(content).toContain('duration: "4.5s"');
    expect(content).toContain("model: claude-opus-4-6");
  });

  it("agent frontmatter omits sidechain stats when no matching turns", () => {
    const log: ToolLog = {
      turns: [
        {
          turnNumber: 2,
          timestamp: "2026-03-30T14:00:00.000Z",
          durationMs: 1000,
          tokensIn: 500,
          tokensOut: 200,
          justification: "",
          tools: [
            {
              seq: 1,
              name: "Agent",
              input: { subagent_type: "Plan", description: "Design", prompt: "Plan it" },
              isError: false,
              blockId: "toolu_no_match",
            },
          ],
          isSidechain: false,
        },
      ],
      totalToolCalls: 1,
      totalErrors: 0,
    };
    const result = formatToolsLogContent({
      ...baseLogOpts,
      planLog: null,
      execLog: log,
    });
    const content = result?.agentFiles[0].content ?? "";
    expect(content).toContain("subagent_type: plan");
    expect(content).not.toContain("tokens_in:");
    expect(content).not.toContain("sidechain_turns:");
  });

  it("agent frontmatter uses tool.input.model when specified", () => {
    const log: ToolLog = {
      turns: [
        {
          turnNumber: 1,
          timestamp: "2026-03-30T14:00:00.000Z",
          durationMs: 1000,
          tokensIn: 100,
          tokensOut: 50,
          justification: "",
          tools: [
            {
              seq: 1,
              name: "Agent",
              input: { subagent_type: "Explore", prompt: "Search", model: "haiku" },
              isError: false,
            },
          ],
          isSidechain: false,
        },
      ],
      totalToolCalls: 1,
      totalErrors: 0,
    };
    const result = formatToolsLogContent({
      ...baseLogOpts,
      planLog: null,
      execLog: log,
      model: "claude-opus-4-6",
    });
    const content = result?.agentFiles[0].content ?? "";
    // tool.input.model takes priority over session model
    expect(content).toContain("model: haiku");
    expect(content).not.toContain("model: claude-opus-4-6");
  });

  it("agent frontmatter falls back to session model", () => {
    const log: ToolLog = {
      turns: [
        {
          turnNumber: 1,
          timestamp: "2026-03-30T14:00:00.000Z",
          durationMs: 1000,
          tokensIn: 100,
          tokensOut: 50,
          justification: "",
          tools: [
            {
              seq: 1,
              name: "Agent",
              input: { subagent_type: "Explore", prompt: "Search" },
              isError: false,
            },
          ],
          isSidechain: false,
        },
      ],
      totalToolCalls: 1,
      totalErrors: 0,
    };
    const result = formatToolsLogContent({
      ...baseLogOpts,
      planLog: null,
      execLog: log,
      model: "claude-sonnet-4-6",
    });
    const content = result?.agentFiles[0].content ?? "";
    expect(content).toContain("model: claude-sonnet-4-6");
  });

  it("multiple agents in same turn get distinct frontmatter", () => {
    const log: ToolLog = {
      turns: [
        {
          turnNumber: 4,
          timestamp: "2026-03-30T14:00:00.000Z",
          durationMs: 2000,
          tokensIn: 1000,
          tokensOut: 500,
          justification: "",
          tools: [
            {
              seq: 1,
              name: "Agent",
              input: {
                subagent_type: "Explore",
                description: "First agent",
                prompt: "Prompt A",
              },
              isError: false,
              blockId: "toolu_a",
            },
            {
              seq: 2,
              name: "Agent",
              input: {
                subagent_type: "Plan",
                description: "Second agent",
                prompt: "Prompt B",
              },
              isError: false,
              blockId: "toolu_b",
            },
          ],
          isSidechain: false,
        },
        {
          turnNumber: 5,
          timestamp: "2026-03-30T14:00:02.000Z",
          durationMs: 1000,
          tokensIn: 300,
          tokensOut: 100,
          justification: "",
          tools: [{ seq: 3, name: "Read", input: { file_path: "x.ts" }, isError: false }],
          isSidechain: true,
          agentId: "toolu_b",
        },
      ],
      totalToolCalls: 3,
      totalErrors: 0,
    };
    const result = formatToolsLogContent({
      ...baseLogOpts,
      planLog: null,
      execLog: log,
    });
    expect(result?.agentFiles).toHaveLength(2);
    const [first, second] = result?.agentFiles ?? [];
    expect(first.content).toContain("subagent_type: explore");
    expect(first.content).not.toContain("sidechain_turns:");
    expect(second.content).toContain("subagent_type: plan");
    expect(second.content).toContain("sidechain_turns: 1");
    expect(second.content).toContain("tokens_in: 300");
  });

  it("renders AskUserQuestion with question text and checked choices in tools-log", () => {
    const log: ToolLog = {
      turns: [
        {
          turnNumber: 1,
          timestamp: "2026-03-30T14:00:00.000Z",
          durationMs: 5000,
          tokensIn: 2700,
          tokensOut: 250,
          justification: "Before finalizing, I have a question.",
          tools: [
            {
              seq: 1,
              name: "AskUserQuestion",
              input: {
                questions: [
                  {
                    question: "Which pattern should we use?",
                    header: "Pattern",
                    options: [
                      { label: "Functional", description: "With hooks" },
                      { label: "Class-based", description: "Traditional" },
                    ],
                  },
                ],
              },
              isError: false,
              answer: "Functional",
            },
          ],
          isSidechain: false,
        },
      ],
      totalToolCalls: 1,
      totalErrors: 0,
    };
    const result = formatToolsLogContent({
      ...baseLogOpts,
      planLog: log,
      execLog: null,
    });
    const md = result?.markdown ?? "";
    expect(md).toContain("### Turn 1: AskUserQuestion");
    expect(md).toContain("*Which pattern should we use?*");
    expect(md).toContain("| header | Pattern |");
    expect(md).toContain("- [x] **Functional** -- With hooks");
    expect(md).toContain("- [ ] Class-based -- Traditional");
  });

  it("renders AskUserQuestion without answer as all unchecked", () => {
    const log: ToolLog = {
      turns: [
        {
          turnNumber: 1,
          timestamp: "2026-03-30T14:00:00.000Z",
          durationMs: 1000,
          tokensIn: 100,
          tokensOut: 50,
          justification: "",
          tools: [
            {
              seq: 1,
              name: "AskUserQuestion",
              input: {
                questions: [
                  {
                    question: "Pick one",
                    options: [{ label: "A" }, { label: "B" }],
                  },
                ],
              },
              isError: false,
            },
          ],
          isSidechain: false,
        },
      ],
      totalToolCalls: 1,
      totalErrors: 0,
    };
    const result = formatToolsLogContent({
      ...baseLogOpts,
      planLog: null,
      execLog: log,
    });
    const md = result?.markdown ?? "";
    expect(md).toContain("- [ ] A");
    expect(md).toContain("- [ ] B");
    expect(md).not.toContain("[x]");
  });
});

describe("aggregateSidechainStats", () => {
  const makeTurn = (overrides: Partial<TurnLogEntry>): TurnLogEntry => ({
    turnNumber: 1,
    timestamp: "2026-03-30T14:00:00.000Z",
    durationMs: 1000,
    tokensIn: 500,
    tokensOut: 200,
    justification: "",
    tools: [{ seq: 1, name: "Read", input: {}, isError: false }],
    isSidechain: false,
    ...overrides,
  });

  it("sums stats across matching sidechain turns", () => {
    const turns = [
      makeTurn({ isSidechain: true, agentId: "a1", tokensIn: 100, tokensOut: 50, durationMs: 500 }),
      makeTurn({
        turnNumber: 2,
        isSidechain: true,
        agentId: "a1",
        tokensIn: 200,
        tokensOut: 80,
        durationMs: 700,
        tools: [
          { seq: 2, name: "Grep", input: {}, isError: false },
          { seq: 3, name: "Read", input: {}, isError: false },
        ],
      }),
    ];
    const stats = aggregateSidechainStats(turns, "a1");
    expect(stats.tokensIn).toBe(300);
    expect(stats.tokensOut).toBe(130);
    expect(stats.durationMs).toBe(1200);
    expect(stats.toolCalls).toBe(3);
    expect(stats.turnCount).toBe(2);
  });

  it("returns zeros when no turns match", () => {
    const turns = [makeTurn({ isSidechain: true, agentId: "other" })];
    const stats = aggregateSidechainStats(turns, "no-match");
    expect(stats.tokensIn).toBe(0);
    expect(stats.tokensOut).toBe(0);
    expect(stats.turnCount).toBe(0);
  });

  it("ignores non-sidechain turns even with matching agentId", () => {
    const turns = [makeTurn({ isSidechain: false, agentId: "a1", tokensIn: 999 })];
    const stats = aggregateSidechainStats(turns, "a1");
    expect(stats.turnCount).toBe(0);
    expect(stats.tokensIn).toBe(0);
  });

  it("ignores sidechain turns with different agentId", () => {
    const turns = [
      makeTurn({ isSidechain: true, agentId: "a1", tokensIn: 100 }),
      makeTurn({ isSidechain: true, agentId: "a2", tokensIn: 200 }),
    ];
    const stats = aggregateSidechainStats(turns, "a1");
    expect(stats.tokensIn).toBe(100);
    expect(stats.turnCount).toBe(1);
  });
});
