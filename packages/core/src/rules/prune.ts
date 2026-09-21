import { isToolFailure, isToolSuccess } from "../classify.js";
import type {
  ContextDecision,
  ContextItem,
  EngineConfig,
  PruningRule,
} from "../types.js";
import { dropOlderByKey } from "./shared.js";

export function supersededFileReads(items: readonly ContextItem[]): ContextDecision[] {
  return dropOlderByKey(
    items,
    "superseded-file-read",
    (item) =>
      item.tool?.kind === "file_read" && item.tool.path
        ? item.tool.path
        : undefined,
    (key) => `Superseded by a later read of "${key}"`,
  );
}

export function supersededGitStatus(items: readonly ContextItem[]): ContextDecision[] {
  return dropOlderByKey(
    items,
    "superseded-git-status",
    (item) => (item.tool?.kind === "git_status" ? "git_status" : undefined),
    () => "Superseded by a later git status",
  );
}

export function supersededGitDiff(items: readonly ContextItem[]): ContextDecision[] {
  return dropOlderByKey(
    items,
    "superseded-git-diff",
    (item) => (item.tool?.kind === "git_diff" ? "git_diff" : undefined),
    () => "Superseded by a later git diff",
  );
}

export function oldDirectoryListings(items: readonly ContextItem[]): ContextDecision[] {
  return dropOlderByKey(
    items,
    "old-directory-listing",
    (item) => {
      if (item.tool?.kind !== "directory_list") {
        return undefined;
      }
      const glob = item.tool.args["glob"] ?? item.tool.args["pattern"];
      if (typeof glob === "string" && glob.length > 0) {
        return glob;
      }
      return item.tool.path ?? item.tool.command ?? ".";
    },
    (key) => `Superseded by a later directory listing of "${key}"`,
  );
}

export function supersededTestRuns(items: readonly ContextItem[]): ContextDecision[] {
  return dropOlderByKey(
    items,
    "superseded-test-run",
    (item) =>
      item.tool?.kind === "test_run"
        ? (item.tool.testTarget ?? item.tool.command ?? item.tool.name)
        : undefined,
    (key) => `Superseded by a later test run of "${key}"`,
  );
}

export function successfulTestSupersedesFailures(
  items: readonly ContextItem[],
): ContextDecision[] {
  const latestSuccess = new Map<string, number>();
  items.forEach((item, index) => {
    if (item.tool?.kind !== "test_run") {
      return;
    }
    if (!isToolSuccess(item.tool)) {
      return;
    }
    const target = item.tool.testTarget ?? item.tool.command ?? item.tool.name;
    latestSuccess.set(target, index);
  });

  const decisions: ContextDecision[] = [];
  items.forEach((item, index) => {
    if (item.tool?.kind !== "test_run") {
      return;
    }
    if (!isToolFailure(item.tool) || isToolSuccess(item.tool)) {
      return;
    }
    const target = item.tool.testTarget ?? item.tool.command ?? item.tool.name;
    const successIndex = latestSuccess.get(target);
    if (successIndex !== undefined && successIndex > index) {
      decisions.push({
        action: "DROP",
        itemId: item.id,
        rule: "successful-test-supersedes-failures",
        reason: `Later successful test run superseded earlier failure of "${target}"`,
      });
    }
  });
  return decisions;
}

export function repeatedCommandOutputs(items: readonly ContextItem[]): ContextDecision[] {
  return dropOlderByKey(
    items,
    "repeated-command-output",
    (item) => {
      if (!item.tool) {
        return undefined;
      }
      if (
        item.tool.kind === "file_read" ||
        item.tool.kind === "git_status" ||
        item.tool.kind === "git_diff" ||
        item.tool.kind === "directory_list" ||
        item.tool.kind === "test_run"
      ) {
        return undefined;
      }
      if (item.tool.kind !== "command" && item.tool.kind !== "other") {
        return undefined;
      }
      return item.tool.command ?? `${item.tool.name}:${JSON.stringify(item.tool.args)}`;
    },
    (key) => `Superseded by a later run of "${key}"`,
  );
}

export function compressLargeOutput(
  items: readonly ContextItem[],
  config: EngineConfig,
): ContextDecision[] {
  const decisions: ContextDecision[] = [];
  for (const item of items) {
    if (item.kind === "message") {
      continue;
    }
    if (item.tokenCount <= config.largeOutputTokens) {
      continue;
    }
    decisions.push({
      action: "COMPRESS",
      itemId: item.id,
      rule: "compress-large-output",
      reason: `Tool output is ${item.tokenCount} tokens (threshold ${config.largeOutputTokens})`,
    });
  }
  return decisions;
}

export const pruneRules: PruningRule[] = [
  {
    name: "successful-test-supersedes-failures",
    evaluate: (items) => successfulTestSupersedesFailures(items),
  },
  {
    name: "superseded-test-run",
    evaluate: (items) => supersededTestRuns(items),
  },
  {
    name: "superseded-file-read",
    evaluate: (items) => supersededFileReads(items),
  },
  {
    name: "superseded-git-status",
    evaluate: (items) => supersededGitStatus(items),
  },
  {
    name: "superseded-git-diff",
    evaluate: (items) => supersededGitDiff(items),
  },
  {
    name: "old-directory-listing",
    evaluate: (items) => oldDirectoryListings(items),
  },
  {
    name: "repeated-command-output",
    evaluate: (items) => repeatedCommandOutputs(items),
  },
  {
    name: "compress-large-output",
    evaluate: (items, config) => compressLargeOutput(items, config),
  },
];

export function applyPruneRules(
  items: readonly ContextItem[],
  config: EngineConfig,
): ContextDecision[] {
  return pruneRules.flatMap((rule) => rule.evaluate(items, config));
}
