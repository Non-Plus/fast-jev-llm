import type {
  ContextDecision,
  ContextItem,
  ContextRelation,
  DecisionAuthority,
  ReasonCode,
  RelationType,
} from "../types.js";
import { makeDecision } from "../reasons.js";

export function dropOlderByKey(
  items: readonly ContextItem[],
  rule: string,
  selectKey: (item: ContextItem) => string | undefined,
  reason: (key: string, item: ContextItem) => string,
  extras: {
    reasonCode: ReasonCode;
    authority: DecisionAuthority;
    relation?: RelationType;
  },
): { decisions: ContextDecision[]; relations: ContextRelation[] } {
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
  const relations: ContextRelation[] = [];
  for (const item of items) {
    const key = selectKey(item);
    if (key === undefined) {
      continue;
    }
    const keepId = latestId.get(key);
    if (keepId !== undefined && keepId !== item.id) {
      decisions.push(
        makeDecision({
          action: "DROP",
          itemId: item.id,
          rule,
          reasonCode: extras.reasonCode,
          reason: reason(key, item),
          authority: extras.authority,
        }),
      );
      if (extras.relation) {
        relations.push({
          type: extras.relation,
          fromId: keepId,
          toId: item.id,
          rule,
        });
      }
    }
  }
  return { decisions, relations };
}
