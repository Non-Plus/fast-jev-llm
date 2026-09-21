import { compressItem } from "./compress.js";
import { DEFAULT_TOOL_OUTPUT_BUDGETS } from "./budgets.js";
import { buildDecisionAudit } from "./engine.js";
import { deepFreeze } from "./freeze.js";
import { toSessionState } from "./normalize.js";
import { applyPruneRules } from "./rules/prune.js";
import { applyProtectRules } from "./rules/protect.js";
import { classifySemanticEligibility } from "./semantic/eligibility.js";
import { DEFAULT_SEMANTIC_POLICY } from "./semantic/policy.js";
import { runSemanticClassification } from "./semantic/run.js";
import { computeStats } from "./stats.js";
import { resolveEstimator } from "./tokens.js";
import type {
  CompactOptions,
  CompactionResult,
  ContextDecision,
  ContextItem,
  EngineConfig,
  SemanticAudit,
  SemanticMode,
  SemanticProvider,
  SessionState,
  Transcript,
} from "./types.js";

export const DEFAULT_CONFIG: EngineConfig = {
  recentItemCount: 8,
  largeOutputTokens: 2000,
  charsPerToken: 4,
  toolOutputBudgets: { ...DEFAULT_TOOL_OUTPUT_BUDGETS },
  reportPreviews: true,
  previewMaxChars: 200,
  semanticMode: "off",
  semanticPolicy: { ...DEFAULT_SEMANTIC_POLICY },
  semanticBatchMaxItems: 16,
  semanticBatchMaxTokens: 4000,
  semanticTimeoutMs: 8000,
  semanticCache: false,
  semanticCacheDir: ".context-engine/cache",
};

function resolveConfig(overrides?: Partial<EngineConfig>): EngineConfig {
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
    toolOutputBudgets: {
      ...DEFAULT_TOOL_OUTPUT_BUDGETS,
      generic:
        overrides?.toolOutputBudgets?.generic ??
        overrides?.largeOutputTokens ??
        DEFAULT_TOOL_OUTPUT_BUDGETS.generic,
      ...overrides?.toolOutputBudgets,
    },
    semanticPolicy: {
      ...DEFAULT_SEMANTIC_POLICY,
      ...overrides?.semanticPolicy,
    },
  };
}

function copyItem(item: ContextItem): ContextItem {
  return {
    ...item,
    messageIds: [...item.messageIds],
    ...(item.tool ? { tool: { ...item.tool, args: { ...item.tool.args } } } : {}),
    ...(item.metadata ? { metadata: { ...item.metadata } } : {}),
  };
}

function semanticActive(config: EngineConfig, provider?: SemanticProvider): boolean {
  return config.semanticMode !== "off" && provider !== undefined;
}

function annotateEligibility(
  session: SessionState,
  deterministicById: ReadonlyMap<string, ContextDecision>,
  evaluationsById: ReadonlyMap<string, readonly ContextDecision[]>,
  config: EngineConfig,
): SessionState {
  const items = session.items.map((item, index) => {
    const classified = classifySemanticEligibility({
      item,
      index,
      total: session.items.length,
      deterministic: deterministicById.get(item.id),
      evaluations: evaluationsById.get(item.id) ?? [],
      config,
      session,
    });
    return {
      ...copyItem(item),
      semanticEligibility: classified.eligibility,
      metadata: {
        ...item.metadata,
        ...(classified.reasonCode !== undefined
          ? { semanticEligibilityReason: classified.reasonCode }
          : {}),
      },
    };
  });
  return { ...session, items };
}

function enrichWinners(
  winners: readonly ContextDecision[],
  items: readonly ContextItem[],
  semanticById: ReadonlyMap<string, ContextDecision>,
  provider?: SemanticProvider,
): ContextDecision[] {
  const itemById = new Map(items.map((item) => [item.id, item]));
  return winners.map((winner) => {
    const item = itemById.get(winner.itemId);
    const semantic = semanticById.get(winner.itemId);
    return {
      ...winner,
      ...(item?.semanticEligibility !== undefined
        ? { semanticEligibility: item.semanticEligibility }
        : {}),
      ...(semantic?.relevanceScore !== undefined ? { relevanceScore: semantic.relevanceScore } : {}),
      ...(semantic?.confidence !== undefined ? { confidence: semantic.confidence } : {}),
      ...(provider && semantic ? { provider: provider.name } : {}),
    };
  });
}

async function materialize(
  items: readonly ContextItem[],
  decisions: readonly ContextDecision[],
  config: EngineConfig,
  provider?: SemanticProvider,
): Promise<ContextItem[]> {
  const byId = new Map(decisions.map((decision) => [decision.itemId, decision]));
  const estimator = resolveEstimator(config);
  const compacted: ContextItem[] = [];

  for (const item of items) {
    const decision = byId.get(item.id);
    if (!decision || decision.action === "DROP") {
      continue;
    }
    if (decision.action === "COMPRESS") {
      if (provider?.compress) {
        const content = await provider.compress(item);
        compacted.push({
          ...copyItem(item),
          content,
          tokenCount: estimator.estimate(content),
          metadata: {
            ...item.metadata,
            compressed: true,
            compression: {
              strategy: "head_tail",
              originalTokens: item.tokenCount,
              retainedTokens: estimator.estimate(content),
              content,
            },
          },
        });
        continue;
      }
      const compressed = compressItem(item, config, estimator);
      compacted.push({
        ...copyItem(item),
        content: compressed.content,
        tokenCount: compressed.retainedTokens,
        metadata: {
          ...item.metadata,
          compressed: true,
          compression: compressed,
        },
      });
      continue;
    }
    compacted.push(copyItem(item));
  }

  return compacted;
}

function emptySemanticAudit(mode: SemanticMode, config: EngineConfig, provider?: SemanticProvider): SemanticAudit {
  return {
    ...(provider ? { provider: provider.name } : {}),
    ...(provider?.version !== undefined ? { providerVersion: provider.version } : {}),
    mode,
    policy: config.semanticPolicy,
    candidateCount: 0,
    batchCount: 0,
    providerLatencyMs: 0,
    providerFailures: 0,
    redactionCount: 0,
    tokensSentExternally: 0,
    charactersSentExternally: 0,
    cacheHits: 0,
    cacheMisses: 0,
    decisions: [],
    disagreements: [],
  };
}

export async function compact(
  transcript: Transcript,
  options?: CompactOptions,
): Promise<CompactionResult> {
  const config = resolveConfig(options?.config);
  const session = toSessionState(transcript, config);
  const provider = options?.semanticProvider;

  const protect = applyProtectRules(session.items, config);
  const prune = applyPruneRules(session.items, config);
  const deterministicAudit = buildDecisionAudit(session.items, [protect, prune]);
  const deterministicById = new Map(
    deterministicAudit.winning.map((decision) => [decision.itemId, decision]),
  );
  const evaluationsById = new Map<string, ContextDecision[]>();
  for (const evaluation of deterministicAudit.evaluations) {
    const list = evaluationsById.get(evaluation.itemId) ?? [];
    list.push(evaluation);
    evaluationsById.set(evaluation.itemId, list);
  }

  const annotated = annotateEligibility(session, deterministicById, evaluationsById, config);
  const itemIndex = new Map(annotated.items.map((item, index) => [item.id, index]));
  const candidates = annotated.items.filter((item) => {
    const eligibility = item.semanticEligibility;
    return eligibility === "eligible" || eligibility === "recommended";
  });
  const semanticEligibleIds = new Set(candidates.map((item) => item.id));

  let semanticDecisions: ContextDecision[] = [];
  let semanticAudit = emptySemanticAudit(config.semanticMode, config, provider);

  if (semanticActive(config, provider) && provider) {
    const run = await runSemanticClassification({
      session: annotated,
      candidates,
      itemIndex,
      deterministicById,
      evaluationsById,
      config,
      provider,
    });
    semanticDecisions = run.decisions;
    semanticAudit = {
      ...run.audit,
      mode: config.semanticMode,
      policy: config.semanticPolicy,
      provider: provider.name,
      ...(provider.version !== undefined ? { providerVersion: provider.version } : {}),
    };
  }

  const audit = buildDecisionAudit(annotated.items, [protect, prune, semanticDecisions], {
    semanticEligibleIds,
  });
  const semanticById = new Map(semanticDecisions.map((decision) => [decision.itemId, decision]));
  const winning = enrichWinners(audit.winning, annotated.items, semanticById, provider);
  const records = audit.records.map((record, index) => ({
    ...record,
    winning: winning[index] ?? record.winning,
  }));

  const deterministicCompacted = await materialize(
    annotated.items,
    deterministicAudit.winning,
    config,
    provider,
  );
  const deterministicStats = computeStats(
    annotated.items,
    deterministicCompacted,
    deterministicAudit.winning,
  );

  const compacted = await materialize(annotated.items, winning, config, provider);
  const stats = computeStats(annotated.items, compacted, winning);
  stats.semanticCandidateCount = semanticAudit.candidateCount;
  stats.semanticKeepCount = semanticAudit.decisions.filter((decision) => decision.action === "KEEP").length;
  stats.semanticCompressCount = semanticAudit.decisions.filter((decision) => decision.action === "COMPRESS").length;
  stats.semanticDropCount = semanticAudit.decisions.filter((decision) => decision.action === "DROP").length;
  stats.additionalSemanticSavings = Math.max(0, deterministicStats.compactTokens - stats.compactTokens);

  for (const disagreement of semanticAudit.disagreements) {
    const merged = winning.find((decision) => decision.itemId === disagreement.itemId);
    if (merged) {
      disagreement.finalAction = merged.action;
    }
  }

  return deepFreeze({
    sessionId: annotated.sessionId,
    session: annotated,
    items: annotated.items,
    compacted,
    decisions: winning,
    evaluations: [...audit.evaluations],
    decisionRecords: records,
    relations: annotated.relations,
    stats,
    deterministicDecisions: deterministicAudit.winning,
    deterministicStats,
    semantic: semanticAudit,
  });
}
