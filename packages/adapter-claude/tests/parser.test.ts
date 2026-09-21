import { classifyTool } from "@fast-jev/core";
import { describe, expect, it } from "vitest";
import { parseClaudeJsonl } from "../src/parser.js";
import { fixturePath } from "./helpers.js";

describe("Claude JSONL parsing", () => {
  it("maps observed Claude transcripts with session metadata and simultaneous tools", async () => {
    const parsed = await parseClaudeJsonl(fixturePath("observed-transcript.jsonl"));
    expect(parsed.malformedLineCount).toBe(0);
    expect(parsed.meta.sessionId).toBe("observed-claude");
    expect(parsed.meta.cwd).toBe("/Users/user/project");
    expect(parsed.meta.claudeVersion).toBe("2.1.251");
    expect(parsed.meta.model).toBe("claude-opus-4-8");
    expect(parsed.transcript.messages.some((message) => message.role === "user")).toBe(true);
    const calls = parsed.transcript.messages.flatMap((message) => message.toolCalls ?? []);
    expect(calls.map((call) => call.name)).toEqual(["Read", "Grep", "Bash"]);
    expect(calls.map((call) => call.id)).toEqual([
      "toolu_obs_read",
      "toolu_obs_grep",
      "toolu_obs_bash",
    ]);
    expect(classifyTool(calls[0]?.name ?? "", calls[0]?.arguments as Record<string, unknown>).kind).toBe(
      "file_read",
    );
    expect(classifyTool(calls[1]?.name ?? "", calls[1]?.arguments as Record<string, unknown>).kind).toBe(
      "command",
    );
    expect(classifyTool(calls[2]?.name ?? "", calls[2]?.arguments as Record<string, unknown>).kind).toBe(
      "git_status",
    );
  });

  it("pairs documented tool_use_id values and ignores queue/mode events", async () => {
    const parsed = await parseClaudeJsonl(fixturePath("conformance/operations.claude.jsonl"));
    expect(parsed.meta.sessionId).toBe("ops-claude");
    expect(parsed.meta.cwd).toBe("/Users/user/project");
    expect(parsed.meta.claudeVersion).toBe("2.1.251");
    expect(parsed.meta.gitBranch).toBe("main");
    const callIds = parsed.transcript.messages.flatMap((message) =>
      (message.toolCalls ?? []).map((call) => call.id),
    );
    const resultIds = parsed.transcript.messages
      .filter((message) => message.role === "tool")
      .map((message) => message.toolCallId);
    expect(resultIds).toEqual(callIds);
    expect(parsed.unknownEvents).toEqual([]);
  });

  it("pairs simultaneous calls by id even when results arrive out of order", async () => {
    const parsed = await parseClaudeJsonl(fixturePath("simultaneous-tool-calls.jsonl"));
    const byId = new Map(
      parsed.transcript.messages
        .filter((message) => message.role === "tool")
        .map((message) => [message.toolCallId, message.content]),
    );
    expect(byId.get("toolu_a")).toBe("file a");
    expect(byId.get("toolu_b")).toBe("file b");
  });

  it("keeps unpaired tool calls without crashing", async () => {
    const parsed = await parseClaudeJsonl(fixturePath("unpaired-tool-call.jsonl"));
    const calls = parsed.transcript.messages.filter((message) => message.toolCalls?.length);
    const results = parsed.transcript.messages.filter((message) => message.role === "tool");
    expect(calls).toHaveLength(1);
    expect(results).toHaveLength(0);
  });

  it("keeps orphan tool results without crashing", async () => {
    const parsed = await parseClaudeJsonl(fixturePath("unpaired-tool-result.jsonl"));
    expect(parsed.transcript.messages.some((message) => message.toolCallId === "missing_call")).toBe(
      true,
    );
  });

  it("keeps interrupted calls without synthesizing a result", async () => {
    const parsed = await parseClaudeJsonl(fixturePath("interrupted-tool-call.jsonl"));
    expect(parsed.transcript.messages.some((message) => message.toolCalls?.[0]?.id === "toolu_int")).toBe(
      true,
    );
    expect(parsed.transcript.messages.some((message) => message.toolCallId === "toolu_int")).toBe(false);
  });

  it("retains large tool results", async () => {
    const parsed = await parseClaudeJsonl(fixturePath("large-tool-result.jsonl"));
    const result = parsed.transcript.messages.find((message) => message.toolCallId === "toolu_large");
    expect(result?.content.length).toBeGreaterThan(4000);
  });

  it("records unknown events and continues", async () => {
    const parsed = await parseClaudeJsonl(fixturePath("unknown-event.jsonl"));
    expect(parsed.unknownEvents.map((event) => event.type)).toEqual(["claude_secret_internal"]);
    expect(parsed.transcript.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
  });

  it("skips malformed lines and continues", async () => {
    const parsed = await parseClaudeJsonl(fixturePath("malformed-line.jsonl"));
    expect(parsed.malformedLineCount).toBe(1);
    expect(parsed.transcript.messages.some((message) => message.role === "user")).toBe(true);
  });

  it("does not invent pairings from adjacency when ids are missing", async () => {
    const parsed = await parseClaudeJsonl({
      events: [
        {
          type: "assistant",
          sessionId: "no-id",
          cwd: "/Users/user/project",
          version: "2.1.251",
          message: {
            role: "assistant",
            content: [{ type: "tool_use", name: "Read", input: { file_path: "src/a.ts" } }],
          },
        },
        {
          type: "user",
          sessionId: "no-id",
          cwd: "/Users/user/project",
          message: {
            role: "user",
            content: [{ type: "tool_result", content: "should not steal neighbor id" }],
          },
        },
      ],
    });
    const call = parsed.transcript.messages.find((message) => message.toolCalls?.length);
    const result = parsed.transcript.messages.find((message) => message.role === "tool");
    expect(call?.toolCalls?.[0]?.id).toBeTruthy();
    expect(result?.toolCallId).toBeTruthy();
    expect(result?.toolCallId).not.toBe(call?.toolCalls?.[0]?.id);
  });

  it("marks observed compact_boundary without treating it as conversation content", async () => {
    const parsed = await parseClaudeJsonl({
      events: [
        {
          type: "user",
          sessionId: "compacted",
          message: { role: "user", content: [{ type: "text", text: "Hello" }] },
        },
        { type: "system", subtype: "compact_boundary", sessionId: "compacted" },
      ],
    });
    expect(parsed.meta.observedClaudeCompaction).toBe(true);
    expect(parsed.transcript.messages.map((message) => message.role)).toEqual(["user"]);
  });
});
