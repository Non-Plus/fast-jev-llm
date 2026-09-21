import type { SemanticAction, SemanticPolicy } from "../types.js";

export const DEFAULT_SEMANTIC_POLICY: SemanticPolicy = {
  keepMinRelevance: 0.7,
  compressMinRelevance: 0.35,
  dropMinConfidence: 0.8,
  policyVersion: "semantic-policy-v1",
};

export function clampUnit(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

/**
 * Map relevance/confidence onto KEEP | COMPRESS | DROP.
 * Thresholds live here, not inside providers.
 */
export function actionFromRelevance(
  relevanceScore: number,
  confidence: number,
  policy: SemanticPolicy = DEFAULT_SEMANTIC_POLICY,
): { action: SemanticAction; downgradedFromDrop: boolean } {
  const relevance = clampUnit(relevanceScore);
  const conf = clampUnit(confidence);
  if (relevance >= policy.keepMinRelevance) {
    return { action: "KEEP", downgradedFromDrop: false };
  }
  if (relevance >= policy.compressMinRelevance) {
    return { action: "COMPRESS", downgradedFromDrop: false };
  }
  if (conf >= policy.dropMinConfidence) {
    return { action: "DROP", downgradedFromDrop: false };
  }
  return { action: "COMPRESS", downgradedFromDrop: true };
}
