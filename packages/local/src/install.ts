import type { AgentId, EnginePaths, SetupResult, UninstallResult } from "./types.js";
import { AGENTS } from "./types.js";
import { resolveHookCommand } from "./hook-command.js";
import { displayUserPath } from "./paths.js";
import { installClaude, planClaude, uninstallClaude } from "./hooks/claude.js";
import { installCodex, planCodex, uninstallCodex } from "./hooks/codex.js";
import { installCursor, planCursor, uninstallCursor } from "./hooks/cursor.js";
import { defaultConfig, loadConfig, saveConfig } from "./config.js";
import type { SemanticMode } from "@fast-jev/core";

export async function planInstall(paths: EnginePaths, hookCommand: string, agents: readonly AgentId[]) {
  const command = resolveHookCommand(hookCommand);
  const plans = [];
  for (const agent of agents) {
    if (agent === "codex") {
      plans.push(await planCodex(paths, command));
    } else if (agent === "cursor") {
      plans.push(await planCursor(paths, command));
    } else {
      plans.push(await planClaude(paths, command));
    }
  }
  return plans;
}

export function formatInstallPlan(plans: SetupResult["plans"], home?: string): string {
  const blocks = plans.map((plan) => {
    const lines = [
      plan.displayName,
      "",
      `Will update:`,
      home ? displayUserPath(plan.configPath, home) : plan.configPath,
      "",
      `Will add:`,
      `${plan.eventName} → ${plan.command}`,
      "",
      `Existing hooks:`,
      String(plan.existingHookCount),
      "",
      "No existing hooks will be removed.",
    ];
    if (plan.alreadyInstalled) {
      lines.push("", "Already installed; no write needed.");
    }
    for (const note of plan.notes) {
      lines.push("", note);
    }
    return lines.join("\n");
  });
  return blocks.join("\n\n");
}

export async function installSelected(
  paths: EnginePaths,
  options: {
    agents: readonly AgentId[];
    dryRun: boolean;
    hookCommand?: string;
    semanticMode?: SemanticMode;
    semanticProvider?: "jev" | null;
    confirmRemote?: boolean;
  },
): Promise<SetupResult> {
  if (options.semanticMode === "remote" && options.confirmRemote !== true) {
    throw new Error("Remote semantic classification requires explicit confirmation (--confirm-remote).");
  }
  const hookCommand = resolveHookCommand(options.hookCommand);
  const plans = await planInstall(paths, hookCommand, options.agents);
  const backups: string[] = [];
  const skipped: string[] = [];
  let wrote = false;
  if (!options.dryRun) {
    for (const agent of options.agents) {
      try {
        const result =
          agent === "codex"
            ? await installCodex(paths, hookCommand, false)
            : agent === "cursor"
              ? await installCursor(paths, hookCommand, false)
              : await installClaude(paths, hookCommand, false);
        if (result.backup) {
          backups.push(result.backup);
        }
        if (result.wrote) {
          wrote = true;
        } else {
          skipped.push(result.message);
        }
      } catch (error) {
        skipped.push(
          `Cannot update ${agent} config: ${error instanceof Error ? error.message : "write failed"}`,
        );
      }
    }
    const loaded = await loadConfig(paths);
    const config = loaded.error ? defaultConfig() : loaded.config;
    config.enabledAgents = [...options.agents];
    config.semanticMode = options.semanticMode ?? "off";
    config.semanticProvider = config.semanticMode === "remote" ? (options.semanticProvider ?? "jev") : null;
    config.hookCommand = hookCommand;
    config.updatedAt = new Date().toISOString();
    await saveConfig(paths, config);
    wrote = true;
  }
  return {
    dryRun: options.dryRun,
    wrote: options.dryRun ? false : wrote,
    plans,
    configPath: paths.configPath,
    backups,
    skipped,
  };
}

export async function uninstallAgents(
  paths: EnginePaths,
  agents: readonly AgentId[] = AGENTS,
  dryRun = false,
): Promise<UninstallResult[]> {
  const results: UninstallResult[] = [];
  for (const agent of agents) {
    let raw;
    try {
      raw =
        agent === "codex"
          ? await uninstallCodex(paths, dryRun)
          : agent === "cursor"
            ? await uninstallCursor(paths, dryRun)
            : await uninstallClaude(paths, dryRun);
    } catch (error) {
      results.push({
        agent,
        configPath: paths.agentConfig[agent],
        removed: false,
        conservative: true,
        message: `Cannot safely edit ${paths.agentConfig[agent]}: ${error instanceof Error ? error.message : "write failed"}`,
      });
      continue;
    }
    results.push({
      agent,
      configPath: paths.agentConfig[agent],
      removed: raw.removed,
      conservative: raw.conservative,
      message: raw.message,
      ...(raw.backup !== undefined ? { backup: raw.backup } : {}),
    });
  }
  if (!dryRun) {
    const loaded = await loadConfig(paths);
    if (loaded.exists && !loaded.error) {
      const removed = new Set(agents);
      loaded.config.enabledAgents = loaded.config.enabledAgents.filter((id) => !removed.has(id));
      loaded.config.updatedAt = new Date().toISOString();
      await saveConfig(paths, loaded.config);
    }
  }
  return results;
}
