/** Jev/TypeSafe bills input tokens only. Keep pricing out of core. */
export const JEV_INPUT_USD_PER_MILLION = 0.042;

export function estimateJevCostUsd(inputTokens: number | undefined): number | undefined {
  if (inputTokens === undefined || !Number.isFinite(inputTokens) || inputTokens < 0) {
    return undefined;
  }
  return (inputTokens / 1_000_000) * JEV_INPUT_USD_PER_MILLION;
}
