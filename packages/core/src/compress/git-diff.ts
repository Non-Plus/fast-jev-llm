import type { CompressionStrategy, EngineConfig, TokenEstimator } from "../types.js";
import { budgetForKind } from "../budgets.js";
import { commandOf, fitToTokenBudget, toolText, wrapStructured } from "./shared.js";

const DIFF_GIT_RE = /^diff --git a\/(.+) b\/(.+)$/;
const STAT_RE = /(\d+) files? changed(?:,\s*(\d+) insertions?\(\+\))?(?:,\s*(\d+) deletions?\(-\))?/;

export function parseGitDiffMeta(text: string): {
  files: string[];
  insertions?: number;
  deletions?: number;
  filesChanged?: number;
} {
  const files: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = DIFF_GIT_RE.exec(line);
    const path = match?.[2] ?? match?.[1];
    if (path && !files.includes(path)) {
      files.push(path);
    }
  }
  const stat = STAT_RE.exec(text);
  return {
    files,
    ...(stat?.[1] !== undefined ? { filesChanged: Number(stat[1]) } : {}),
    ...(stat?.[2] !== undefined ? { insertions: Number(stat[2]) } : {}),
    ...(stat?.[3] !== undefined ? { deletions: Number(stat[3]) } : {}),
  };
}

function compactHunks(text: string, maxHunkLines: number): string[] {
  const hunks: string[] = [];
  let current: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("diff --git") || line.startsWith("@@")) {
      if (current.length > 0) {
        hunks.push(current.join("\n"));
      }
      current = [line];
      continue;
    }
    if (current.length === 0) {
      continue;
    }
    if (/^[+\-@ ]/.test(line) || line.startsWith("index ") || line.startsWith("---") || line.startsWith("+++")) {
      if (current.length < maxHunkLines) {
        current.push(line);
      } else if (current[current.length - 1] !== "…") {
        current.push("…");
      }
    }
  }
  if (current.length > 0) {
    hunks.push(current.join("\n"));
  }
  return hunks;
}

export function formatGitDiffSummary(
  item: Parameters<CompressionStrategy["compress"]>[0],
  config: EngineConfig,
  estimator: TokenEstimator,
): string | undefined {
  const text = toolText(item);
  if (!/^diff --git /m.test(text) && !STAT_RE.test(text)) {
    return undefined;
  }
  const meta = parseGitDiffMeta(text);
  const lines = ["GIT DIFF", "", "Command:", commandOf(item) ?? "git diff"];
  const changed = meta.filesChanged ?? meta.files.length;
  if (changed > 0) {
    lines.push("", `Files changed: ${changed}`);
  }
  if (meta.insertions !== undefined || meta.deletions !== undefined) {
    lines.push(
      `Insertions: ${meta.insertions ?? "unknown"}`,
      `Deletions: ${meta.deletions ?? "unknown"}`,
    );
  }
  if (meta.files.length > 0) {
    lines.push("", "Files:", ...meta.files.slice(0, 40));
  }
  const hunks = compactHunks(text, 12);
  if (hunks.length > 0) {
    lines.push("", "Hunks:");
    lines.push(...hunks.slice(0, 8));
  }
  lines.push("", "Original:", `${item.tokenCount} tokens`);
  return fitToTokenBudget(lines.join("\n"), budgetForKind("git_diff", config), estimator);
}

export const gitDiffStrategy: CompressionStrategy = {
  name: "git_diff",
  supports(item) {
    return item.tool?.kind === "git_diff" || /^diff --git /m.test(toolText(item));
  },
  compress(item, config, estimator) {
    const structured = formatGitDiffSummary(item, config, estimator);
    if (!structured) {
      return {
        strategy: "head_tail",
        originalTokens: item.tokenCount,
        retainedTokens: estimator.estimate(toolText(item)),
        content: toolText(item),
      };
    }
    return wrapStructured("git_diff", item, structured, estimator);
  },
};
