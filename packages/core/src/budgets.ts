import type { EngineConfig, ToolKind, ToolOutputBudgets } from "./types.js";

export const DEFAULT_TOOL_OUTPUT_BUDGETS: ToolOutputBudgets = {
  generic: 2000,
  build: 2000,
  test: 1500,
  gitDiff: 3000,
  directoryList: 1000,
};

export function resolveToolOutputBudgets(
  config: Pick<EngineConfig, "toolOutputBudgets" | "largeOutputTokens">,
): ToolOutputBudgets {
  return {
    generic: config.toolOutputBudgets.generic ?? config.largeOutputTokens,
    build: config.toolOutputBudgets.build,
    test: config.toolOutputBudgets.test,
    gitDiff: config.toolOutputBudgets.gitDiff,
    directoryList: config.toolOutputBudgets.directoryList,
  };
}

export function budgetForKind(
  kind: ToolKind | undefined,
  config: Pick<EngineConfig, "toolOutputBudgets" | "largeOutputTokens">,
): number {
  const budgets = resolveToolOutputBudgets(config);
  switch (kind) {
    case "build_run":
      return budgets.build;
    case "test_run":
      return budgets.test;
    case "git_diff":
      return budgets.gitDiff;
    case "directory_list":
      return budgets.directoryList;
    default:
      return budgets.generic;
  }
}
