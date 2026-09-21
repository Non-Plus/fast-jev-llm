import { contentHash } from "../file-state.js";
import { makeDecision } from "../reasons.js";
import { resolveEstimator } from "../tokens.js";
import type {
  ContextDecision,
  ContextItem,
  EngineConfig,
  PackedCandidate,
  ProviderUsage,
  SemanticAudit,
  SemanticClassificationRequest,
  SemanticClassificationResult,
  SemanticDisagreement,
  SemanticItemResult,
  SemanticProvider,
  SessionState,
} from "../types.js";
import { batchCandidates } from "./batch.js";
import { readSemanticCache, semanticCacheKey, writeSemanticCache } from "./cache.js";
import { packClassificationRequest, semanticStateHashSource } from "./pack.js";
import { DEFAULT_SEMANTIC_POLICY } from "./policy.js";
import { applyPolicyToResult, shouldVetoSemanticDrop, toSemanticContextDecision } from "./apply.js";
import { sanitizeClassificationResult } from "./sanitize.js";

function emptyUsage(): ProviderUsage {
  return { requests: 0, latencyMs: 0, estimatedCostUnavailable: true };
}

function mergeUsage(parts: readonly ProviderUsage[]): ProviderUsage {
  if (parts.length === 0) {
    return emptyUsage();
  }
  const requests = parts.reduce((sum, part) => sum + part.requests, 0);
  const latencyMs = parts.reduce((sum, part) => sum + part.latencyMs, 0);
  const inputKnown = parts.every((part) => part.inputTokens !== undefined);
  const outputKnown = parts.every((part) => part.outputTokens !== undefined);
  const costKnown = parts.every((part) => part.estimatedCost !== undefined);
  return {
    requests,
    latencyMs,
    ...(inputKnown
      ? { inputTokens: parts.reduce((sum, part) => sum + (part.inputTokens ?? 0), 0) }
      : {}),
    ...(outputKnown
      ? { outputTokens: parts.reduce((sum, part) => sum + (part.outputTokens ?? 0), 0) }
      : {}),
    ...(costKnown
      ? { estimatedCost: parts.reduce((sum, part) => sum + (part.estimatedCost ?? 0), 0) }
      : { estimatedCostUnavailable: true }),
  };
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

function requestCharacters(request: SemanticClassificationRequest): number {
  return JSON.stringify(request).length;
}

export interface SemanticRunInput {
  session: SessionState;
  candidates: readonly ContextItem[];
  itemIndex: ReadonlyMap<string, number>;
  deterministicById: ReadonlyMap<string, ContextDecision>;
  evaluationsById: ReadonlyMap<string, readonly ContextDecision[]>;
  config: EngineConfig;
  provider: SemanticProvider;
}

export interface SemanticRunOutput {
  decisions: ContextDecision[];
  results: SemanticItemResult[];
  disagreements: SemanticDisagreement[];
  audit: Omit<SemanticAudit, "mode" | "policy" | "disagreements" | "decisions"> & {
    decisions: SemanticItemResult[];
    disagreements: SemanticDisagreement[];
  };
}

function refuseRemoteProvider(provider: SemanticProvider, config: EngineConfig): boolean {
  return provider.remote === true && config.semanticMode !== "remote";
}

export async function runSemanticClassification(input: SemanticRunInput): Promise<SemanticRunOutput> {
  const policy = input.config.semanticPolicy ?? DEFAULT_SEMANTIC_POLICY;
  const empty: SemanticRunOutput = {
    decisions: [],
    results: [],
    disagreements: [],
    audit: {
      provider: input.provider.name,
      ...(input.provider.version !== undefined ? { providerVersion: input.provider.version } : {}),
      candidateCount: input.candidates.length,
      batchCount: 0,
      providerLatencyMs: 0,
      providerFailures: 0,
      redactionCount: 0,
      tokensSentExternally: 0,
      charactersSentExternally: 0,
      cacheHits: 0,
      cacheMisses: 0,
      usage: emptyUsage(),
      decisions: [],
      disagreements: [],
    },
  };

  if (input.candidates.length === 0) {
    return empty;
  }

  if (refuseRemoteProvider(input.provider, input.config)) {
    return {
      ...empty,
      audit: {
        ...empty.audit,
        providerFailures: 1,
      },
    };
  }

  const packed = packClassificationRequest(
    input.session,
    input.candidates,
    input.config,
    input.itemIndex,
  );
  const stateHash = contentHash(
    semanticStateHashSource(packed.request.packedState, packed.request.policyVersion),
  );

  const cached: SemanticItemResult[] = [];
  const uncached: PackedCandidate[] = [];
  let cacheHits = 0;
  let cacheMisses = 0;
  for (const candidate of packed.request.candidates) {
    if (!input.config.semanticCache) {
      uncached.push(candidate);
      cacheMisses += 1;
      continue;
    }
    const key = semanticCacheKey({
      provider: input.provider.name,
      providerVersion: input.provider.version,
      candidateHash: candidate.normalizedContentHash ?? contentHash(candidate.contentPreview),
      stateHash,
      policyVersion: packed.request.policyVersion,
    });
    const hit = await readSemanticCache(input.config.semanticCacheDir, key);
    if (hit && hit.itemId === candidate.itemId) {
      cached.push(hit);
      cacheHits += 1;
    } else {
      uncached.push(candidate);
      cacheMisses += 1;
    }
  }

  const batches = batchCandidates(uncached, input.config);
  const fresh: SemanticItemResult[] = [];
  const usages: ProviderUsage[] = [];
  let providerFailures = 0;
  let redactionCount = packed.redactionsApplied;
  let charactersSentExternally = 0;
  let tokensSentExternally = 0;
  let providerLatencyMs = 0;

  for (const batch of batches) {
    const request: SemanticClassificationRequest = {
      ...packed.request,
      candidates: batch,
      tokenBudget: batch.reduce((sum, candidate) => sum + candidate.tokenCount, 0),
    };
    const started = Date.now();
    try {
      const raw: SemanticClassificationResult = await withTimeout(
        input.provider.classify(request),
        input.config.semanticTimeoutMs,
        input.provider.name,
      );
      const elapsed = Date.now() - started;
      providerLatencyMs += elapsed;
      charactersSentExternally += requestCharacters(request);
      const estimator = resolveEstimator(input.config);
      tokensSentExternally += estimator.estimate(JSON.stringify(request));
      redactionCount += raw.redactionsApplied ?? 0;
      if (raw.usage) {
        usages.push({ ...raw.usage, latencyMs: raw.usage.latencyMs || elapsed });
      } else {
        usages.push({ requests: 1, latencyMs: elapsed, estimatedCostUnavailable: true });
      }
      const sanitized = sanitizeClassificationResult(
        raw,
        new Set(batch.map((candidate) => candidate.itemId)),
      );
      if (sanitized.issues.length > 0 && sanitized.decisions.length === 0) {
        providerFailures += 1;
        continue;
      }
      if (sanitized.issues.some((issue) => issue.startsWith("provider_failure"))) {
        providerFailures += 1;
      }
      for (const decision of sanitized.decisions) {
        const interpreted = applyPolicyToResult(decision, policy);
        fresh.push(interpreted);
        if (input.config.semanticCache) {
          const candidate = batch.find((entry) => entry.itemId === interpreted.itemId);
          if (candidate) {
            const key = semanticCacheKey({
              provider: input.provider.name,
              providerVersion: input.provider.version,
              candidateHash: candidate.normalizedContentHash ?? contentHash(candidate.contentPreview),
              stateHash,
              policyVersion: packed.request.policyVersion,
            });
            try {
              await writeSemanticCache(input.config.semanticCacheDir, key, interpreted);
            } catch {
              // Cache writes must never fail compaction.
            }
          }
        }
      }
    } catch {
      providerFailures += 1;
      providerLatencyMs += Date.now() - started;
      // Fail open: omit semantic decisions for this batch.
    }
  }

  const combined = [...cached, ...fresh];
  const decisions: ContextDecision[] = [];
  const disagreements: SemanticDisagreement[] = [];
  const applied: SemanticItemResult[] = [];

  for (const result of combined) {
    const deterministic = input.deterministicById.get(result.itemId);
    if (!deterministic) {
      continue;
    }
    const evaluations = input.evaluationsById.get(result.itemId) ?? [];
    let action = result.action;
    if (action === "DROP" && shouldVetoSemanticDrop(deterministic, evaluations)) {
      action = "KEEP";
      disagreements.push({
        itemId: result.itemId,
        deterministicAction: deterministic.action,
        deterministicReason: deterministic.reason,
        semanticAction: "DROP",
        semanticReason: `${result.reason} (vetoed)`,
        finalAction: deterministic.action,
        relevanceScore: result.relevanceScore,
        confidence: result.confidence,
      });
      applied.push({ ...result, action: "KEEP", reason: `${result.reason} (protected-item veto)` });
      continue;
    }
    const semanticDecision = toSemanticContextDecision({ ...result, action }, input.provider.name);
    if (action !== deterministic.action) {
      disagreements.push({
        itemId: result.itemId,
        deterministicAction: deterministic.action,
        deterministicReason: deterministic.reason,
        semanticAction: action,
        semanticReason: result.reason,
        finalAction: action,
        relevanceScore: result.relevanceScore,
        confidence: result.confidence,
      });
    }
    applied.push({ ...result, action });
    decisions.push(semanticDecision);
  }

  return {
    decisions,
    results: applied,
    disagreements,
    audit: {
      provider: input.provider.name,
      ...(input.provider.version !== undefined ? { providerVersion: input.provider.version } : {}),
      candidateCount: input.candidates.length,
      batchCount: batches.length,
      providerLatencyMs,
      providerFailures,
      redactionCount,
      tokensSentExternally,
      charactersSentExternally,
      cacheHits,
      cacheMisses,
      usage: mergeUsage(usages),
      decisions: applied,
      disagreements,
    },
  };
}

export function semanticProviderFailureDecision(itemId: string): ContextDecision {
  return makeDecision({
    itemId,
    action: "KEEP",
    rule: "semantic-provider-failure",
    reasonCode: "SEMANTIC_PROVIDER_FAILURE",
    reason: "Semantic provider failed; retaining the deterministic decision",
    authority: "semantic",
    retention: "normal",
    compression: "allowed",
  });
}
