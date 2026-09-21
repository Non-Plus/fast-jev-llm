import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compact } from "../src/pipeline.js";
import { actionFromRelevance } from "../src/semantic/policy.js";
import { batchCandidates } from "../src/semantic/batch.js";
import { MockSemanticProvider } from "../src/semantic/mock.js";
import { looksSensitive } from "../src/semantic/sensitive.js";
import { redactForRemote } from "../src/semantic/redact.js";
import { message, transcript } from "./helpers.js";
import type { PackedCandidate } from "../src/types.js";

const historical = [
  message("sys", "system", "Follow the repository rules."),
  message("u1", "user", "Never delete files. Implement auth."),
  {
    id: "a1",
    role: "assistant" as const,
    content: "",
    toolCalls: [{ id: "c1", name: "Bash", arguments: { command: "ls -la" } }],
  },
  { id: "t1", role: "tool" as const, toolCallId: "c1", content: "package.json\nsrc\nREADME.md\n" + "entry\n".repeat(40) },
  message("a2", "assistant", "Historical explanation of an old search."),
];

describe("semantic policy", () => {
  it("keeps high relevance, compresses mid, drops only high-confidence low relevance", () => {
    expect(actionFromRelevance(0.7, 0.5).action).toBe("KEEP");
    expect(actionFromRelevance(0.5, 0.9).action).toBe("COMPRESS");
    expect(actionFromRelevance(0.1, 0.9).action).toBe("DROP");
    expect(actionFromRelevance(0.1, 0.5)).toEqual({ action: "COMPRESS", downgradedFromDrop: true });
  });
});

describe("batchCandidates", () => {
  it("is deterministic and respects item and token caps", () => {
    const candidates: PackedCandidate[] = Array.from({ length: 10 }, (_, index) => ({
      itemId: `i${index}`,
      kind: "message",
      order: index,
      ageFromEnd: 9 - index,
      tokenCount: 10,
      relationships: [],
      contentPreview: "x".repeat(40),
    }));
    const first = batchCandidates(candidates, { semanticBatchMaxItems: 4, semanticBatchMaxTokens: 10_000 });
    const second = batchCandidates(candidates, { semanticBatchMaxItems: 4, semanticBatchMaxTokens: 10_000 });
    expect(first.map((batch) => batch.map((item) => item.itemId))).toEqual([
      ["i0", "i1", "i2", "i3"],
      ["i4", "i5", "i6", "i7"],
      ["i8", "i9"],
    ]);
    expect(second).toEqual(first);
  });
});

describe("compact semantic layer", () => {
  it("does not call a provider when semanticMode is off", async () => {
    const provider = new MockSemanticProvider({ defaultResponse: { action: "DROP" } });
    const result = await compact(transcript(historical), { semanticProvider: provider });
    expect(provider.calls).toHaveLength(0);
    expect(result.semantic?.mode).toBe("off");
    const assistant = result.items.find((item) => item.role === "assistant");
    expect(result.decisions.find((decision) => decision.itemId === assistant?.id)?.action).not.toBe("DROP");
  });

  it("applies semantic KEEP, COMPRESS, and DROP on eligible items", async () => {
    const input = transcript(historical);
    const dry = await compact(input, { config: { recentItemCount: 0, semanticMode: "local" } });
    const eligible = dry.items.filter(
      (item) => item.semanticEligibility === "eligible" || item.semanticEligibility === "recommended",
    );
    expect(eligible.length).toBeGreaterThanOrEqual(2);
    const [keepId, compressId, dropId] = eligible.map((item) => item.id);
    const provider = new MockSemanticProvider({
      responses: {
        ...(keepId ? { [keepId]: { action: "KEEP" } } : {}),
        ...(compressId ? { [compressId]: { action: "COMPRESS" } } : {}),
        ...(dropId ? { [dropId]: { action: "DROP", relevanceScore: 0.1, confidence: 0.95 } } : {}),
      },
      defaultResponse: { action: "KEEP" },
    });
    const result = await compact(input, {
      config: { recentItemCount: 0, semanticMode: "local" },
      semanticProvider: provider,
    });
    const byId = new Map(result.decisions.map((decision) => [decision.itemId, decision]));
    if (keepId) {
      expect(byId.get(keepId)?.action).toBe("KEEP");
    }
    if (compressId) {
      expect(byId.get(compressId)?.action).toBe("COMPRESS");
    }
    if (dropId) {
      expect(byId.get(dropId)?.action).toBe("DROP");
    }
  });

  it("downgrades low-confidence DROP to COMPRESS", async () => {
    const provider = new MockSemanticProvider({
      defaultResponse: { action: "DROP", relevanceScore: 0.1, confidence: 0.4 },
    });
    const result = await compact(transcript(historical), {
      config: { recentItemCount: 0, semanticMode: "local" },
      semanticProvider: provider,
    });
    const assistant = result.items.find((item) => item.content.includes("Historical explanation"));
    expect(result.decisions.find((decision) => decision.itemId === assistant?.id)).toEqual(
      expect.objectContaining({ action: "COMPRESS", reasonCode: "SEMANTIC_LOW_CONFIDENCE" }),
    );
  });

  it("vetoes semantic DROP of protected items and never sends them", async () => {
    const provider = new MockSemanticProvider({ defaultResponse: { action: "DROP" } });
    const result = await compact(transcript(historical), {
      config: { recentItemCount: 0, semanticMode: "local" },
      semanticProvider: provider,
    });
    const sent = new Set(provider.calls.flatMap((call) => call.candidates.map((candidate) => candidate.itemId)));
    const constraint = result.items.find((item) => item.content.includes("Never delete"));
    const system = result.items.find((item) => item.role === "system");
    expect(constraint?.semanticEligibility).toBe("forbidden");
    expect(system?.semanticEligibility).toBe("forbidden");
    expect(sent.has(constraint!.id)).toBe(false);
    expect(sent.has(system!.id)).toBe(false);
    const byId = new Map(result.decisions.map((decision) => [decision.itemId, decision]));
    expect(byId.get(constraint!.id)?.action).toBe("PROTECT");
    expect(byId.get(system!.id)?.action).toBe("PROTECT");
  });

  it("does not DROP when the provider fails, times out, or returns junk", async () => {
    const failing = new MockSemanticProvider({ fail: true, defaultResponse: { action: "DROP" } });
    const timedOut = new MockSemanticProvider({ timeout: true });
    const invalid = new MockSemanticProvider({ invalidActions: true });
    const nan = new MockSemanticProvider({ nanScores: true, defaultResponse: { action: "DROP" } });
    const extra = new MockSemanticProvider({ extraIds: ["ghost"], defaultResponse: { action: "KEEP" } });

    const configs = { recentItemCount: 0, semanticMode: "local" as const };
    const failResult = await compact(transcript(historical), { config: configs, semanticProvider: failing });
    const timeoutResult = await compact(transcript(historical), {
      config: { ...configs, semanticTimeoutMs: 20 },
      semanticProvider: timedOut,
    });
    const dry = await compact(transcript(historical), { config: configs });
    const eligibleId = dry.items.find((item) => item.semanticEligibility === "eligible" || item.semanticEligibility === "recommended")?.id;
    const partialProvider = new MockSemanticProvider({
      omitIds: eligibleId ? [eligibleId] : [],
      defaultResponse: { action: "KEEP" },
    });
    const partialResult = await compact(transcript(historical), { config: configs, semanticProvider: partialProvider });
    const invalidResult = await compact(transcript(historical), { config: configs, semanticProvider: invalid });
    const nanResult = await compact(transcript(historical), { config: configs, semanticProvider: nan });
    const extraResult = await compact(transcript(historical), { config: configs, semanticProvider: extra });

    for (const result of [failResult, timeoutResult, partialResult, invalidResult, nanResult, extraResult]) {
      expect(result.decisions.some((decision) => decision.action === "DROP" && decision.authority === "semantic")).toBe(
        false,
      );
      expect(result.items).toHaveLength(result.decisions.length);
    }
    expect(failResult.semantic?.providerFailures).toBeGreaterThan(0);
    expect(timeoutResult.semantic?.providerFailures).toBeGreaterThan(0);
    expect(partialProvider.calls.length).toBeGreaterThan(0);
    expect(extraResult.decisions.some((decision) => decision.itemId === "ghost")).toBe(false);
  });

  it("blocks obvious secrets from remote classification and does not log them", async () => {
    const token = `sk-${"a".repeat(24)}`;
    const provider = new MockSemanticProvider({ defaultResponse: { action: "DROP" } });
    const result = await compact(
      transcript([
        message("sys", "system", "Stay in this repo."),
        message("u1", "user", "Never log secrets. Continue the auth work."),
        {
          id: "a1",
          role: "assistant",
          content: "",
          toolCalls: [{ id: "c1", name: "Read", arguments: { path: ".env" } }],
        },
        { id: "t1", role: "tool", toolCallId: "c1", content: `OPENAI_API_KEY=${token}` },
        message("a2", "assistant", "Historical leftover explanation."),
      ]),
      { config: { recentItemCount: 0, semanticMode: "remote" }, semanticProvider: provider },
    );
    const envItem = result.items.find((item) => item.tool?.path === ".env");
    expect(envItem?.semanticEligibility).toBe("forbidden");
    expect(envItem?.metadata?.["semanticEligibilityReason"]).toBe("SENSITIVE_CONTENT_REMOTE_BLOCK");
    const packed = JSON.stringify(provider.calls);
    expect(packed.includes(token)).toBe(false);
    expect(provider.calls.some((call) => call.candidates.some((candidate) => candidate.itemId === envItem?.id))).toBe(
      false,
    );
    expect(looksSensitive(`OPENAI_API_KEY=${token}`, ".env")).toBe(true);
  });

  it("redacts provider copies without mutating canonical content", async () => {
    const secret = "ghp_abcdefghijklmnopqrstuvwx";
    const original = `Authorization: Bearer ${secret}`;
    const redacted = redactForRemote(original);
    expect(redacted.redactionsApplied).toBeGreaterThan(0);
    expect(redacted.text.includes(secret)).toBe(false);
    expect(original.includes(secret)).toBe(true);
  });

  it("batches candidates instead of calling once per item", async () => {
    const messages = [
      message("sys", "system", "Follow user constraints."),
      message("u1", "user", "Never delete production data. Continue."),
      ...Array.from({ length: 40 }, (_, index) => message(`a${index}`, "assistant", `historical note ${index}`)),
    ];
    const provider = new MockSemanticProvider({ defaultResponse: { action: "KEEP" } });
    const result = await compact(transcript(messages), {
      config: { recentItemCount: 0, semanticMode: "local", semanticBatchMaxItems: 16, semanticBatchMaxTokens: 100_000 },
      semanticProvider: provider,
    });
    expect(result.semantic?.candidateCount).toBeGreaterThanOrEqual(40);
    expect(provider.calls.length).toBeGreaterThan(1);
    expect(provider.calls.length).toBeLessThan(40);
    expect(result.semantic?.batchCount).toBe(provider.calls.length);
  });

  it("caches classification keyed by provider, content, state, and policy", async () => {
    const dir = await mkdtemp(join(tmpdir(), "semantic-cache-"));
    try {
      const provider = new MockSemanticProvider({ defaultResponse: { action: "COMPRESS" } });
      const options = {
        config: {
          recentItemCount: 0,
          semanticMode: "local" as const,
          semanticCache: true,
          semanticCacheDir: dir,
        },
        semanticProvider: provider,
      };
      const first = await compact(transcript(historical), options);
      const second = await compact(transcript(historical), options);
      expect(first.semantic?.cacheMisses).toBeGreaterThan(0);
      expect(second.semantic?.cacheHits).toBeGreaterThan(0);
      expect(second.semantic?.cacheHits).toBeGreaterThanOrEqual(first.semantic?.candidateCount ?? 0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
