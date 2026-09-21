import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parseCodexJsonl } from "../src/parser.js";
import { fixturePath } from "./helpers.js";

describe("Codex JSONL parsing", () => {
  it("maps a normal session into canonical messages in order", async () => {
    const parsed = await parseCodexJsonl(fixturePath("normal-session.jsonl"));
    expect(parsed.meta.sessionId).toBe("abc123");
    expect(parsed.meta.cwd).toBe("/Users/user/project");
    expect(parsed.meta.model).toBe("gpt-5.4");
    expect(parsed.malformedLineCount).toBe(0);
    expect(parsed.transcript.messages.map((message) => message.role)).toEqual([
      "system",
      "user",
      "assistant",
      "assistant",
      "tool",
      "assistant",
      "tool",
      "assistant",
      "tool",
      "assistant",
      "tool",
      "assistant",
      "tool",
      "assistant",
      "tool",
      "assistant",
      "tool",
      "assistant",
    ]);
    const git = parsed.transcript.messages.find((message) => message.toolCalls?.[0]?.id === "call_git1");
    expect(git?.toolCalls?.[0]?.arguments).toMatchObject({ command: "git status" });
    const relativeRead = parsed.transcript.messages.find(
      (message) => message.toolCalls?.[0]?.id === "call_read1",
    );
    const absoluteRead = parsed.transcript.messages.find(
      (message) => message.toolCalls?.[0]?.id === "call_read2",
    );
    expect(relativeRead?.toolCalls?.[0]?.arguments.path).toBe("src/auth.ts");
    expect(relativeRead?.toolCalls?.[0]?.arguments.originalPath).toBe("./src/auth.ts");
    expect(absoluteRead?.toolCalls?.[0]?.arguments.path).toBe("src/auth.ts");
    expect(absoluteRead?.toolCalls?.[0]?.arguments.originalPath).toBe(
      "/Users/user/project/src/auth.ts",
    );
  });

  it("keeps interrupted tool calls unpaired", async () => {
    const parsed = await parseCodexJsonl(fixturePath("interrupted-tool-call.jsonl"));
    const calls = parsed.transcript.messages.filter((message) => message.toolCalls?.length);
    const results = parsed.transcript.messages.filter((message) => message.role === "tool");
    expect(calls).toHaveLength(1);
    expect(results).toHaveLength(0);
  });

  it("tolerates a missing tool result", async () => {
    const parsed = await parseCodexJsonl(fixturePath("missing-tool-result.jsonl"));
    const callIds = parsed.transcript.messages.flatMap((message) =>
      (message.toolCalls ?? []).map((call) => call.id),
    );
    const resultIds = parsed.transcript.messages
      .filter((message) => message.role === "tool")
      .map((message) => message.toolCallId);
    expect(callIds).toContain("call_missing");
    expect(resultIds).not.toContain("call_missing");
    expect(resultIds).toContain("call_ls");
  });

  it("retains unknown events without crashing", async () => {
    const parsed = await parseCodexJsonl(fixturePath("unknown-event.jsonl"));
    expect(parsed.unknownEvents.map((event) => event.type)).toEqual([
      "mystery_event",
      "response_item",
    ]);
    expect(parsed.transcript.messages.some((message) => message.role === "user")).toBe(true);
  });

  it("skips malformed lines and continues", async () => {
    const parsed = await parseCodexJsonl(fixturePath("malformed-line.jsonl"));
    expect(parsed.malformedLineCount).toBe(2);
    expect(parsed.warnings.some((warning) => warning.kind === "malformed_line")).toBe(true);
    expect(parsed.transcript.messages.map((message) => message.id)).toEqual(["msg_u", "msg_a"]);
  });

  it("preserves unpaired tool results", async () => {
    const parsed = await parseCodexJsonl(fixturePath("unpaired-tool-result.jsonl"));
    const orphan = parsed.transcript.messages.find((message) => message.toolCallId === "call_never_seen");
    expect(orphan?.role).toBe("tool");
    expect(orphan?.content).toContain("orphan tool result");
  });

  it("loads long tool output without requiring a second serialized copy of the file", async () => {
    const path = fixturePath("long-tool-output.jsonl");
    const parsed = await parseCodexJsonl(path);
    const tool = parsed.transcript.messages.find((message) => message.role === "tool");
    expect(tool?.content.length).toBeGreaterThan(40_000);
    const hash = createHash("sha256").update(await readFile(path)).digest("hex");
    expect(hash).toHaveLength(64);
  });

  it("keeps ordering across multiple turns", async () => {
    const parsed = await parseCodexJsonl(fixturePath("multiple-turns.jsonl"));
    const userTexts = parsed.transcript.messages
      .filter((message) => message.role === "user")
      .map((message) => message.content);
    expect(userTexts[0]).toContain("Show git status");
    expect(userTexts[1]).toContain("Run the tests now");
  });

  it("records message origin separately from role", async () => {
    const parsed = await parseCodexJsonl(fixturePath("normal-session.jsonl"));
    const developer = parsed.transcript.messages.find((message) => message.id === "msg_sys");
    const user = parsed.transcript.messages.find((message) => message.id === "msg_102");
    expect(developer?.role).toBe("system");
    expect(developer?.origin).toBe("developer");
    expect(user?.origin).toBe("user");
    expect(developer?.originVendor).toBe("codex");
  });
});
