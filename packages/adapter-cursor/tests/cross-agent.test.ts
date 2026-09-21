import { compact, type ContextItem } from "@fast-jev/core";
import { parseCodexJsonl } from "@fast-jev/adapter-codex";
import { describe, expect, it } from "vitest";
import { analyzeCursorSession } from "../src/analyze.js";
import { parseCursorJsonl } from "../src/parser.js";
import { fixturePath } from "./helpers.js";

function toolKinds(items: readonly ContextItem[]): Array<string | undefined> {
  return items.filter((item) => item.tool).map((item) => item.tool?.kind);
}

describe("cross-agent auth session", () => {
  it("makes materially consistent protection, classification, and drop decisions", async () => {
    const config = { recentItemCount: 3 };
    const [codexParsed, cursorParsed] = await Promise.all([
      parseCodexJsonl(fixturePath("cross-agent/auth.codex.jsonl")),
      parseCursorJsonl(fixturePath("cross-agent/auth.cursor.jsonl")),
    ]);
    const [codex, cursor] = await Promise.all([
      compact(codexParsed.transcript, { config }),
      compact(cursorParsed.transcript, { config }),
    ]);

    expect(toolKinds(codex.items)).toEqual(toolKinds(cursor.items));
    expect(toolKinds(codex.items)).toEqual([
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
    ]);

    const byId = (result: typeof codex) => new Map(result.decisions.map((decision) => [decision.itemId, decision]));
    const codexById = byId(codex);
    const cursorById = byId(cursor);

    const toolKindsAndActions = (result: typeof codex) =>
      result.items
        .filter((item) => item.tool)
        .map((item) => {
          const decision = result === codex ? codexById.get(item.id) : cursorById.get(item.id);
          return {
            kind: item.tool?.kind,
            action: decision?.action,
            reason: decision?.reasonCode,
            path: item.tool?.normalizedPath ?? item.tool?.path,
          };
        });

    expect(toolKindsAndActions(codex).map((row) => `${row.kind}:${row.action}:${row.reason}`)).toEqual(
      toolKindsAndActions(cursor).map((row) => `${row.kind}:${row.action}:${row.reason}`),
    );

    const relationTypes = (result: typeof codex) =>
      [...result.relations.map((relation) => relation.type)].sort();
    expect(relationTypes(codex)).toEqual(relationTypes(cursor));

    const userProtected = (result: typeof codex) =>
      result.items
        .filter((item) => item.kind === "message" && item.role === "user")
        .map((item) => byId(result).get(item.id)?.retention);
    expect(userProtected(codex)).toEqual(userProtected(cursor));
    expect(userProtected(codex).every((retention) => retention === "protected")).toBe(true);

    const ratio = (result: typeof codex) => result.stats.compactTokens / result.stats.originalTokens;
    expect(Math.abs(ratio(codex) - ratio(cursor))).toBeLessThan(0.08);

    const cursorShadow = await analyzeCursorSession(fixturePath("cross-agent/auth.cursor.jsonl"), {
      config,
    });
    expect(cursorShadow.source).toBe("cursor");
    expect(cursorShadow.droppedItems).toBe(cursor.stats.droppedCount);
    expect(cursorShadow.compressionSavings).toBe(cursor.stats.compressionSavings);
  });
});
