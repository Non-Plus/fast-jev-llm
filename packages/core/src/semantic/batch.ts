import type { EngineConfig, PackedCandidate } from "../types.js";

function estimatePackedTokens(candidate: PackedCandidate): number {
  return Math.max(1, Math.ceil((candidate.contentPreview.length + 80) / 4));
}

/**
 * Deterministic batching: walk candidates in session order, start a new
 * batch when item or token limits would be exceeded.
 */
export function batchCandidates(
  candidates: readonly PackedCandidate[],
  config: Pick<EngineConfig, "semanticBatchMaxItems" | "semanticBatchMaxTokens">,
): PackedCandidate[][] {
  const maxItems = Math.max(1, config.semanticBatchMaxItems);
  const maxTokens = Math.max(1, config.semanticBatchMaxTokens);
  const batches: PackedCandidate[][] = [];
  let current: PackedCandidate[] = [];
  let tokens = 0;
  for (const candidate of candidates) {
    const cost = estimatePackedTokens(candidate);
    const wouldExceed =
      current.length >= maxItems || (current.length > 0 && tokens + cost > maxTokens);
    if (wouldExceed) {
      batches.push(current);
      current = [];
      tokens = 0;
    }
    current.push(candidate);
    tokens += cost;
  }
  if (current.length > 0) {
    batches.push(current);
  }
  return batches;
}
