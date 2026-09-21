import { deterministicCompress } from "./compress.js";
import { mergeDecisions } from "./engine.js";
import { deepFreeze } from "./freeze.js";
import { toSessionState } from "./normalize.js";
import { applyPruneRules } from "./rules/prune.js";
import { applyProtectRules } from "./rules/protect.js";
import { computeStats } from "./stats.js";
import { estimateTokens } from "./tokens.js";
import type {
  CompactOptions,
  CompactionResult,
  ContextDecision,
  ContextItem,
  EngineConfig,
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

async function materialize(
  items: readonly ContextItem[],
  decisions: readonly ContextDecision[],
  config: EngineConfig,
  provider?: SemanticProvider,
): Promise<ContextItem[]> {
  const byId = new Map(decisions.map((decision) => [decision.itemId, decision]));
  const compacted: ContextItem[] = [];

  for (const item of items) {
    const decision = byId.get(item.id);
    if (!decision || decision.action === "DROP") {
      continue;
    }
    if (decision.action === "COMPRESS") {
      const content = provider?.compress
        ? await provider.compress(item)
        : deterministicCompress(item, config);
      compacted.push({
        ...copyItem(item),
        content,
        tokenCount: estimateTokens(content, config.charsPerToken),
        metadata: {
          ...item.metadata,
          compressed: true,
          originalTokens: item.tokenCount,
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

  let semantic: readonly ContextDecision[] = [];
  if (provider?.classify) {
    const openItems = session.items.filter((item) => {
      const protectedDecision = protect.find(
        (decision) => decision.itemId === item.id && decision.action === "PROTECT",
      );
      return !protectedDecision;
    });
    semantic = await provider.classify(openItems, session);
  }

  const decisions = mergeDecisions(session.items, [protect, prune, semantic]);
  const compacted = await materialize(session.items, decisions, config, provider);
  const stats = computeStats(session.items, compacted, decisions);

  return deepFreeze({
    sessionId: session.sessionId,
    items: session.items,
    compacted,
    decisions,
    stats,
  });
}
