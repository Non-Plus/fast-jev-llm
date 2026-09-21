import { access, constants } from "node:fs/promises";
import type { EnginePaths } from "./types.js";
import { loadConfig } from "./config.js";
import { detectAgents } from "./detect.js";
import { planInstall } from "./install.js";
import { resolveHookCommand } from "./hook-command.js";
import { loadReports } from "./store.js";
import { formatAgo } from "./format.js";
import { jevProviderFromEnv } from "@fast-jev/provider-jev";
import { HOOK_MARKER } from "./types.js";
import { readJsonFile } from "./hooks/io.js";

export async function formatStatus(paths: EnginePaths): Promise<string> {
  const { config, exists } = await loadConfig(paths);
  const detected = detectAgents();
  const hookCommand = resolveHookCommand(config.hookCommand);
  const plans = await planInstall(paths, hookCommand, ["codex", "cursor", "claude"]);
  const { reports } = await loadReports(paths);
  const last = [...reports].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))[0];
  const enabled = new Set(config.enabledAgents);
  const jev = jevProviderFromEnv();

  const agentLine = (id: "codex" | "cursor" | "claude", name: string) => {
    const found = detected.find((entry) => entry.id === id);
    const mark = enabled.has(id) && found?.installed ? "✓ enabled" : found?.installed ? "detected" : "not found";
    return `${name.padEnd(24)} ${mark}`;
  };

  const hookLine = (plan: (typeof plans)[number]) =>
    `${plan.displayName} ${plan.eventName}`.padEnd(24) + (plan.alreadyInstalled ? "✓" : "missing");

  return [
    "Context Engine",
    "",
    "Mode",
    "────────────────────────",
    `Shadow analysis          ${exists || reports.length > 0 ? "ON" : "OFF"}`,
    `Semantic mode            ${config.semanticMode.toUpperCase()}`,
    `Remote providers         ${config.semanticMode === "remote" && jev ? "ON" : "OFF"}`,
    "",
    "Agents",
    "────────────────────────",
    agentLine("codex", "Codex"),
    agentLine("cursor", "Cursor"),
    agentLine("claude", "Claude Code"),
    "",
    "Hooks",
    "────────────────────────",
    ...plans.map(hookLine),
    "",
    "Reports",
    "────────────────────────",
    `Sessions analyzed        ${reports.length}`,
    `Last analysis            ${last ? formatAgo(last.timestamp) : "never"}`,
    "",
    "Privacy",
    "────────────────────────",
    "Raw transcripts stored   NO",
    `Source previews stored    ${config.reportPreviews ? "YES" : "NO"}`,
    "Telemetry                 OFF",
  ].join("\n");
}

export async function hookPresent(paths: EnginePaths, agent: "codex" | "cursor" | "claude"): Promise<boolean> {
  const read = await readJsonFile(paths.agentConfig[agent]);
  if (!read.ok) {
    return false;
  }
  return JSON.stringify(read.value).includes(HOOK_MARKER);
}

export async function formatDogfood(paths: EnginePaths): Promise<string> {
  const { config } = await loadConfig(paths);
  const detected = detectAgents();
  const hookCommand = resolveHookCommand(config.hookCommand);
  const plans = await planInstall(paths, hookCommand, ["codex", "cursor", "claude"]);
  const { reports } = await loadReports(paths);
  const timestamps = reports.map((report) => Date.parse(report.timestamp)).filter((value) => Number.isFinite(value));
  const oldest = timestamps.length > 0 ? Math.min(...timestamps) : undefined;
  const newest = timestamps.length > 0 ? Math.max(...timestamps) : undefined;
  const periodDays =
    oldest !== undefined && newest !== undefined
      ? Math.max(1, Math.ceil((newest - oldest) / (24 * 60 * 60 * 1000)))
      : 0;

  const line = (id: "codex" | "cursor" | "claude", name: string) => {
    const found = detected.find((entry) => entry.id === id);
    const plan = plans.find((entry) => entry.agent === id);
    const collecting = Boolean(found?.installed && plan?.alreadyInstalled && config.enabledAgents.includes(id));
    return `${name.padEnd(11)} ${collecting ? "✓ collecting" : "not collecting"}`;
  };

  return [
    "Dogfooding",
    "",
    line("codex", "Codex"),
    line("cursor", "Cursor"),
    line("claude", "Claude"),
    "",
    `Reports     ${reports.length}`,
    `Period      ${periodDays} day${periodDays === 1 ? "" : "s"}`,
    "",
    `Semantic    ${config.semanticMode.toUpperCase()}`,
  ].join("\n");
}

export async function engineHomeWritable(paths: EnginePaths): Promise<boolean> {
  try {
    await access(paths.engineHome, constants.W_OK);
    return true;
  } catch {
    try {
      const { mkdir } = await import("node:fs/promises");
      await mkdir(paths.engineHome, { recursive: true });
      return true;
    } catch {
      return false;
    }
  }
}
