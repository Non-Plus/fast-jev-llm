import { ApproximateTokenEstimator } from "./tokens.js";
import type {
  CompressedContent,
  CompressionStrategy,
  ContextItem,
  EngineConfig,
  TokenEstimator,
} from "./types.js";
import { errorExtractStrategy } from "./compress/build.js";
import { directoryListStrategy } from "./compress/directory.js";
import { gitDiffStrategy } from "./compress/git-diff.js";
import { fitToTokenBudget, label, toolText, wrapStructured } from "./compress/shared.js";
import { testSummaryStrategy } from "./compress/test.js";

const HEAD_CHARS = 400;
const TAIL_CHARS = 200;

export { errorExtractStrategy, testSummaryStrategy, gitDiffStrategy, directoryListStrategy };

export const headTailStrategy: CompressionStrategy = {
  name: "head_tail",
  supports() {
    return true;
  },
  compress(item, config, estimator) {
    const original = item.content;
    if (original.length <= HEAD_CHARS + TAIL_CHARS + 80) {
      return wrapStructured("head_tail", item, original, estimator);
    }
    const head = original.slice(0, HEAD_CHARS);
    const tail = original.slice(-TAIL_CHARS);
    const body = fitToTokenBudget(
      `${head}\n...\n${tail}`,
      config.toolOutputBudgets.generic,
      estimator,
    );
    return wrapStructured("head_tail", item, body, estimator);
  },
};

export const compressionStrategies: CompressionStrategy[] = [
  testSummaryStrategy,
  gitDiffStrategy,
  directoryListStrategy,
  errorExtractStrategy,
  headTailStrategy,
];

export function selectCompressionStrategy(item: ContextItem): CompressionStrategy {
  if (testSummaryStrategy.supports(item)) {
    return testSummaryStrategy;
  }
  if (gitDiffStrategy.supports(item)) {
    const structured = gitDiffStrategy;
    if (/^diff --git /m.test(toolText(item)) || item.tool?.kind === "git_diff") {
      return structured;
    }
  }
  if (directoryListStrategy.supports(item)) {
    return directoryListStrategy;
  }
  if (errorExtractStrategy.supports(item)) {
    return errorExtractStrategy;
  }
  return headTailStrategy;
}

export function compressItem(
  item: ContextItem,
  config: EngineConfig,
  estimator: TokenEstimator,
): CompressedContent {
  const selected = selectCompressionStrategy(item);
  const compressed = selected.compress(item, config, estimator);
  if (selected.name === "git_diff" && compressed.strategy === "head_tail") {
    return headTailStrategy.compress(item, config, estimator);
  }
  return compressed;
}

export function deterministicCompress(item: ContextItem, config: EngineConfig): string {
  const estimator = config.tokenEstimator ?? new ApproximateTokenEstimator(config.charsPerToken);
  return compressItem(item, config, estimator).content;
}

export { label };
