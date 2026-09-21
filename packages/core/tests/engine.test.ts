import { describe, expect, it } from "vitest";
import { buildDecisionAudit, mergeDecisions } from "../src/engine.js";
import { makeDecision } from "../src/reasons.js";
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
  const authority: ContextDecision["authority"] =
    rule === "semantic-drop-all"
      ? "semantic"
      : rule === "recent-items" || rule === "compress-large-output"
        ? "heuristic"
        : rule === "system-instructions" || rule === "explicit-user-constraint"
          ? "safety"
          : "structural";
  const reasonCode: ContextDecision["reasonCode"] =
    rule === "recent-items"
      ? "RECENT_CONTEXT"
      : rule === "compress-large-output"
        ? "LARGE_OUTPUT"
        : rule === "superseded-file-read"
          ? "SUPERSEDED_FILE_READ"
          : rule === "successful-test-supersedes-failures"
            ? "TEST_FAILURE_RESOLVED"
            : rule === "superseded-test-run"
              ? "SUPERSEDED_TEST_RUN"
              : rule === "semantic-drop-all"
                ? "SEMANTIC_CLASSIFICATION"
                : "DEFAULT_KEEP";
  return makeDecision({
    action,
    itemId,
    rule,
    reason: `${rule} on ${itemId}`,
    reasonCode,
    authority,
  });
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

  it("keeps losing evaluations in the audit trail", () => {
    const audit = buildDecisionAudit(items, [
      [decision("a", "PROTECT", "recent-items")],
      [decision("a", "DROP", "superseded-file-read")],
    ]);
    const record = audit.records.find((entry) => entry.itemId === "a");
    expect(record?.winning.action).toBe("PROTECT");
    expect(record?.evaluations.map((entry) => entry.rule)).toEqual([
      "recent-items",
      "superseded-file-read",
    ]);
    expect(audit.evaluations).toHaveLength(2);
  });

  it("lets semantic override heuristic only when the item is eligible", () => {
    const semanticDrop = decision("a", "DROP", "semantic-drop-all");
    const withoutEligibility = mergeDecisions(items, [[semanticDrop]]);
    expect(withoutEligibility.find((entry) => entry.itemId === "a")?.action).toBe("KEEP");

    const withEligibility = mergeDecisions(items, [[semanticDrop]], {
      semanticEligibleIds: new Set(["a"]),
    });
    expect(withEligibility.find((entry) => entry.itemId === "a")?.action).toBe("DROP");
  });

  it("does not let semantic override safety PROTECT even when eligible", () => {
    const merged = mergeDecisions(
      items,
      [[decision("a", "PROTECT", "explicit-user-constraint")], [decision("a", "DROP", "semantic-drop-all")]],
      { semanticEligibleIds: new Set(["a"]) },
    );
    expect(merged.find((entry) => entry.itemId === "a")?.action).toBe("PROTECT");
  });
});
