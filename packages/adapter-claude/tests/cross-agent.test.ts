import { compact, type ContextItem } from "@fast-jev/core";
import { parseCodexJsonl } from "@fast-jev/adapter-codex";
import { parseCursorJsonl } from "@fast-jev/adapter-cursor";
import { describe, expect, it } from "vitest";
import { analyzeClaudeSession } from "../src/analyze.js";
import { parseClaudeJsonl } from "../src/parser.js";
import { cursorPackageFixture, fixturePath } from "./helpers.js";

function toolKinds(items: readonly ContextItem[]): Array<string | undefined> {
  return items.filter((item) => item.tool).map((item) => item.tool?.kind);
}

describe("cross-agent auth session", () => {
  it("makes materially consistent protection, classification, and drop decisions across Codex, Cursor, and Claude", async () => {
    const config = { recentItemCount: 3 };
    const [codexParsed, cursorParsed, claudeParsed] = await Promise.all([
      parseCodexJsonl(cursorPackageFixture("cross-agent/auth.codex.jsonl")),
      parseCursorJsonl(cursorPackageFixture("cross-agent/auth.cursor.jsonl")),
      parseClaudeJsonl(fixturePath("cross-agent/auth.claude.jsonl")),
    ]);
    const [codex, cursor, claude] = await Promise.all([
      compact(codexParsed.transcript, { config }),
      compact(cursorParsed.transcript, { config }),
      compact(claudeParsed.transcript, { config }),
    ]);

    const expectedKinds = [
      "file_read",
      "file_read",
      "git_status",
      "file_write",
      "test_run",
      "file_read",
      "file_write",
      "test_run",
      "git_diff",
      "build_run",
      "directory_list",
    ];
    expect(toolKinds(codex.items)).toEqual(expectedKinds);
    expect(toolKinds(cursor.items)).toEqual(expectedKinds);
    expect(toolKinds(claude.items)).toEqual(expectedKinds);

    const byId = (result: typeof codex) =>
      new Map(result.decisions.map((decision) => [decision.itemId, decision]));

    const toolKindsAndActions = (result: typeof codex) => {
      const map = byId(result);
      return result.items
        .filter((item) => item.tool)
        .map((item) => {
          const decision = map.get(item.id);
          return `${item.tool?.kind}:${decision?.action}:${decision?.reasonCode}`;
        });
    };

    expect(toolKindsAndActions(codex)).toEqual(toolKindsAndActions(cursor));
    expect(toolKindsAndActions(codex)).toEqual(toolKindsAndActions(claude));

    const relationTypes = (result: typeof codex) =>
      [...result.relations.map((relation) => relation.type)].sort();
    expect(relationTypes(codex)).toEqual(relationTypes(cursor));
    expect(relationTypes(codex)).toEqual(relationTypes(claude));

    const userProtected = (result: typeof codex) =>
      result.items
        .filter((item) => item.kind === "message" && item.role === "user")
        .map((item) => byId(result).get(item.id)?.retention);
    expect(userProtected(codex)).toEqual(userProtected(cursor));
    expect(userProtected(codex)).toEqual(userProtected(claude));
    expect(userProtected(claude).every((retention) => retention === "protected")).toBe(true);

    const ratio = (result: typeof codex) => result.stats.compactTokens / result.stats.originalTokens;
    expect(Math.abs(ratio(codex) - ratio(claude))).toBeLessThan(0.08);
    expect(Math.abs(ratio(codex) - ratio(cursor))).toBeLessThan(0.08);

    const claudeShadow = await analyzeClaudeSession(fixturePath("cross-agent/auth.claude.jsonl"), {
      config,
    });
    expect(claudeShadow.source).toBe("claude");
    expect(claudeShadow.droppedItems).toBe(claude.stats.droppedCount);
    expect(claudeShadow.compressionSavings).toBe(claude.stats.compressionSavings);
  });
});
