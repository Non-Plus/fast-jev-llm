import { defaultKeep } from "./reasons.js";
import type {
  ContextAction,
  ContextDecision,
  ContextItem,
  DecisionAuthority,
  ItemDecisionRecord,
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

function beats(
  incoming: ContextDecision,
  current: ContextDecision,
  semanticEligible: boolean,
): boolean {
  if (current.action === "PROTECT") {
    return false;
  }
  if (incoming.action === "PROTECT") {
    return true;
  }

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

export interface MergeOptions {
  semanticEligibleIds?: ReadonlySet<string>;
}

/**
 * Merge rule emissions into one winning decision per item.
 * PROTECT is sticky. Authority order is safety > structural > heuristic > semantic,
 * except semantic may compete with heuristic when the item is eligible.
 * Equal authority uses DROP > COMPRESS > KEEP. First equal-rank winner is kept.
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
    let winner = defaultDecision(item.id);
    const eligible = options?.semanticEligibleIds?.has(item.id) ?? false;
    for (const decision of itemEvaluations) {
      if (beats(decision, winner, eligible)) {
        winner = decision;
      }
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
