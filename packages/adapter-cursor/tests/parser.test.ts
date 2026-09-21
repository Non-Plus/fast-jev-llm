import { classifyTool } from "@fast-jev/core";
import { describe, expect, it } from "vitest";
import { parseCursorJsonl } from "../src/parser.js";
import { fixturePath } from "./helpers.js";

describe("Cursor JSONL parsing", () => {
  it("maps observed role/message transcripts and synthesizes tool ids", async () => {
    const parsed = await parseCursorJsonl(fixturePath("observed-transcript.jsonl"), {
      cwd: "/Users/user/project",
      cursorVersion: "3.21.16",
    });
    expect(parsed.malformedLineCount).toBe(0);
    expect(parsed.transcript.messages.some((message) => message.role === "user")).toBe(true);
    const calls = parsed.transcript.messages.flatMap((message) => message.toolCalls ?? []);
    expect(calls.map((call) => call.name)).toEqual(["Read", "Grep", "GetDynamicTools"]);
    expect(calls.every((call) => typeof call.id === "string" && call.id.length > 0)).toBe(true);
    expect(parsed.transcript.messages.filter((message) => message.role === "tool")).toHaveLength(0);
    expect(classifyTool(calls[0]?.name ?? "", calls[0]?.arguments as Record<string, unknown>).kind).toBe(
      "file_read",
    );
    expect(classifyTool(calls[1]?.name ?? "", calls[1]?.arguments as Record<string, unknown>).kind).toBe(
      "command",
    );
    expect(classifyTool(calls[2]?.name ?? "", calls[2]?.arguments as Record<string, unknown>).kind).toBe(
      "other",
    );
  });

  it("pairs documented tool_result parts when present", async () => {
    const parsed = await parseCursorJsonl(fixturePath("conformance/operations.cursor.jsonl"));
    expect(parsed.meta.sessionId).toBe("ops-cursor");
    expect(parsed.meta.cwd).toBe("/Users/user/project");
    expect(parsed.meta.cursorVersion).toBe("3.21.16");
    const callIds = parsed.transcript.messages.flatMap((message) =>
      (message.toolCalls ?? []).map((call) => call.id),
    );
    const resultIds = parsed.transcript.messages
      .filter((message) => message.role === "tool")
      .map((message) => message.toolCallId);
    expect(resultIds).toEqual(callIds);
  });

  it("keeps unpaired tool calls without crashing", async () => {
    const parsed = await parseCursorJsonl(fixturePath("unpaired-tool-call.jsonl"));
    const calls = parsed.transcript.messages.filter((message) => message.toolCalls?.length);
    const results = parsed.transcript.messages.filter((message) => message.role === "tool");
    expect(calls).toHaveLength(1);
    expect(results).toHaveLength(0);
  });

  it("keeps unpaired tool results without crashing", async () => {
    const parsed = await parseCursorJsonl(fixturePath("unpaired-tool-result.jsonl"));
    expect(parsed.transcript.messages.some((message) => message.toolCallId === "missing_call")).toBe(true);
  });

  it("records unknown events and continues", async () => {
    const parsed = await parseCursorJsonl(fixturePath("unknown-event.jsonl"));
    expect(parsed.unknownEvents.map((event) => event.type)).toEqual(["cursor_secret_internal"]);
    expect(parsed.transcript.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
  });

  it("skips malformed lines and continues", async () => {
    const parsed = await parseCursorJsonl(fixturePath("malformed-line.jsonl"));
    expect(parsed.malformedLineCount).toBe(1);
    expect(parsed.transcript.messages.some((message) => message.role === "user")).toBe(true);
  });

  it("ignores extra future fields on tool_use", async () => {
    const parsed = await parseCursorJsonl({
      events: [
        {
          type: "session_meta",
          session_id: "future",
          cwd: "/Users/user/project",
          extra_vendor_field: { nested: true },
        },
        {
          role: "assistant",
          message: {
            content: [
              {
                type: "tool_use",
                id: "tu1",
                name: "Read",
                input: { path: "src/auth.ts", futureFlag: true },
                futureToolField: 12,
              },
            ],
          },
        },
      ],
    });
    expect(parsed.transcript.messages[0]?.toolCalls?.[0]?.arguments).toMatchObject({
      path: "src/auth.ts",
    });
    expect(parsed.malformedLineCount).toBe(0);
  });
});
