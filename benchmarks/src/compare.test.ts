import { MockSemanticProvider } from "@fast-jev/core";
import { describe, expect, it } from "vitest";
import { parseClaudeJsonl } from "@fast-jev/adapter-claude";
import { compareStrategies } from "./compare-strategies.js";
import { runFastJevBaseline } from "./fast-jev-baseline.js";

const adversarial = new URL("../fixtures/adversarial/all-cases.claude.jsonl", import.meta.url);

describe("Fast-Jev-style baseline", () => {
  it("never drops user or assistant text even when a provider scores DROP", async () => {
    const parsed = await parseClaudeJsonl(adversarial);
    const provider = new MockSemanticProvider({ defaultResponse: { action: "DROP", relevanceScore: 0 } });
    const result = await runFastJevBaseline(parsed.transcript, {
      semanticProvider: provider,
      semanticMode: "local",
    });
    const textItems = result.items.filter((item) => item.kind === "message");
    for (const item of textItems) {
      const decision = result.decisions.find((entry) => entry.itemId === item.id);
      expect(decision?.action).not.toBe("DROP");
    }
    expect(result.scoringAvailable).toBe(true);
  });

  it("marks scoring unavailable instead of inventing keep/drop when no provider is given", async () => {
    const parsed = await parseClaudeJsonl(adversarial);
    const result = await runFastJevBaseline(parsed.transcript);
    expect(result.scoringAvailable).toBe(false);
    expect(result.unavailableReasons.length).toBeGreaterThan(0);
    expect(result.decisions.filter((decision) => decision.action === "DROP")).toHaveLength(0);
  });
});

describe("adversarial strategy comparison", () => {
  it("reports unsafeDropCount for every strategy and does not emit a winner", async () => {
    const parsed = await parseClaudeJsonl(adversarial);
    const provider = new MockSemanticProvider({
      defaultResponse: { action: "DROP", relevanceScore: 0.1 },
    });
    const report = await compareStrategies(parsed.transcript, {
      semanticProvider: provider,
      sessionId: parsed.meta.sessionId,
      observedClaudeCompaction: parsed.meta.observedClaudeCompaction,
    });
    expect(report.strategies.map((row) => row.strategy)).toEqual([
      "native-transcript",
      "deterministic",
      "deterministic-semantic",
      "fast-jev-style-baseline",
      "observed-claude-compaction",
    ]);
    for (const row of report.strategies) {
      expect(typeof row.unsafeDropCount).toBe("number");
    }
    const native = report.strategies.find((row) => row.strategy === "native-transcript");
    const deterministic = report.strategies.find((row) => row.strategy === "deterministic");
    const baseline = report.strategies.find((row) => row.strategy === "fast-jev-style-baseline");
    expect(native?.unsafeDropCount).toBe(0);
    expect(deterministic?.unsafeDropCount).toBe(0);
    expect(deterministic?.protectedUserConstraintsRetained).toBe(true);
    expect(baseline?.unsafeDropCount).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(report)).not.toMatch(/winner/i);
    expect(report.semanticCandidateReduction).toBeDefined();
  });
});
