import type { CompressionStrategy, EngineConfig, TokenEstimator } from "../types.js";
import { budgetForKind } from "../budgets.js";
import {
  commandOf,
  exitCodeOf,
  fitToTokenBudget,
  toolText,
  uniqueStrings,
  wrapStructured,
} from "./shared.js";

const TS_ERROR_RE =
  /^(?<file>\S+):(?<line>\d+)(?::(?<col>\d+))?\s*[-–]?\s*(?:error\s+)?(?<code>TS\d+):\s*(?<msg>.+)$/i;
const GENERIC_FILE_ERROR_RE =
  /^(?<file>\S+\.\w+):(?<line>\d+)(?::(?<col>\d+))?:\s*(?:error:\s*)?(?<msg>.+)$/i;
const ERROR_CODE_RE = /\b(TS\d+|E\d{4}|error\s+[A-Z]?\d+)\b/i;
const WARNING_RE = /\b(\d+)\s+warnings?\b/i;
const ERROR_COUNT_RE = /\b(\d+)\s+errors?\b/i;

export interface ExtractedBuildError {
  file?: string;
  line?: string;
  column?: string;
  code?: string;
  message: string;
  raw: string;
}

export function extractBuildErrors(text: string): ExtractedBuildError[] {
  const errors: ExtractedBuildError[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) {
      continue;
    }
    const ts = TS_ERROR_RE.exec(line);
    if (ts?.groups) {
      errors.push({
        file: ts.groups["file"],
        line: ts.groups["line"],
        column: ts.groups["col"],
        code: ts.groups["code"]?.toUpperCase(),
        message: ts.groups["msg"]?.trim() ?? line,
        raw: line,
      });
      continue;
    }
    if (!/\berror\b/i.test(line) && !ERROR_CODE_RE.test(line)) {
      continue;
    }
    const generic = GENERIC_FILE_ERROR_RE.exec(line);
    if (generic?.groups) {
      const code = ERROR_CODE_RE.exec(line)?.[1];
      errors.push({
        file: generic.groups["file"],
        line: generic.groups["line"],
        column: generic.groups["col"],
        ...(code !== undefined ? { code } : {}),
        message: generic.groups["msg"]?.trim() ?? line,
        raw: line,
      });
    }
  }
  const seen = new Set<string>();
  return errors.filter((error) => {
    const key = `${error.file ?? ""}:${error.line ?? ""}:${error.code ?? ""}:${error.message}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function statusLine(item: { tool?: { isError?: boolean; exitCode?: number } }, text: string): string {
  if (item.tool?.exitCode === 0 && !/\bfail/i.test(text)) {
    return "BUILD SUCCEEDED";
  }
  if (item.tool?.exitCode !== undefined && item.tool.exitCode !== 0) {
    return "BUILD FAILED";
  }
  if (item.tool?.isError === true || /\bbuild failed\b|\berror ts\d+\b|\bfailed to compile\b/i.test(text)) {
    return "BUILD FAILED";
  }
  if (/\bbuilt in\b|\bbuild successful\b|\bcompiled successfully\b/i.test(text)) {
    return "BUILD SUCCEEDED";
  }
  return "BUILD STATUS UNKNOWN";
}

export function formatBuildSummary(
  item: Parameters<CompressionStrategy["compress"]>[0],
  config: EngineConfig,
  estimator: TokenEstimator,
): string {
  const text = toolText(item);
  const errors = extractBuildErrors(text);
  const warningCount = WARNING_RE.exec(text)?.[1];
  const errorCountDeclared = ERROR_COUNT_RE.exec(text)?.[1];
  const lastLines = text.trim().split(/\r?\n/).slice(-8);
  const lines = [
    statusLine(item, text),
    "",
    "Command:",
    commandOf(item) ?? item.tool?.name ?? "unknown",
  ];
  const exit = exitCodeOf(item);
  if (exit !== undefined) {
    lines.push("", "Exit code:", String(exit));
  }
  lines.push("", `Errors: ${errorCountDeclared ?? errors.length}`);
  for (const error of errors) {
    lines.push("");
    if (error.file) {
      const loc = [error.file, error.line, error.column].filter(Boolean).join(":");
      lines.push(loc);
    }
    if (error.code) {
      lines.push(error.code);
    }
    lines.push(error.message);
  }
  if (warningCount) {
    lines.push("", `Warnings: ${warningCount}`);
  }
  const relevant = uniqueStrings(
    lastLines.filter((line) => /error|failed|warning|built|succeeded/i.test(line)),
  );
  if (relevant.length > 0) {
    const extra = relevant.filter((line) => !errors.some((error) => line.includes(error.message)));
    if (extra.length > 0) {
      lines.push("", "Last relevant lines:", ...extra.slice(-8));
    }
  }
  lines.push("", "Original:", `${item.tokenCount} tokens`);
  const body = lines.join("\n");
  return fitToTokenBudget(body, budgetForKind(item.tool?.kind, config), estimator);
}

export const errorExtractStrategy: CompressionStrategy = {
  name: "error_extract",
  supports(item) {
    if (item.tool?.kind === "build_run") {
      return true;
    }
    const kind = item.tool?.failureKind;
    if (kind === "compile" || kind === "build") {
      return true;
    }
    const text = toolText(item);
    return /error ts\d+|failed to compile|compilation (error|failed)/i.test(text);
  },
  compress(item, config, estimator) {
    const body = formatBuildSummary(item, config, estimator);
    return wrapStructured("error_extract", item, body, estimator);
  },
};
