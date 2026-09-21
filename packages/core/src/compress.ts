import { ApproximateTokenEstimator } from "./tokens.js";
import type {
  CompressedContent,
  CompressionStrategy,
  CompressionStrategyName,
  ContextItem,
  EngineConfig,
  TokenEstimator,
} from "./types.js";

const HEAD_CHARS = 400;
const TAIL_CHARS = 200;

function label(item: ContextItem): string {
  return item.tool
    ? `${item.tool.kind}${item.tool.path ? ` ${item.tool.path}` : ""}${item.tool.command ? ` \`${item.tool.command}\`` : ""}`
    : item.kind;
}

function wrap(
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

export const headTailStrategy: CompressionStrategy = {
  name: "head_tail",
  supports() {
    return true;
  },
  compress(item, _config, estimator) {
    const original = item.content;
    if (original.length <= HEAD_CHARS + TAIL_CHARS + 80) {
      return wrap("head_tail", item, original, estimator);
    }
    const head = original.slice(0, HEAD_CHARS);
    const tail = original.slice(-TAIL_CHARS);
    return wrap("head_tail", item, `${head}\n...\n${tail}`, estimator);
  },
};

const ERROR_LINE_RE =
  /error ts\d+|(?:^|\n)\s*error:|compilation (error|failed)|cannot find name|undefined reference|fatal error|failed to compile/i;

export const errorExtractStrategy: CompressionStrategy = {
  name: "error_extract",
  supports(item) {
    const kind = item.tool?.failureKind;
    if (kind === "compile" || kind === "build") {
      return true;
    }
    const text = item.tool?.result ?? item.content;
    return ERROR_LINE_RE.test(text);
  },
  compress(item, _config, estimator) {
    const lines = (item.tool?.result ?? item.content).split(/\r?\n/);
    const kept: string[] = [];
    lines.forEach((line, index) => {
      if (
        ERROR_LINE_RE.test(line) ||
        /^\s*(error ts\d+|error:|fatal error|failed to compile)\b/i.test(line)
      ) {
        const from = Math.max(0, index - 1);
        const to = Math.min(lines.length - 1, index + 2);
        for (let i = from; i <= to; i += 1) {
          const captured = lines[i];
          if (captured !== undefined && !kept.includes(captured)) {
            kept.push(captured);
          }
        }
      }
    });
    const body = kept.length > 0 ? kept.slice(0, 40).join("\n") : lines.slice(0, 20).join("\n");
    return wrap("error_extract", item, body, estimator);
  },
};

const TEST_KEEP_RE =
  /\b(PASS|FAIL|FAILING|passed|failed|Tests:|Test Files|AssertionError|expected|received)\b/;

export const testSummaryStrategy: CompressionStrategy = {
  name: "test_summary",
  supports(item) {
    return item.tool?.kind === "test_run" || item.tool?.failureKind === "test";
  },
  compress(item, _config, estimator) {
    const lines = (item.tool?.result ?? item.content).split(/\r?\n/);
    const kept = lines.filter((line) => TEST_KEEP_RE.test(line)).slice(0, 40);
    const body = kept.length > 0 ? kept.join("\n") : lines.slice(0, 20).join("\n");
    return wrap("test_summary", item, body, estimator);
  },
};

export const compressionStrategies: CompressionStrategy[] = [
  testSummaryStrategy,
  errorExtractStrategy,
  headTailStrategy,
];

export function selectCompressionStrategy(item: ContextItem): CompressionStrategy {
  if (testSummaryStrategy.supports(item)) {
    return testSummaryStrategy;
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
  return selectCompressionStrategy(item).compress(item, config, estimator);
}

export function deterministicCompress(item: ContextItem, config: EngineConfig): string {
  const estimator = config.tokenEstimator ?? new ApproximateTokenEstimator(config.charsPerToken);
  return compressItem(item, config, estimator).content;
}
