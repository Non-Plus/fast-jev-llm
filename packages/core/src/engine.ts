import type { ContextAction, ContextDecision, ContextItem } from "./types.js";

const ACTION_RANK: Record<ContextAction, number> = {
  KEEP: 0,
  COMPRESS: 1,
  DROP: 2,
  PROTECT: 3,
};

export function defaultDecision(itemId: string): ContextDecision {
  return {
    action: "KEEP",
    reason: "No pruning rule matched",
    itemId,
    rule: "default",
  };
}

/**
 * Merge rule emissions into one winning decision per item.
 * PROTECT is sticky. Stronger prune actions win: DROP > COMPRESS > KEEP.
 * Equal-rank later decisions do not replace an earlier winner, so more
 * specific rules should be listed first.
 */
export function mergeDecisions(
  items: readonly ContextItem[],
  groups: readonly (readonly ContextDecision[])[],
): ContextDecision[] {
  const winning = new Map<string, ContextDecision>();
  for (const item of items) {
    winning.set(item.id, defaultDecision(item.id));
  }

  for (const group of groups) {
    for (const decision of group) {
      const current = winning.get(decision.itemId);
      if (!current) {
        continue;
      }
      if (current.action === "PROTECT") {
        continue;
      }
      if (decision.action === "PROTECT") {
        winning.set(decision.itemId, decision);
        continue;
      }
      if (ACTION_RANK[decision.action] > ACTION_RANK[current.action]) {
        winning.set(decision.itemId, decision);
      }
    }
  }

  return items.map((item) => {
    const decision = winning.get(item.id);
    return decision ?? defaultDecision(item.id);
  });
}
