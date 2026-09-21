import { compressItem } from "./compress.js";
import { buildDecisionAudit } from "./engine.js";
import { deepFreeze } from "./freeze.js";
import { toSessionState } from "./normalize.js";
import { applyPruneRules } from "./rules/prune.js";
import { applyProtectRules } from "./rules/protect.js";
import { computeStats } from "./stats.js";
import { resolveEstimator } from "./tokens.js";
import type {
  CompactOptions,
  CompactionResult,
  ContextDecision,
  ContextItem,
  EngineConfig,
  ReasonCode,
  SemanticProvider,
  Transcript,
} from "./types.js";

export const DEFAULT_CONFIG: EngineConfig = {
  recentItemCount: 8,
  largeOutputTokens: 2000,
  charsPerToken: 4,
};

function resolveConfig(overrides?: Partial<EngineConfig>): EngineConfig {
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
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

function hydrateSemantic(decisions: readonly ContextDecision[]): ContextDecision[] {
  return decisions.map((decision) => ({
    ...decision,
    authority: decision.authority ?? "semantic",
    reasonCode: decision.reasonCode ?? ("SEMANTIC_CLASSIFICATION" as ReasonCode),
  }));
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

export async function compact(
  transcript: Transcript,
  options?: CompactOptions,
): Promise<CompactionResult> {
  const config = resolveConfig(options?.config);
  const session = toSessionState(transcript, config);
  const provider = options?.semanticProvider;

  const protect = applyProtectRules(session.items, config);
  const prune = applyPruneRules(session.items, config);

  const protectedIds = new Set(
    protect
      .filter((decision) => decision.action === "PROTECT")
      .map((decision) => decision.itemId),
  );
  const semanticEligibleIds = new Set(
    session.items.filter((item) => !protectedIds.has(item.id)).map((item) => item.id),
  );

  let semantic: ContextDecision[] = [];
  if (provider?.classify) {
    const openItems = session.items.filter((item) => semanticEligibleIds.has(item.id));
    semantic = hydrateSemantic(await provider.classify(openItems, session));
  }

  const audit = buildDecisionAudit(session.items, [protect, prune, semantic], {
    semanticEligibleIds,
  });
  const compacted = await materialize(session.items, audit.winning, config, provider);
  const stats = computeStats(session.items, compacted, audit.winning);

  return deepFreeze({
    sessionId: session.sessionId,
    session,
    items: session.items,
    compacted,
    decisions: audit.winning,
    evaluations: audit.evaluations,
    decisionRecords: audit.records,
    relations: session.relations,
    stats,
  });
}
