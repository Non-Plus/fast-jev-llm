import { createHash } from "node:crypto";
import type { StoreReport } from "./types.js";
import { REPORT_SCHEMA_VERSION } from "./types.js";
import { isRecord } from "./json.js";

const SAFETY_CODES = new Set([
  "USER_CONSTRAINT",
  "CURRENT_TASK",
  "UNRESOLVED_ERROR",
  "SYSTEM_INSTRUCTION",
]);

export function reportIdentity(input: {
  agent: string;
  sessionId: string;
  engineVersion: string;
  semanticMode: string;
}): string {
  return createHash("sha256")
    .update([input.agent, input.sessionId, input.engineVersion, input.semanticMode].join("|"))
    .digest("hex")
    .slice(0, 16);
}

export function reportFileName(report: Pick<StoreReport, "sessionId" | "engineVersion" | "semanticMode">): string {
  const session = report.sessionId.replace(/[^A-Za-z0-9._-]+/g, "_");
  const engine = report.engineVersion.replace(/[^A-Za-z0-9._-]+/g, "_");
  return `${session}--${engine}--${report.semanticMode}.json`;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function parseStoreReport(raw: unknown): StoreReport | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  if (raw.schemaVersion !== REPORT_SCHEMA_VERSION) {
    return undefined;
  }
  if (typeof raw.sessionId !== "string" || typeof raw.agent !== "string") {
    return undefined;
  }
  if (raw.agent !== "codex" && raw.agent !== "cursor" && raw.agent !== "claude") {
    return undefined;
  }
  const originalTokens = finiteNumber(raw.originalTokens);
  const effectiveTokens = finiteNumber(raw.effectiveTokens);
  if (originalTokens === undefined || effectiveTokens === undefined) {
    return undefined;
  }
  const completeness = raw.dataCompleteness;
  if (
    completeness !== "full_tool_results" &&
    completeness !== "tool_calls_only" &&
    completeness !== "partial" &&
    completeness !== "unknown"
  ) {
    return undefined;
  }
  const reasonCodeTotals = isRecord(raw.reasonCodeTotals)
    ? Object.fromEntries(
        Object.entries(raw.reasonCodeTotals).filter((entry): entry is [string, number] => typeof entry[1] === "number"),
      )
    : {};
  return {
    ...(raw as unknown as StoreReport),
    originalTokens,
    effectiveTokens,
    protectedVerbatimTokens: finiteNumber(raw.protectedVerbatimTokens) ?? 0,
    protectedCompressibleTokens: finiteNumber(raw.protectedCompressibleTokens) ?? 0,
    keptTokens: finiteNumber(raw.keptTokens) ?? 0,
    compressedRetainedTokens: finiteNumber(raw.compressedRetainedTokens) ?? 0,
    droppedTokens: finiteNumber(raw.droppedTokens) ?? 0,
    compressionSavings: finiteNumber(raw.compressionSavings) ?? 0,
    dropSavings: finiteNumber(raw.dropSavings) ?? 0,
    semanticDropSavings: finiteNumber(raw.semanticDropSavings) ?? 0,
    potentialReductionPercent: finiteNumber(raw.potentialReductionPercent) ?? 0,
    reasonCodeTotals,
    unsafeDropCount: finiteNumber(raw.unsafeDropCount) ?? 0,
    analysisDurationMs: finiteNumber(raw.analysisDurationMs) ?? 0,
    dataCompleteness: completeness,
  };
}

export function isUnsafeDropReason(reasonCode: string, retention?: string): boolean {
  return SAFETY_CODES.has(reasonCode) || retention === "protected";
}

export { SAFETY_CODES };
