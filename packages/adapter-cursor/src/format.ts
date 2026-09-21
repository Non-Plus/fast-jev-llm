import {
  SHADOW_MODE_DISCLAIMER,
  type ShadowAnalysisResult,
  type ShadowItemSummary,
} from "./types.js";

function formatCount(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function padLabel(label: string, width: number): string {
  return label.padEnd(width, " ");
}

function padNum(value: number, width: number): string {
  return formatCount(value).padStart(width, " ");
}

function formatCost(value: number | undefined, unavailable?: boolean): string {
  if (unavailable || value === undefined || !Number.isFinite(value)) {
    return "unavailable";
  }
  if (value === 0) {
    return "$0.00";
  }
  if (value < 0.0001) {
    return `$${value.toExponential(2)}`;
  }
  return `$${value.toFixed(4)}`;
}

function additionalSemanticSavings(result: ShadowAnalysisResult): number {
  const originalAfterDeterministic =
    result.originalTokens - (result.deterministicStats?.totalPotentialSavings ?? result.totalPotentialSavings);
  const originalAfterFinal = result.originalTokens - result.totalPotentialSavings;
  return Math.max(0, Math.round(originalAfterDeterministic - originalAfterFinal));
}

export function formatShadowAnalysis(result: ShadowAnalysisResult): string {
  const reductions = Object.entries(result.reductionByReasonCode).sort((a, b) => b[1] - a[1]);
  const lines = [
    "Context Engine — Cursor Shadow Analysis",
    "",
    "Mode: SHADOW",
    "",
    `Cursor version: ${result.cursorVersion ?? "unknown"}`,
    `Session: ${result.sessionId}`,
    `Workspace: ${result.cwd ?? "unknown"}`,
    "",
    `${padLabel("Original", 26)}${padNum(result.originalTokens, 10)}`,
    "",
    `${padLabel("Protected verbatim", 26)}${padNum(result.protectedVerbatimTokens, 10)}`,
    `${padLabel("Protected compressible", 26)}${padNum(result.protectedCompressibleTokens, 10)}`,
    `${padLabel("Keep", 26)}${padNum(result.keptTokens, 10)}`,
    `${padLabel("Compressed", 26)}${padNum(result.compressedRetainedTokens, 10)}`,
    `${padLabel("Dropped", 26)}${padNum(result.droppedTokens, 10)}`,
    "",
    `${padLabel("Effective context", 26)}${padNum(result.effectiveTokens, 10)}`,
    "",
    `${padLabel("Compression savings", 26)}${padNum(result.compressionSavings, 10)}`,
    `${padLabel("Drop savings", 26)}${padNum(result.dropSavings, 10)}`,
    "",
    `${padLabel("Potential reduction", 26)}${result.potentialReductionPercent.toFixed(1).padStart(9)}%`,
    "",
  ];

  if (result.model) {
    lines.splice(7, 0, `Model: ${result.model}`, "");
  }

  const semantic = result.semantic;
  if (semantic && semantic.mode !== "off") {
    const keep = semantic.decisions.filter((decision) => decision.action === "KEEP").length;
    const compress = semantic.decisions.filter((decision) => decision.action === "COMPRESS").length;
    const drop = semantic.decisions.filter((decision) => decision.action === "DROP").length;
    lines.push(
      "Semantic statistics",
      "────────────────────────",
      `${padLabel("Candidates", 24)} ${padNum(semantic.candidateCount, 10)}`,
      `${padLabel("Semantic KEEP", 24)} ${padNum(keep, 10)}`,
      `${padLabel("Semantic COMPRESS", 24)} ${padNum(compress, 10)}`,
      `${padLabel("Semantic DROP", 24)} ${padNum(drop, 10)}`,
      `${padLabel("Additional potential saving", 24)} ${padNum(additionalSemanticSavings(result), 10)}`,
      "",
    );
    if (semantic.provider) {
      lines.push(
        `${padLabel("Provider", 20)} ${semantic.provider}`,
        `${padLabel("Estimated cost", 20)} ${formatCost(semantic.usage?.estimatedCost, semantic.usage?.estimatedCostUnavailable).padStart(8)}`,
        "",
      );
    }
  }

  if (reductions.length > 0) {
    lines.push("Top reductions", "────────────────────────");
    const width = Math.max(22, ...reductions.map(([code]) => code.length));
    for (const [code, tokens] of reductions.slice(0, 12)) {
      lines.push(`${padLabel(code, width)}  ${padNum(tokens, 8)}`);
    }
    lines.push("");
  }

  lines.push(SHADOW_MODE_DISCLAIMER);
  return lines.join("\n");
}

function formatExplainBlock(item: ShadowItemSummary): string {
  const lines = [
    item.action,
    "────────────────────────────────",
    "",
    "Item:",
    item.itemId,
    "",
  ];
  if (item.importance) {
    lines.push("Importance:", item.importance, "");
  }
  if (item.origin) {
    lines.push("Origin:", item.origin, "");
  }
  lines.push("Retention:", item.retention.toUpperCase(), "");
  lines.push("Compression:", item.compression.toUpperCase(), "");
  if (item.toolName) {
    lines.push("Tool:", item.toolName, "");
  }
  if (item.command) {
    lines.push("Command:", item.command, "");
  }
  lines.push("Reason:", item.reasonCode, "");
  lines.push("Original:", `${formatCount(item.originalTokens)} tokens`, "");
  lines.push("Retained:", `${formatCount(item.retainedTokens)} tokens`, "");
  lines.push("Saved:", `${formatCount(item.savedTokens)} tokens`, "");
  if (item.deterministicAction) {
    lines.push("Deterministic:", item.deterministicAction, "");
  }
  if (item.semanticEligibility) {
    lines.push("Semantic eligibility:", item.semanticEligibility.toUpperCase(), "");
  }
  if (item.provider) {
    lines.push("Provider:", item.provider, "");
  }
  if (item.relevanceScore !== undefined) {
    lines.push("Relevance:", item.relevanceScore.toFixed(2), "");
  }
  if (item.confidence !== undefined) {
    lines.push("Confidence:", item.confidence.toFixed(2), "");
  }
  if (item.semanticAction) {
    lines.push("Semantic:", item.semanticAction, "");
  }
  lines.push("Final shadow decision:", item.action, "");
  if (item.relationships.length > 0) {
    lines.push("Relationships:", ...item.relationships.map((entry) => `  ${entry}`), "");
  }
  if (item.narrative) {
    lines.push(item.narrative, "");
  }
  lines.push("Explanation:", item.reason, "");
  if (item.preview && item.preview.length > 0) {
    lines.push("Content preview:", `"${item.preview}"`, "");
  }
  return lines.join("\n");
}

export function formatShadowExplain(result: ShadowAnalysisResult): string {
  const blocks = result.items.map((item) => formatExplainBlock(item));
  return [
    "Context Engine — Cursor Shadow Explain",
    "",
    "Mode: SHADOW",
    `Cursor version: ${result.cursorVersion ?? "unknown"}`,
    `Session: ${result.sessionId}`,
    `Workspace: ${result.cwd ?? "unknown"}`,
    "",
    ...blocks,
    SHADOW_MODE_DISCLAIMER,
  ].join("\n");
}
