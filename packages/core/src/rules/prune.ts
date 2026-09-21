import { isToolFailure, isToolSuccess } from "../classify.js";
import { itemPath } from "../file-state.js";
import { makeDecision } from "../reasons.js";
import type {
  ContextDecision,
  ContextItem,
  EngineConfig,
  PruningRule,
} from "../types.js";
import { dropOlderByKey } from "./shared.js";

export function supersededFileReads(items: readonly ContextItem[]): ContextDecision[] {
  const decisions: ContextDecision[] = [];

  const opsByPath = new Map<string, ContextItem[]>();
  for (const item of items) {
    if (!item.tool) {
      continue;
    }
    if (item.tool.kind !== "file_read" && item.tool.kind !== "file_write") {
      continue;
    }
    const path = itemPath(item);
    if (!path) {
      continue;
    }
    const list = opsByPath.get(path) ?? [];
    list.push(item);
    opsByPath.set(path, list);
  }

  for (const [path, ops] of opsByPath) {
    for (let i = 0; i < ops.length; i += 1) {
      const current = ops[i];
      if (!current || current.tool?.kind !== "file_read") {
        continue;
      }
      let sawWrite = false;
      let laterRead: ContextItem | undefined;
      for (let j = i + 1; j < ops.length; j += 1) {
        const next = ops[j];
        if (!next?.tool) {
          continue;
        }
        if (next.tool.kind === "file_write") {
          sawWrite = true;
          continue;
        }
        if (next.tool.kind === "file_read") {
          laterRead = next;
          break;
        }
      }
      if (!laterRead) {
        continue;
      }
      if (sawWrite) {
        decisions.push(
          makeDecision({
            action: "DROP",
            itemId: current.id,
            rule: "superseded-file-read",
            reasonCode: "WRITE_INVALIDATED_READ",
            reason: `Read of "${path}" was invalidated by a write before a later read`,
            authority: "structural",
          }),
        );
      } else {
        decisions.push(
          makeDecision({
            action: "DROP",
            itemId: current.id,
            rule: "superseded-file-read",
            reasonCode: "SUPERSEDED_FILE_READ",
            reason: `Superseded by a later read of "${path}"`,
            authority: "structural",
          }),
        );
      }
    }
  }

  return decisions;
}

export function supersededGitStatus(items: readonly ContextItem[]): ContextDecision[] {
  return dropOlderByKey(
    items,
    "superseded-git-status",
    (item) => (item.tool?.kind === "git_status" ? "git_status" : undefined),
    () => "Superseded by a later git status",
    {
      reasonCode: "SUPERSEDED_GIT_STATUS",
      authority: "structural",
      relation: "supersedes",
    },
  ).decisions;
}

export function supersededGitDiff(items: readonly ContextItem[]): ContextDecision[] {
  return dropOlderByKey(
    items,
    "superseded-git-diff",
    (item) => (item.tool?.kind === "git_diff" ? "git_diff" : undefined),
    () => "Superseded by a later git diff",
    {
      reasonCode: "SUPERSEDED_GIT_DIFF",
      authority: "structural",
      relation: "supersedes",
    },
  ).decisions;
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
      return item.tool.normalizedPath ?? item.tool.path ?? item.tool.command ?? ".";
    },
    (key) => `Superseded by a later directory listing of "${key}"`,
    {
      reasonCode: "OLD_DIRECTORY_LISTING",
      authority: "structural",
      relation: "supersedes",
    },
  ).decisions;
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
    {
      reasonCode: "SUPERSEDED_TEST_RUN",
      authority: "structural",
      relation: "supersedes",
    },
  ).decisions;
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
      decisions.push(
        makeDecision({
          action: "DROP",
          itemId: item.id,
          rule: "successful-test-supersedes-failures",
          reasonCode: "TEST_FAILURE_RESOLVED",
          reason: `Later successful test run superseded earlier failure of "${target}"`,
          authority: "structural",
        }),
      );
    }
  });
  return decisions;
}

function normalizeOutput(text: string): string {
  return text.replace(/\r\n/g, "\n").trimEnd();
}

function commandOutput(item: ContextItem): string {
  return normalizeOutput(item.tool?.result ?? item.content);
}

function commandKey(item: ContextItem): string | undefined {
  if (!item.tool) {
    return undefined;
  }
  if (
    item.tool.kind === "file_read" ||
    item.tool.kind === "file_write" ||
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
}

export function repeatedCommandOutputs(items: readonly ContextItem[]): ContextDecision[] {
  const latestIdentical = new Map<string, string>();
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (!item) {
      continue;
    }
    const key = commandKey(item);
    if (key === undefined) {
      continue;
    }
    const signature = `${key}\n${commandOutput(item)}`;
    if (!latestIdentical.has(signature)) {
      latestIdentical.set(signature, item.id);
    }
  }

  const decisions: ContextDecision[] = [];
  for (const item of items) {
    const key = commandKey(item);
    if (key === undefined) {
      continue;
    }
    const signature = `${key}\n${commandOutput(item)}`;
    const keepId = latestIdentical.get(signature);
    if (keepId !== undefined && keepId !== item.id) {
      decisions.push(
        makeDecision({
          action: "DROP",
          itemId: item.id,
          rule: "repeated-command-output",
          reasonCode: "DUPLICATE_OUTPUT",
          reason: `Later execution of "${key}" produced identical output`,
          authority: "heuristic",
        }),
      );
    }
  }
  return decisions;
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
    decisions.push(
      makeDecision({
        action: "COMPRESS",
        itemId: item.id,
        rule: "compress-large-output",
        reasonCode: "LARGE_OUTPUT",
        reason: `Tool output is ${item.tokenCount} tokens (threshold ${config.largeOutputTokens})`,
        authority: "heuristic",
      }),
    );
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
