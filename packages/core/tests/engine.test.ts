import { describe, expect, it } from "vitest";
import { mergeDecisions } from "../src/engine.js";
import { makeItem } from "./helpers.js";
import type { ContextDecision } from "../src/types.js";

const items = [
  makeItem({ id: "a", role: "user", content: "a" }),
  makeItem({ id: "b", role: "user", content: "b" }),
  makeItem({ id: "c", role: "user", content: "c" }),
];

function decision(
  itemId: string,
  action: ContextDecision["action"],
  rule: string,
): ContextDecision {
  return { action, itemId, rule, reason: `${rule} on ${itemId}` };
}

describe("mergeDecisions", () => {
  it("defaults unmatched items to KEEP", () => {
    const merged = mergeDecisions(items, []);
    expect(merged.map((entry) => [entry.itemId, entry.action, entry.rule])).toEqual([
      ["a", "KEEP", "default"],
      ["b", "KEEP", "default"],
      ["c", "KEEP", "default"],
    ]);
  });

  it("lets PROTECT win over DROP and COMPRESS", () => {
    const merged = mergeDecisions(items, [
      [decision("a", "PROTECT", "recent-items")],
      [decision("a", "DROP", "superseded-file-read"), decision("b", "COMPRESS", "compress-large-output")],
    ]);
    expect(merged.find((entry) => entry.itemId === "a")).toEqual(
      expect.objectContaining({ action: "PROTECT", rule: "recent-items" }),
    );
    expect(merged.find((entry) => entry.itemId === "b")?.action).toBe("COMPRESS");
  });

  it("prefers DROP over COMPRESS over KEEP", () => {
    const merged = mergeDecisions(items, [
      [decision("a", "COMPRESS", "compress-large-output")],
      [decision("a", "DROP", "superseded-file-read")],
    ]);
    expect(merged.find((entry) => entry.itemId === "a")).toEqual(
      expect.objectContaining({ action: "DROP", rule: "superseded-file-read" }),
    );
  });

  it("keeps the first equal-rank winner", () => {
    const merged = mergeDecisions(items, [
      [decision("a", "DROP", "successful-test-supersedes-failures")],
      [decision("a", "DROP", "superseded-test-run")],
    ]);
    expect(merged.find((entry) => entry.itemId === "a")?.rule).toBe(
      "successful-test-supersedes-failures",
    );
  });
});
