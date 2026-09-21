import { describe, expect, it } from "vitest";
import { computeStats, formatStats } from "../src/stats.js";
import { makeItem, makeToolItem } from "./helpers.js";
import type { ContextDecision } from "../src/types.js";

describe("computeStats", () => {
  it("aggregates counts and tokens from winning decisions", () => {
    const items = [
      makeItem({ id: "p", role: "user", content: "never", tokenCount: 10 }),
      makeItem({ id: "k", role: "assistant", content: "ok", tokenCount: 5 }),
      makeToolItem(
        "c",
        {
          name: "Read",
          kind: "file_read",
          callId: "c",
          args: {},
          path: "lock",
        },
        "compressed",
        100,
      ),
      makeToolItem(
        "d",
        {
          name: "Read",
          kind: "file_read",
          callId: "d",
          args: {},
          path: "old",
        },
        "old",
        40,
      ),
    ];
    const compacted = [
      items[0]!,
      items[1]!,
      { ...items[2]!, content: "stub", tokenCount: 4 },
    ];
    const decisions: ContextDecision[] = [
      {
        action: "PROTECT",
        itemId: "p",
        rule: "explicit-user-constraint",
        reason: "constraint",
        reasonCode: "USER_CONSTRAINT",
        authority: "safety",
        retention: "protected",
        compression: "forbidden",
      },
      {
        action: "KEEP",
        itemId: "k",
        rule: "default",
        reason: "keep",
        reasonCode: "DEFAULT_KEEP",
        authority: "heuristic",
        retention: "normal",
        compression: "allowed",
      },
      {
        action: "COMPRESS",
        itemId: "c",
        rule: "compress-large-output",
        reason: "big",
        reasonCode: "LARGE_OUTPUT",
        authority: "heuristic",
        retention: "normal",
        compression: "allowed",
      },
      {
        action: "DROP",
        itemId: "d",
        rule: "superseded-file-read",
        reason: "old",
        reasonCode: "SUPERSEDED_FILE_READ",
        authority: "structural",
        retention: "normal",
        compression: "allowed",
      },
    ];

    const stats = computeStats(items, compacted, decisions);
    expect(stats.originalItems).toBe(4);
    expect(stats.compactItems).toBe(3);
    expect(stats.originalTokens).toBe(155);
    expect(stats.compactTokens).toBe(19);
    expect(stats.protectedCount).toBe(1);
    expect(stats.keptCount).toBe(1);
    expect(stats.compressedCount).toBe(1);
    expect(stats.compressedTokens).toBe(4);
    expect(stats.droppedCount).toBe(1);
    expect(stats.droppedTokens).toBe(40);
    expect(stats.protectedVerbatimTokens).toBe(10);
    expect(stats.compressionSavings).toBe(96);
    expect(stats.dropSavings).toBe(40);
    expect(stats.totalPotentialSavings).toBe(136);
    expect(stats.byRule["superseded-file-read"]).toEqual({ count: 1, tokens: 40 });
  });

  it("formats a readable summary", () => {
    const stats = computeStats(
      [makeItem({ id: "a", content: "aaaa", tokenCount: 8 })],
      [makeItem({ id: "a", content: "aaaa", tokenCount: 8 })],
      [{ action: "KEEP", itemId: "a", rule: "default", reason: "keep", reasonCode: "DEFAULT_KEEP", authority: "heuristic", retention: "normal", compression: "allowed" }],
    );
    const text = formatStats(stats, "sess");
    expect(text).toContain("Session: sess");
    expect(text).toContain("Original tokens:");
    expect(text).toContain("default");
  });
});
