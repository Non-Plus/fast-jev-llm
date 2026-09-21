import { describe, expect, it } from "vitest";
import { compact } from "../src/pipeline.js";
import { MockSemanticProvider } from "../src/semantic/mock.js";
import { transcript } from "./helpers.js";
import { SEMANTIC_EVAL_CASES } from "./semantic-eval.dataset.js";

describe("semantic evaluation dataset", () => {
  it("includes at least 50 candidate cases", () => {
    expect(SEMANTIC_EVAL_CASES.length).toBeGreaterThanOrEqual(50);
  });

  it("keeps unsafeDropCount at 0 and reports quality metrics", async () => {
    let unsafeDropCount = 0;
    let overRetentionCount = 0;
    let compressionOpportunityMissed = 0;
    let providerAttempts = 0;
    let providerFailures = 0;
    const failures: string[] = [];

    for (const evalCase of SEMANTIC_EVAL_CASES) {
      const provider = new MockSemanticProvider({
        defaultResponse: {
          action: evalCase.mockAction ?? "KEEP",
          ...(evalCase.mockRelevance !== undefined ? { relevanceScore: evalCase.mockRelevance } : {}),
          ...(evalCase.mockConfidence !== undefined ? { confidence: evalCase.mockConfidence } : {}),
        },
      });
      providerAttempts += 1;
      const result = await compact(transcript(evalCase.messages, evalCase.id), {
        config: {
          recentItemCount: evalCase.recentItemCount ?? 2,
          semanticMode: "local",
        },
        semanticProvider: provider,
      });
      providerFailures += result.semantic?.providerFailures ?? 0;
      const item = evalCase.select(result.items);
      if (!item) {
        failures.push(`${evalCase.id}: selector missed`);
        continue;
      }
      const action = result.decisions.find((decision) => decision.itemId === item.id)?.action;
      if (!action) {
        failures.push(`${evalCase.id}: no decision`);
        continue;
      }
      if (evalCase.requiresRetention && action === "DROP") {
        unsafeDropCount += 1;
        failures.push(`${evalCase.id}: unsafe DROP`);
      }
      if (!evalCase.acceptable.includes(action)) {
        failures.push(`${evalCase.id}: ${action} not in ${evalCase.acceptable.join("|")}`);
      }
      if (evalCase.unacceptable.includes(action)) {
        failures.push(`${evalCase.id}: unacceptable ${action}`);
      }
      if (
        evalCase.acceptable.every((entry) => entry === "DROP" || entry === "COMPRESS") &&
        (action === "KEEP" || action === "PROTECT")
      ) {
        overRetentionCount += 1;
      }
      if (evalCase.acceptable.includes("COMPRESS") && !evalCase.acceptable.includes("KEEP") && action === "KEEP") {
        compressionOpportunityMissed += 1;
      }
    }

    const adversarial = new MockSemanticProvider({ defaultResponse: { action: "DROP" } });
    for (const evalCase of SEMANTIC_EVAL_CASES.filter((entry) => entry.requiresRetention)) {
      providerAttempts += 1;
      const result = await compact(transcript(evalCase.messages, `${evalCase.id}-adv`), {
        config: { recentItemCount: evalCase.recentItemCount ?? 0, semanticMode: "local" },
        semanticProvider: adversarial,
      });
      providerFailures += result.semantic?.providerFailures ?? 0;
      const item = evalCase.select(result.items);
      const action = result.decisions.find((decision) => decision.itemId === item?.id)?.action;
      if (action === "DROP") {
        unsafeDropCount += 1;
        failures.push(`${evalCase.id}: adversarial unsafe DROP`);
      }
    }

    const providerFailureRate = providerAttempts === 0 ? 0 : providerFailures / providerAttempts;
    expect({
      cases: SEMANTIC_EVAL_CASES.length,
      unsafeDropCount,
      overRetentionCount,
      compressionOpportunityMissed,
      providerFailureRate,
      failures,
    }).toEqual(
      expect.objectContaining({
        unsafeDropCount: 0,
        failures: [],
      }),
    );
    expect(providerFailureRate).toBe(0);
  });
});
