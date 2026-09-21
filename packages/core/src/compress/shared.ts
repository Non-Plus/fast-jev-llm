import type { CompressedContent, CompressionStrategyName, ContextItem, TokenEstimator } from "../types.js";

export function toolText(item: ContextItem): string {
  return item.tool?.result ?? item.content;
}

export function commandOf(item: ContextItem): string | undefined {
  return item.tool?.command;
}

export function exitCodeOf(item: ContextItem): number | undefined {
  return item.tool?.exitCode;
}

export function label(item: ContextItem): string {
  return item.tool
    ? `${item.tool.kind}${item.tool.path ? ` ${item.tool.path}` : ""}${item.tool.command ? ` \`${item.tool.command}\`` : ""}`
    : item.kind;
}

export function wrapStructured(
  strategy: CompressionStrategyName,
  item: ContextItem,
  body: string,
  estimator: TokenEstimator,
): CompressedContent {
  const content = `[compressed ${strategy} | ${label(item)} | original ${item.tokenCount} tokens]\n${body}`;
  return {
    strategy,
    originalTokens: item.tokenCount,
    retainedTokens: estimator.estimate(content),
    content,
  };
}

export function fitToTokenBudget(
  text: string,
  budget: number,
  estimator: TokenEstimator,
): string {
  if (budget <= 0 || estimator.estimate(text) <= budget) {
    return text;
  }
  const lines = text.split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    const candidate = [...kept, line].join("\n");
    if (estimator.estimate(candidate) > budget && kept.length > 0) {
      kept.push("…");
      break;
    }
    kept.push(line);
  }
  return kept.join("\n");
}

export function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
}
