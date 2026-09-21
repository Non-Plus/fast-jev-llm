import { compact, classifyFailureKind, type ContextItem, type ToolKind } from "@fast-jev/core";
import { parseCodexJsonl } from "@fast-jev/adapter-codex";
import { parseCursorJsonl } from "@fast-jev/adapter-cursor";
import { describe, expect, it } from "vitest";
import { parseClaudeJsonl } from "../src/parser.js";
import { cursorPackageFixture, fixturePath } from "./helpers.js";

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

const EXPECTED_KINDS: ToolKind[] = [
  "file_read",
  "git_status",
  "git_diff",
  "test_run",
  "build_run",
  "file_write",
  "directory_list",
  "command",
];

describe("Codex/Cursor/Claude adapter conformance", () => {
  it("normalizes equivalent operations to the same ToolKind, path, command class, and pair structure", async () => {
    const [codex, cursor, claude] = await Promise.all([
      parseCodexJsonl(cursorPackageFixture("conformance/operations.codex.jsonl")),
      parseCursorJsonl(cursorPackageFixture("conformance/operations.cursor.jsonl")),
      parseClaudeJsonl(fixturePath("conformance/operations.claude.jsonl")),
    ]);
    const [codexState, cursorState, claudeState] = await Promise.all([
      compact(codex.transcript),
      compact(cursor.transcript),
      compact(claude.transcript),
    ]);

    expect(kinds(codexState.items)).toEqual(EXPECTED_KINDS);
    expect(kinds(cursorState.items)).toEqual(EXPECTED_KINDS);
    expect(kinds(claudeState.items)).toEqual(EXPECTED_KINDS);
    expect(paths(codexState.items)).toEqual(paths(cursorState.items));
    expect(paths(codexState.items)).toEqual(paths(claudeState.items));
    const shellKinds = new Set(["git_status", "git_diff", "test_run", "build_run", "command"]);
    const commands = (items: readonly ContextItem[]) =>
      toolItems(items)
        .filter((item) => item.tool && shellKinds.has(item.tool.kind))
        .map((item) => item.tool?.command);
    expect(commands(codexState.items)).toEqual(commands(cursorState.items));
    expect(commands(codexState.items)).toEqual(commands(claudeState.items));
    expect(pairStructure(codexState.items)).toEqual(pairStructure(cursorState.items));
    expect(pairStructure(codexState.items)).toEqual(pairStructure(claudeState.items));
    expect(pairStructure(claudeState.items).every((entry) => entry.kind === "tool_pair")).toBe(true);
  });

  it("classifies equivalent test failures the same way", async () => {
    const [codex, cursor, claude] = await Promise.all([
      parseCodexJsonl(cursorPackageFixture("conformance/test-failure.codex.jsonl")),
      parseCursorJsonl(cursorPackageFixture("conformance/test-failure.cursor.jsonl")),
      parseClaudeJsonl(fixturePath("conformance/test-failure.claude.jsonl")),
    ]);
    const [codexState, cursorState, claudeState] = await Promise.all([
      compact(codex.transcript),
      compact(cursor.transcript),
      compact(claude.transcript),
    ]);
    for (const testItem of [
      toolItems(codexState.items)[0],
      toolItems(cursorState.items)[0],
      toolItems(claudeState.items)[0],
    ]) {
      expect(testItem?.tool?.kind).toBe("test_run");
      expect(testItem?.tool?.failureKind).toBe("test");
      expect(
        classifyFailureKind({
          kind: "test_run",
          result: String(testItem?.tool?.result ?? ""),
        }),
      ).toBe("test");
    }
  });

  it("does not compare vendor-specific metadata when judging conformance", async () => {
    const claude = await parseClaudeJsonl(fixturePath("conformance/operations.claude.jsonl"));
    const call = claude.transcript.messages.find((message) => message.toolCalls?.[0]?.name === "Read");
    expect(call?.metadata?.["originVendor"]).toBe("claude");
    expect(call?.metadata?.["source"]).toBe("claude");
  });
});
