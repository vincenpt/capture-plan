import type { ContentBlock, TranscriptEntry } from "../../transcript.ts";

/** Factory for building assistant transcript entries in tests. */
export function assistantEntry(
  overrides: Partial<TranscriptEntry> & { tools?: { name: string; id?: string }[] } = {},
): TranscriptEntry {
  const { tools, model, message: msgOverride, ...rest } = overrides;
  const content = tools
    ? tools.map((t) => ({ type: "tool_use" as const, name: t.name, id: t.id ?? t.name }))
    : [{ type: "text" as const, text: "some response" }];
  const message = msgOverride
    ? { model, ...msgOverride }
    : {
        role: "assistant" as const,
        model,
        content,
        usage: { input_tokens: 100, output_tokens: 50 },
      };
  return {
    type: "assistant",
    timestamp: "2026-03-30T14:00:00.000Z",
    message,
    ...rest,
  };
}

/** Factory for an assistant entry containing a Write tool_use. */
export function writeEntry(
  filePath: string,
  content = "# Test Content\n\nBody text.",
  overrides: Partial<TranscriptEntry> = {},
): TranscriptEntry {
  const block: ContentBlock = {
    type: "tool_use",
    name: "Write",
    id: `write-${filePath.split("/").pop()}`,
    input: { file_path: filePath, content },
  };
  return {
    type: "assistant",
    timestamp: "2026-03-30T14:00:00.000Z",
    message: {
      role: "assistant",
      content: [block],
      usage: { input_tokens: 100, output_tokens: 50 },
    },
    ...overrides,
  };
}

/** Factory for building human transcript entries in tests. */
export function humanEntry(
  overrides: Partial<TranscriptEntry> & {
    toolResults?: { tool_use_id: string; is_error?: boolean }[];
  } = {},
): TranscriptEntry {
  const { toolResults, ...rest } = overrides;
  const content = toolResults
    ? toolResults.map((r) => ({
        type: "tool_result" as const,
        tool_use_id: r.tool_use_id,
        ...(r.is_error ? { is_error: true as const } : {}),
      }))
    : [{ type: "text" as const, text: "user message" }];
  return {
    type: "human",
    timestamp: "2026-03-30T14:01:00.000Z",
    message: { role: "user", content },
    ...rest,
  };
}
