import type { CompressionStrategy, EngineConfig, TokenEstimator } from "../types.js";
import { budgetForKind } from "../budgets.js";
import { fitToTokenBudget, toolText, wrapStructured } from "./shared.js";

export const NOISY_DIRECTORIES = [
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".next",
  "target",
  "vendor",
] as const;

function noisyRoot(path: string): string | undefined {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.find((part) =>
    NOISY_DIRECTORIES.includes(part as (typeof NOISY_DIRECTORIES)[number]),
  );
}

export function parseListingPaths(text: string): string[] {
  const paths: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith("total ")) {
      continue;
    }
    const withoutLsMeta = line.replace(/^[dlrwxsStT-]+\s+\d+\s+\S+\s+\S+\s+\d+\s+\S+\s+\d+\s+[\d:]+\s+/, "");
    const path = withoutLsMeta.replace(/\/$/, "");
    if (path.length > 0) {
      paths.push(path.replace(/\\/g, "/"));
    }
  }
  return paths;
}

export function formatDirectorySummary(
  item: Parameters<CompressionStrategy["compress"]>[0],
  config: EngineConfig,
  estimator: TokenEstimator,
): string {
  const text = toolText(item);
  const paths = parseListingPaths(text);
  const root = item.tool?.path ?? item.tool?.normalizedPath ?? ".";
  const noisyCounts = new Map<string, number>();
  const kept: string[] = [];
  for (const path of paths) {
    const noisy = noisyRoot(path);
    if (noisy) {
      noisyCounts.set(noisy, (noisyCounts.get(noisy) ?? 0) + 1);
      continue;
    }
    const depth = path.split("/").filter(Boolean).length;
    if (depth <= 2) {
      kept.push(path);
    }
  }
  const lines = [
    "DIRECTORY LISTING",
    "",
    "Root:",
    root,
    "",
    `Entries: ${paths.length || text.split(/\r?\n/).filter((line) => line.trim().length > 0).length}`,
    "",
    "Top-level:",
  ];
  const topLevel = [...new Set(kept.map((path) => path.split("/")[0]).filter(Boolean))];
  lines.push(...topLevel.slice(0, 40).map((entry) => String(entry)));
  if (noisyCounts.size > 0) {
    lines.push("", "Skipped noisy directories:");
    for (const [dir, count] of noisyCounts) {
      lines.push(`${dir}/ (${count} entries)`);
    }
  }
  lines.push("", "Truncated: true", "", "Original:", `${item.tokenCount} tokens`);
  return fitToTokenBudget(lines.join("\n"), budgetForKind("directory_list", config), estimator);
}

export const directoryListStrategy: CompressionStrategy = {
  name: "directory_list",
  supports(item) {
    return item.tool?.kind === "directory_list";
  },
  compress(item, config, estimator) {
    return wrapStructured(
      "directory_list",
      item,
      formatDirectorySummary(item, config, estimator),
      estimator,
    );
  },
};
