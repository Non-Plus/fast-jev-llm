import type { ContextDecision, ContextItem } from "../types.js";

export function dropOlderByKey(
  items: readonly ContextItem[],
  rule: string,
  selectKey: (item: ContextItem) => string | undefined,
  reason: (key: string, item: ContextItem) => string,
): ContextDecision[] {
  const latestId = new Map<string, string>();
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (!item) {
      continue;
    }
    const key = selectKey(item);
    if (key === undefined) {
      continue;
    }
    if (!latestId.has(key)) {
      latestId.set(key, item.id);
    }
  }

  const decisions: ContextDecision[] = [];
  for (const item of items) {
    const key = selectKey(item);
    if (key === undefined) {
      continue;
    }
    const keepId = latestId.get(key);
    if (keepId !== undefined && keepId !== item.id) {
      decisions.push({
        action: "DROP",
        itemId: item.id,
        rule,
        reason: reason(key, item),
      });
    }
  }
  return decisions;
}
