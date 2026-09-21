import { isToolFailure, isToolSuccess } from "../classify.js";
import { itemPath } from "../file-state.js";
import { makeDecision } from "../reasons.js";
import { budgetForKind } from "../budgets.js";
import { outputHashes } from "../output-hash.js";
import type {
  ContextDecision,
  ContextItem,
  EngineConfig,
  PruningRule,
  ReasonCode,
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

function commandIdentity(item: ContextItem): string | undefined {
  if (!item.tool) {
    return undefined;
  }
  if (item.tool.kind === "file_read" || item.tool.kind === "file_write") {
    return undefined;
  }
  return item.tool.command ?? item.tool.name;
}

function normalizedHashOf(item: ContextItem): string | undefined {
  if (item.normalizedContentHash) {
    return item.normalizedContentHash;
  }
  if (item.tool?.normalizedContentHash) {
    return item.tool.normalizedContentHash;
  }
  const text = item.tool?.result;
  if (typeof text !== "string") {
    return undefined;
  }
  return outputHashes(text).normalizedContentHash;
}

export function repeatedCommandOutputs(items: readonly ContextItem[]): ContextDecision[] {
  const latestIdentical = new Map<string, string>();
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (!item) {
      continue;
    }
    const identity = commandIdentity(item);
    const hash = normalizedHashOf(item);
    if (identity === undefined || hash === undefined) {
      continue;
    }
    const signature = `${identity}\n${hash}`;
    if (!latestIdentical.has(signature)) {
      latestIdentical.set(signature, item.id);
    }
  }

  const decisions: ContextDecision[] = [];
  for (const item of items) {
    const identity = commandIdentity(item);
    const hash = normalizedHashOf(item);
    if (identity === undefined || hash === undefined) {
      continue;
    }
    const signature = `${identity}\n${hash}`;
    const keepId = latestIdentical.get(signature);
    if (keepId !== undefined && keepId !== item.id) {
      decisions.push(
        makeDecision({
          action: "DROP",
          itemId: item.id,
          rule: "repeated-command-output",
          reasonCode: "DUPLICATE_OUTPUT",
          reason: `Later execution of "${identity}" produced equivalent output`,
          authority: "heuristic",
          retention: "normal",
          compression: "allowed",
        }),
      );
    }
  }
  return decisions;
}

function largeOutputReason(item: ContextItem): { code: ReasonCode; label: string } {
  switch (item.tool?.kind) {
    case "build_run":
      return { code: "LARGE_BUILD_OUTPUT", label: "build" };
    case "test_run":
      return { code: "LARGE_TEST_OUTPUT", label: "test" };
    case "git_diff":
      return { code: "LARGE_GIT_DIFF", label: "git diff" };
    case "directory_list":
      return { code: "LARGE_DIRECTORY_LISTING", label: "directory listing" };
    default:
      return { code: "LARGE_OUTPUT", label: "tool" };
  }
}

export function compressLargeOutput(
  items: readonly ContextItem[],
  config: EngineConfig,
): ContextDecision[] {
  const decisions: ContextDecision[] = [];
  for (const item of items) {
    if (item.kind === "message" || item.kind === "unpaired_tool_call") {
      continue;
    }
    const budget = budgetForKind(item.tool?.kind, config);
    if (item.tokenCount <= budget) {
      continue;
    }
    const reason = largeOutputReason(item);
    decisions.push(
      makeDecision({
        action: "COMPRESS",
        itemId: item.id,
        rule: "compress-large-output",
        reasonCode: reason.code,
        reason: `${reason.label} output is ${item.tokenCount} tokens (budget ${budget})`,
        authority: "heuristic",
        retention: "normal",
        compression: "allowed",
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
