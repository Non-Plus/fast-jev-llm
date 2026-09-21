import type { EngineConfig, TokenEstimator } from "./types.js";

export class ApproximateTokenEstimator implements TokenEstimator {
  constructor(private readonly charsPerToken = 4) {}

  estimate(text: string): number {
    if (text.length === 0 || this.charsPerToken <= 0) {
      return 0;
    }
    return Math.ceil(text.length / this.charsPerToken);
  }
}

export function estimateTokens(text: string, charsPerToken = 4): number {
  return new ApproximateTokenEstimator(charsPerToken).estimate(text);
}

export function resolveEstimator(
  config: Pick<EngineConfig, "charsPerToken" | "tokenEstimator">,
): TokenEstimator {
  return config.tokenEstimator ?? new ApproximateTokenEstimator(config.charsPerToken);
}
