import { SHADOW_MODE_DISCLAIMER, type ShadowAnalysisResult, type ShadowItemSummary, type ShadowStatistics } from "./types.js";

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

function statsBlock(title: string, stats: ShadowStatistics): string[] {
  return [
    title,
    `${padLabel("Protected", 24)} ${padNum(stats.retentionProtectedTokens, 10)}`,
    `${padLabel("Kept", 24)} ${padNum(stats.keptTokens, 10)}`,
    `${padLabel("Compressed", 24)} ${padNum(stats.compressedTokens, 10)}`,
    `${padLabel("Dropped", 24)} ${padNum(stats.droppedTokens, 10)}`,
    "",
    `${padLabel("Potential reduction", 24)} ${stats.potentialReductionPercent.toFixed(1).padStart(10)}%`,
  ];
}

export function formatShadowAnalysis(result: ShadowAnalysisResult): string {
  const reductions = Object.entries(result.reductionByReasonCode).sort((a, b) => b[1] - a[1]);
  const deterministic = result.deterministicStats ?? {
    originalTokens: result.originalTokens,
    protectedTokens: result.protectedTokens,
    protectedVerbatimTokens: result.protectedVerbatimTokens,
    protectedCompressibleTokens: result.protectedCompressibleTokens,
    retentionProtectedTokens: result.retentionProtectedTokens,
    keptTokens: result.keptTokens,
    compressedTokens: result.compressedTokens,
    compressedRetainedTokens: result.compressedRetainedTokens,
    droppedTokens: result.droppedTokens,
    compressionSavings: result.compressionSavings,
    dropSavings: result.dropSavings,
    totalPotentialSavings: result.totalPotentialSavings,
    potentialReductionPercent: result.potentialReductionPercent,
    itemCount: result.itemCount,
    protectedItems: result.protectedItems,
    keptItems: result.keptItems,
    compressedItems: result.compressedItems,
    droppedItems: result.droppedItems,
  };

  const lines = [
    "Context Engine — Codex Shadow Analysis",
    "",
    "Mode: SHADOW",
    `Session: ${result.sessionId}`,
    "",
    `Original                    ${padNum(result.originalTokens, 10)}`,
    "",
    ...statsBlock("DETERMINISTIC", deterministic),
    "",
  ];

  const semantic = result.semantic;
  if (semantic && semantic.mode !== "off") {
    const keep = semantic.decisions.filter((decision) => decision.action === "KEEP").length;
    const compress = semantic.decisions.filter((decision) => decision.action === "COMPRESS").length;
    const drop = semantic.decisions.filter((decision) => decision.action === "DROP").length;
    lines.push(
      "SEMANTIC",
      `${padLabel("Candidates", 24)} ${padNum(semantic.candidateCount, 10)}`,
      `${padLabel("Semantic KEEP", 24)} ${padNum(keep, 10)}`,
      `${padLabel("Semantic COMPRESS", 24)} ${padNum(compress, 10)}`,
      `${padLabel("Semantic DROP", 24)} ${padNum(drop, 10)}`,
      "",
      `${padLabel("Additional potential saving", 24)} ${padNum(additionalSemanticSavings(result), 10)}`,
      `${padLabel("Combined potential reduction", 24)} ${result.potentialReductionPercent.toFixed(1).padStart(10)}%`,
      "",
    );
    if (semantic.provider) {
      lines.push(
        "Semantic classification",
        "",
        `${padLabel("Provider", 20)} ${semantic.provider}`,
        `${padLabel("Requests", 20)} ${padNum(semantic.usage?.requests ?? semantic.batchCount, 8)}`,
        `${padLabel("Candidates", 20)} ${padNum(semantic.candidateCount, 8)}`,
        `${padLabel(
          "Input tokens",
          20,
        )} ${semantic.usage?.inputTokens !== undefined ? padNum(semantic.usage.inputTokens, 8) : "unknown".padStart(8)}`,
        `${padLabel("Latency", 20)} ${(semantic.providerLatencyMs / 1000).toFixed(2).padStart(8)}s`,
        `${padLabel("Estimated cost", 20)} ${formatCost(semantic.usage?.estimatedCost, semantic.usage?.estimatedCostUnavailable).padStart(8)}`,
        "",
      );
    }
    const drops = result.items.filter((item) => item.semanticAction === "DROP" && item.action === "DROP");
    if (drops.length > 0) {
      lines.push("Semantic DROP inspection", "────────────────────────");
      for (const item of drops) {
        lines.push(
          `Item: ${item.itemId}`,
          `Preview: ${item.preview ?? "(omitted)"}`,
          `Relevance: ${item.relevanceScore ?? "n/a"}`,
          `Confidence: ${item.confidence ?? "n/a"}`,
          `Reason: ${item.reason}`,
          `Relationships: ${item.relationships.join("; ") || "(none)"}`,
          "Why no protection: item was semantically eligible and not retention-protected.",
          "",
        );
      }
    }
    if (semantic.disagreements.length > 0) {
      lines.push("Disagreements", "────────────────────────");
      for (const disagreement of semantic.disagreements) {
        lines.push(
          `Item: ${disagreement.itemId}`,
          `Deterministic: ${disagreement.deterministicAction} — ${disagreement.deterministicReason}`,
          `Semantic: ${disagreement.semanticAction} — ${disagreement.semanticReason}`,
          `Final policy result: ${disagreement.finalAction}`,
          "",
        );
      }
    }
  }

  lines.push(
    "Items",
    "────────────────────────",
    `${padLabel("Protected (verbatim)", 24)} ${padNum(result.protectedItems, 8)}`,
    `${padLabel("Kept", 24)} ${padNum(result.keptItems, 8)}`,
    `${padLabel("Compressed", 24)} ${padNum(result.compressedItems, 8)}`,
    `${padLabel("Dropped", 24)} ${padNum(result.droppedItems, 8)}`,
    "",
    "Top reductions",
    "────────────────────────",
  );

  if (reductions.length === 0) {
    lines.push("(none)");
  } else {
    const width = Math.max(22, ...reductions.map(([code]) => code.length));
    for (const [code, tokens] of reductions.slice(0, 12)) {
      lines.push(`${padLabel(code, width)}  ${padNum(tokens, 8)}`);
    }
  }

  lines.push("", SHADOW_MODE_DISCLAIMER);
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
    "Context Engine — Codex Shadow Explain",
    "",
    "Mode: SHADOW",
    `Session: ${result.sessionId}`,
    "",
    ...blocks,
    SHADOW_MODE_DISCLAIMER,
  ].join("\n");
}
