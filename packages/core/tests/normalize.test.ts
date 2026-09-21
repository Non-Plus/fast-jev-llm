import { describe, expect, it } from "vitest";
import { normalizeTranscript } from "../src/normalize.js";
import { DEFAULT_CONFIG } from "../src/pipeline.js";
import { message, transcript } from "./helpers.js";

describe("normalizeTranscript", () => {
  it("pairs assistant tool calls with subsequent tool results", () => {
    const items = normalizeTranscript(
      transcript([
        message("m1", "user", "read the file"),
        {
          id: "m2",
          role: "assistant",
          content: "Opening it.",
          toolCalls: [{ id: "c1", name: "Read", arguments: { path: "a.ts" } }],
        },
        {
          id: "m3",
          role: "tool",
          toolCallId: "c1",
          name: "Read",
          content: "export const a = 1;",
        },
      ]),
      DEFAULT_CONFIG,
    );

    expect(items.map((item) => item.kind)).toEqual(["message", "message", "tool_pair"]);
    const pair = items[2];
    expect(pair?.tool?.kind).toBe("file_read");
    expect(pair?.tool?.path).toBe("a.ts");
    expect(pair?.messageIds).toEqual(["m2", "m3"]);
    expect(pair?.content).toContain("export const a = 1;");
  });

  it("pairs tools from content parts", () => {
    const items = normalizeTranscript(
      transcript([
        {
          id: "m1",
          role: "assistant",
          content: [
            { type: "text", text: "running" },
            {
              type: "tool_call",
              toolCall: { id: "c1", name: "Shell", arguments: { command: "git status" } },
            },
          ],
        },
        {
          id: "m2",
          role: "assistant",
          content: [
            {
              type: "tool_result",
              toolResult: { toolCallId: "c1", content: "clean" },
            },
          ],
        },
      ]),
      DEFAULT_CONFIG,
    );

    expect(items).toHaveLength(2);
    expect(items[0]?.kind).toBe("message");
    expect(items[1]?.tool?.kind).toBe("git_status");
  });

  it("emits unpaired calls and results", () => {
    const items = normalizeTranscript(
      transcript([
        {
          id: "m1",
          role: "assistant",
          content: "",
          toolCalls: [{ id: "c1", name: "Read", arguments: { path: "missing.ts" } }],
        },
        {
          id: "m2",
          role: "tool",
          toolCallId: "orphan",
          content: "no matching call",
        },
      ]),
      DEFAULT_CONFIG,
    );

    expect(items.map((item) => item.kind)).toEqual([
      "unpaired_tool_result",
      "unpaired_tool_call",
    ]);
  });

  it("assigns stable item ids and token counts", () => {
    const items = normalizeTranscript(
      transcript([message("m1", "user", "abcd")]),
      DEFAULT_CONFIG,
    );
    expect(items[0]?.id).toBe("item-000");
    expect(items[0]?.tokenCount).toBe(1);
  });

  it("does not mutate the input transcript", () => {
    const input = transcript([message("m1", "user", "hello")]);
    const before = JSON.stringify(input);
    normalizeTranscript(input, DEFAULT_CONFIG);
    expect(JSON.stringify(input)).toBe(before);
  });
});
