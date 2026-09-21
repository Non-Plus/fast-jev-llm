import { SEMANTIC_ACTIONS, type ReasonCode, type SemanticClassificationResult, type SemanticItemResult } from "../types.js";
import { clampUnit } from "./policy.js";

const REASON_ALLOWLIST: ReadonlySet<string> = new Set([
  "SEMANTIC_CLASSIFICATION",
  "SEMANTIC_KEEP",
  "SEMANTIC_COMPRESS",
  "SEMANTIC_DROP",
  "SEMANTIC_LOW_CONFIDENCE",
  "SEMANTIC_PROVIDER_FAILURE",
]);

export interface SanitizedClassification {
  decisions: SemanticItemResult[];
  issues: string[];
}

export function sanitizeClassificationResult(
  result: SemanticClassificationResult | undefined,
  candidateIds: ReadonlySet<string>,
): SanitizedClassification {
  const issues: string[] = [];
  if (!result) {
    issues.push("missing_result");
    return { decisions: [], issues };
  }
  if (result.failure) {
    issues.push(`provider_failure:${result.failure}`);
    return { decisions: [], issues };
  }
  if (!Array.isArray(result.decisions)) {
    issues.push("invalid_json");
    return { decisions: [], issues };
  }

  const seen = new Set<string>();
  const decisions: SemanticItemResult[] = [];
  for (const raw of result.decisions) {
    if (!raw || typeof raw !== "object") {
      issues.push("invalid_decision");
      continue;
    }
    if (typeof raw.itemId !== "string" || raw.itemId.length === 0) {
      issues.push("missing_item_id");
      continue;
    }
    if (!candidateIds.has(raw.itemId)) {
      issues.push(`unknown_item:${raw.itemId}`);
      continue;
    }
    if (seen.has(raw.itemId)) {
      issues.push(`duplicate_item:${raw.itemId}`);
      continue;
    }
    seen.add(raw.itemId);
    if (!SEMANTIC_ACTIONS.includes(raw.action as (typeof SEMANTIC_ACTIONS)[number])) {
      issues.push(`invalid_action:${raw.itemId}`);
      continue;
    }
    const relevanceScore = clampUnit(raw.relevanceScore);
    const confidence = clampUnit(raw.confidence);
    if (!Number.isFinite(raw.relevanceScore) || !Number.isFinite(raw.confidence)) {
      issues.push(`invalid_score:${raw.itemId}`);
      continue;
    }
    const reasonCode = REASON_ALLOWLIST.has(raw.reasonCode)
      ? (raw.reasonCode as ReasonCode)
      : "SEMANTIC_CLASSIFICATION";
    decisions.push({
      itemId: raw.itemId,
      action: raw.action,
      relevanceScore,
      confidence,
      reasonCode,
      reason: typeof raw.reason === "string" && raw.reason.length > 0 ? raw.reason : "semantic classification",
    });
  }
  return { decisions, issues };
}
