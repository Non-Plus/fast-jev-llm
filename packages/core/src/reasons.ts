import type {
  ContextAction,
  ContextDecision,
  DecisionAuthority,
  ReasonCode,
} from "./types.js";

export function makeDecision(input: {
  itemId: string;
  action: ContextAction;
  rule: string;
  reasonCode: ReasonCode;
  reason: string;
  authority: DecisionAuthority;
}): ContextDecision {
  return {
    itemId: input.itemId,
    action: input.action,
    rule: input.rule,
    reasonCode: input.reasonCode,
    reason: input.reason,
    authority: input.authority,
  };
}

export function defaultKeep(itemId: string): ContextDecision {
  return makeDecision({
    itemId,
    action: "KEEP",
    rule: "default",
    reasonCode: "DEFAULT_KEEP",
    reason: "No pruning rule matched",
    authority: "heuristic",
  });
}
