import { compact, classifyFailureKind, type ContextItem, type ToolKind } from "@fast-jev/core";
import { parseCodexJsonl } from "@fast-jev/adapter-codex";
import { describe, expect, it } from "vitest";
import { parseCursorJsonl } from "../src/parser.js";
import { fixturePath } from "./helpers.js";

function toolItems(items: readonly ContextItem[]): ContextItem[] {
  return items.filter((item) => item.tool);
}

function kinds(items: readonly ContextItem[]): ToolKind[] {
  return toolItems(items).map((item) => item.tool?.kind ?? "other");
}

function paths(items: readonly ContextItem[]): Array<string | undefined> {
  return toolItems(items).map((item) => item.tool?.normalizedPath ?? item.tool?.path);
}

function pairStructure(items: readonly ContextItem[]): Array<{ kind: string; toolKind?: ToolKind }> {
  return items
    .filter((item) => item.tool)
    .map((item) => ({ kind: item.kind, toolKind: item.tool?.kind }));
}

describe("Codex/Cursor adapter conformance", () => {
  it("normalizes equivalent operations to the same ToolKind, path, and command class", async () => {
    const [codex, cursor] = await Promise.all([
      parseCodexJsonl(fixturePath("conformance/operations.codex.jsonl")),
      parseCursorJsonl(fixturePath("conformance/operations.cursor.jsonl")),
    ]);
    const [codexState, cursorState] = await Promise.all([
      compact(codex.transcript),
      compact(cursor.transcript),
    ]);

    expect(kinds(codexState.items)).toEqual(kinds(cursorState.items));
    expect(kinds(codexState.items)).toEqual([
      "file_read",
      "git_status",
      "git_diff",
      "test_run",
      "build_run",
      "file_write",
      "directory_list",
      "command",
    ]);
    expect(paths(codexState.items)).toEqual(paths(cursorState.items));
    const shellKinds = new Set(["git_status", "git_diff", "test_run", "build_run", "command"]);
    expect(
      toolItems(codexState.items)
        .filter((item) => item.tool && shellKinds.has(item.tool.kind))
        .map((item) => item.tool?.command),
    ).toEqual(
      toolItems(cursorState.items)
        .filter((item) => item.tool && shellKinds.has(item.tool.kind))
        .map((item) => item.tool?.command),
    );
    expect(pairStructure(codexState.items)).toEqual(pairStructure(cursorState.items));
    expect(pairStructure(codexState.items).every((entry) => entry.kind === "tool_pair")).toBe(true);
  });

  it("classifies equivalent test failures the same way", async () => {
    const [codex, cursor] = await Promise.all([
      parseCodexJsonl(fixturePath("conformance/test-failure.codex.jsonl")),
      parseCursorJsonl(fixturePath("conformance/test-failure.cursor.jsonl")),
    ]);
    const [codexState, cursorState] = await Promise.all([
      compact(codex.transcript),
      compact(cursor.transcript),
    ]);
    const codexTest = toolItems(codexState.items)[0];
    const cursorTest = toolItems(cursorState.items)[0];
    expect(codexTest?.tool?.kind).toBe("test_run");
    expect(cursorTest?.tool?.kind).toBe("test_run");
    expect(codexTest?.tool?.failureKind).toBe("test");
    expect(cursorTest?.tool?.failureKind).toBe("test");
    expect(
      classifyFailureKind({
        kind: "test_run",
        result: String(codexTest?.tool?.result ?? ""),
      }),
    ).toBe("test");
    expect(
      classifyFailureKind({
        kind: "test_run",
        result: String(cursorTest?.tool?.result ?? ""),
      }),
    ).toBe("test");
  });

  it("does not compare vendor-specific metadata when judging conformance", async () => {
    const cursor = await parseCursorJsonl(fixturePath("conformance/operations.cursor.jsonl"));
    const call = cursor.transcript.messages.find((message) => message.toolCalls?.[0]?.name === "Read");
    expect(call?.metadata?.["originVendor"]).toBe("cursor");
    expect(call?.metadata?.["source"]).toBe("cursor");
  });
});
