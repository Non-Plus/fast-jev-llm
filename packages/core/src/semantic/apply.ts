import { makeDecision } from "../reasons.js";
import type {
  ContextDecision,
  SemanticItemResult,
  SemanticPolicy,
} from "../types.js";
import { actionFromRelevance } from "./policy.js";

const RETENTION_REASON_CODES = new Set([
  "CURRENT_TASK",
  "UNRESOLVED_ERROR",
  "USER_CONSTRAINT",
  "SYSTEM_INSTRUCTION",
]);

export function applyPolicyToResult(
  raw: SemanticItemResult,
  policy: SemanticPolicy,
): SemanticItemResult {
  const mapped = actionFromRelevance(raw.relevanceScore, raw.confidence, policy);
  const reasonCode = mapped.downgradedFromDrop
    ? "SEMANTIC_LOW_CONFIDENCE"
    : mapped.action === "DROP"
      ? "SEMANTIC_DROP"
      : mapped.action === "COMPRESS"
        ? "SEMANTIC_COMPRESS"
        : "SEMANTIC_KEEP";
  return {
    ...raw,
    action: mapped.action,
    reasonCode,
    reason: mapped.downgradedFromDrop
      ? `${raw.reason} (low-confidence DROP downgraded to COMPRESS)`
      : raw.reason,
  };
}

export function shouldVetoSemanticDrop(
  deterministic: ContextDecision,
  evaluations: readonly ContextDecision[],
): boolean {
  if (deterministic.retention === "protected" || deterministic.action === "PROTECT") {
    return true;
  }
  if (deterministic.authority === "safety") {
    return true;
  }
  if (deterministic.authority === "structural" && deterministic.action === "KEEP") {
    return true;
  }
  return evaluations.some(
    (evaluation) =>
      RETENTION_REASON_CODES.has(evaluation.reasonCode) ||
      (evaluation.authority === "structural" && evaluation.action === "KEEP"),
  );
}

export function toSemanticContextDecision(
  result: SemanticItemResult,
  provider: string,
): ContextDecision {
  return {
    ...makeDecision({
      itemId: result.itemId,
      action: result.action,
      rule: `semantic-${provider}`,
      reasonCode: result.reasonCode,
      reason: result.reason,
      authority: "semantic",
      retention: "normal",
      compression: "allowed",
    }),
    relevanceScore: result.relevanceScore,
    confidence: result.confidence,
    provider,
  };
}
