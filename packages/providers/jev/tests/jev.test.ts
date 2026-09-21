import { describe, expect, it } from "vitest";
import type { SemanticClassificationRequest } from "@fast-jev/core";
import { JevSemanticProvider, jevProviderFromEnv } from "../src/client.js";
import { relevanceFromScore, toJevRequest, toSemanticResults } from "../src/map.js";

function request(): SemanticClassificationRequest {
  return {
    sessionId: "s1",
    packedState: {
      currentTask: "Implement auth",
      userConstraints: ["Never delete files"],
      currentErrors: [],
      modifiedFiles: ["src/auth.ts"],
      recentActivity: ["file_read src/auth.ts"],
      architecturalFacts: ["Never delete files"],
    },
    candidates: [
      {
        itemId: "item-009",
        kind: "tool_pair",
        toolKind: "generic_command",
        command: "ls -la /tmp",
        order: 4,
        ageFromEnd: 8,
        tokenCount: 40,
        relationships: [],
        contentPreview: "total 4",
      },
    ],
    tokenBudget: 40,
    policyVersion: "semantic-policy-v1",
  };
}

describe("Jev mapping", () => {
  it("maps a 5-level score onto 0-1 relevance without choosing DROP/KEEP", () => {
    expect(relevanceFromScore(0)).toBe(0);
    expect(relevanceFromScore(4)).toBe(1);
    expect(relevanceFromScore(2)).toBe(0.5);
    const mapped = toSemanticResults(request(), {
      answers: { c0: { type: "score", score: 0.4, confidence: 0.91 } },
    });
    expect(mapped[0]).toEqual(
      expect.objectContaining({
        itemId: "item-009",
        action: "KEEP",
        relevanceScore: 0.1,
        confidence: 0.91,
      }),
    );
  });

  it("sends packed state and one score question per candidate", () => {
    const body = toJevRequest(request(), "jev-1.13.0");
    expect(body.model).toBe("jev-1.13.0");
    expect(body.questions.c0?.type).toBe("score");
    expect(JSON.stringify(body)).toContain("Implement auth");
    expect(JSON.stringify(body)).toContain("item-009");
  });
});

describe("JevSemanticProvider", () => {
  it("posts System One payloads and records usage/cost", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const provider = new JevSemanticProvider({
      apiKey: "test-key",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return new Response(
          JSON.stringify({
            model: "jev-1.13.0",
            answers: { c0: { type: "score", score: 3.2, confidence: 0.8 } },
            usage: { input_tokens: 1000, output_tokens: 10 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });
    const result = await provider.classify(request());
    expect(calls).toHaveLength(1);
    expect(calls[0]?.init.headers).toEqual(
      expect.objectContaining({ Authorization: "Bearer test-key" }),
    );
    expect(result.decisions[0]?.relevanceScore).toBeCloseTo(0.8);
    expect(result.usage?.inputTokens).toBe(1000);
    expect(result.usage?.estimatedCost).toBeCloseTo(0.000042);
    expect(JSON.stringify(result)).not.toContain("test-key");
  });

  it("retries 5xx once and fails on invalid JSON without retrying forever", async () => {
    let hits = 0;
    const provider = new JevSemanticProvider({
      apiKey: "k",
      retries: 1,
      fetchImpl: async () => {
        hits += 1;
        if (hits === 1) {
          return new Response("nope", { status: 503 });
        }
        return new Response("not-json", { status: 200 });
      },
    });
    await expect(provider.classify(request())).rejects.toThrow(/invalid JSON/);
    expect(hits).toBe(2);
  });

  it("does not construct from env without a key", () => {
    expect(jevProviderFromEnv({} as NodeJS.ProcessEnv)).toBeUndefined();
  });
});
