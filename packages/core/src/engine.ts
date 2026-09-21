import { defaultKeep } from "./reasons.js";
import type {
  CompressionEligibility,
  ContextAction,
  ContextDecision,
  ContextItem,
  DecisionAuthority,
  Importance,
  ItemDecisionRecord,
  Retention,
} from "./types.js";

const ACTION_RANK: Record<ContextAction, number> = {
  KEEP: 0,
  COMPRESS: 1,
  DROP: 2,
  PROTECT: 3,
};

const AUTHORITY_RANK: Record<DecisionAuthority, number> = {
  semantic: 0,
  heuristic: 1,
  structural: 2,
  safety: 3,
};

export function defaultDecision(itemId: string): ContextDecision {
  return defaultKeep(itemId);
}

export function isCompressibleToolItem(item: ContextItem): boolean {
  return item.kind === "tool_pair" || item.kind === "unpaired_tool_result";
}

function beatsAction(
  incoming: ContextDecision,
  current: ContextDecision,
  semanticEligible: boolean,
): boolean {
  let incomingRank = AUTHORITY_RANK[incoming.authority];
  const currentRank = AUTHORITY_RANK[current.authority];
  if (
    incoming.authority === "semantic" &&
    current.authority === "heuristic" &&
    semanticEligible
  ) {
    incomingRank = AUTHORITY_RANK.heuristic;
  }
  if (incomingRank !== currentRank) {
    return incomingRank > currentRank;
  }
  return ACTION_RANK[incoming.action] > ACTION_RANK[current.action];
}

function beatsProtect(
  incoming: ContextDecision,
  current: ContextDecision,
): boolean {
  const incomingRank = AUTHORITY_RANK[incoming.authority];
  const currentRank = AUTHORITY_RANK[current.authority];
  if (incomingRank !== currentRank) {
    return incomingRank > currentRank;
  }
  return false;
}

function mergeImportance(evaluations: readonly ContextDecision[], item: ContextItem): Importance | undefined {
  let best = item.importance;
  for (const evaluation of evaluations) {
    if (!evaluation.importance) {
      continue;
    }
    if (!best) {
      best = evaluation.importance;
      continue;
    }
    const order: Record<Importance, number> = {
      EPHEMERAL: 0,
      NORMAL: 1,
      IMPORTANT: 2,
      CRITICAL: 3,
    };
    if (order[evaluation.importance] > order[best]) {
      best = evaluation.importance;
    }
  }
  return best;
}

function withMeta(
  decision: ContextDecision,
  retention: Retention,
  compression: CompressionEligibility,
  importance: Importance | undefined,
): ContextDecision {
  return {
    ...decision,
    retention,
    compression,
    ...(importance !== undefined ? { importance } : {}),
  };
}

export interface MergeOptions {
  semanticEligibleIds?: ReadonlySet<string>;
}

/**
 * Merge rule emissions into one winning decision per item.
 *
 * Retention protection is independent of compression eligibility:
 * a protected item cannot be DROPped, but may still be COMPRESSed when
 * compression is allowed.
 *
 * Authority order remains safety > structural > heuristic > semantic.
 * Semantic may compete with heuristic only when the item is eligible
 * (not retention-protected). Equal authority uses DROP > COMPRESS > KEEP.
 */
export function mergeDecisions(
  items: readonly ContextItem[],
  groups: readonly (readonly ContextDecision[])[],
  options?: MergeOptions,
): ContextDecision[] {
  return buildDecisionAudit(items, groups, options).winning;
}

export function buildDecisionAudit(
  items: readonly ContextItem[],
  groups: readonly (readonly ContextDecision[])[],
  options?: MergeOptions,
): {
  winning: ContextDecision[];
  evaluations: ContextDecision[];
  records: ItemDecisionRecord[];
} {
  const evaluations = groups.flatMap((group) => [...group]);
  const byItem = new Map<string, ContextDecision[]>();
  for (const decision of evaluations) {
    const list = byItem.get(decision.itemId) ?? [];
    list.push(decision);
    byItem.set(decision.itemId, list);
  }

  const winning: ContextDecision[] = [];
  const records: ItemDecisionRecord[] = [];

  for (const item of items) {
    const itemEvaluations = byItem.get(item.id) ?? [];
    const importance = mergeImportance(itemEvaluations, item);

    let retention: Retention = "normal";
    let compression: CompressionEligibility = "allowed";
    let protectWinner: ContextDecision | undefined;
    for (const evaluation of itemEvaluations) {
      if (evaluation.retention === "protected" || evaluation.action === "PROTECT") {
        retention = "protected";
        if (!protectWinner || beatsProtect(evaluation, protectWinner)) {
          protectWinner = evaluation;
        }
      }
      if (evaluation.compression === "forbidden") {
        compression = "forbidden";
      }
    }

    if (retention === "protected" && protectWinner && compression !== "forbidden") {
      if (protectWinner.compression === "allowed") {
        compression = "allowed";
      } else if (protectWinner.compression === "forbidden") {
        compression = "forbidden";
      } else if (isCompressibleToolItem(item)) {
        compression = "allowed";
      } else {
        compression = "forbidden";
      }
    }

    const semanticEligible =
      retention !== "protected" && (options?.semanticEligibleIds?.has(item.id) ?? false);

    let actionWinner = defaultDecision(item.id);
    for (const evaluation of itemEvaluations) {
      if (evaluation.action === "PROTECT") {
        continue;
      }
      if (beatsAction(evaluation, actionWinner, semanticEligible)) {
        actionWinner = evaluation;
      }
    }

    let winner: ContextDecision;
    if (retention === "protected") {
      if (actionWinner.action === "DROP") {
        const compressEval = itemEvaluations.find((evaluation) => evaluation.action === "COMPRESS");
        if (compression === "allowed" && compressEval) {
          winner = withMeta(compressEval, "protected", "allowed", importance);
        } else if (protectWinner) {
          winner = withMeta(
            { ...protectWinner, action: "PROTECT" },
            "protected",
            compression,
            importance,
          );
        } else {
          winner = withMeta(defaultDecision(item.id), "protected", compression, importance);
        }
      } else if (actionWinner.action === "COMPRESS") {
        if (compression === "forbidden" && protectWinner) {
          winner = withMeta(
            { ...protectWinner, action: "PROTECT" },
            "protected",
            "forbidden",
            importance,
          );
        } else {
          winner = withMeta(actionWinner, "protected", "allowed", importance);
        }
      } else if (protectWinner) {
        winner = withMeta(
          { ...protectWinner, action: "PROTECT" },
          "protected",
          compression,
          importance,
        );
      } else {
        winner = withMeta(actionWinner, "protected", compression, importance);
      }
    } else {
      winner = withMeta(actionWinner, "normal", actionWinner.compression, importance);
    }

    winning.push(winner);
    records.push({
      itemId: item.id,
      winning: winner,
      evaluations: itemEvaluations,
    });
  }

  return { winning, evaluations, records };
}
