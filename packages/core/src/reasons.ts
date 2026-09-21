import type {
  CompressionEligibility,
  ContextAction,
  ContextDecision,
  DecisionAuthority,
  Importance,
  ReasonCode,
  Retention,
} from "./types.js";

export function makeDecision(input: {
  itemId: string;
  action: ContextAction;
  rule: string;
  reasonCode: ReasonCode;
  reason: string;
  authority: DecisionAuthority;
  retention?: Retention;
  compression?: CompressionEligibility;
  importance?: Importance;
}): ContextDecision {
  const retention =
    input.retention ?? (input.action === "PROTECT" ? "protected" : "normal");
  const compression =
    input.compression ??
    (input.action === "PROTECT" ? "forbidden" : "allowed");
  return {
    itemId: input.itemId,
    action: input.action,
    rule: input.rule,
    reasonCode: input.reasonCode,
    reason: input.reason,
    authority: input.authority,
    retention,
    compression,
    ...(input.importance !== undefined ? { importance: input.importance } : {}),
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
    retention: "normal",
    compression: "allowed",
  });
}
