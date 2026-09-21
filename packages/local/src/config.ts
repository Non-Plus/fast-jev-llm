import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { DEFAULT_CONFIG, type SemanticMode } from "@fast-jev/core";
import type { EnginePaths, LocalConfig } from "./types.js";
import { AGENTS, CONFIG_SCHEMA_VERSION } from "./types.js";

export function defaultConfig(now = new Date()): LocalConfig {
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    enabledAgents: [...AGENTS],
    semanticMode: "off",
    semanticProvider: null,
    reportPreviews: false,
    previewMaxChars: DEFAULT_CONFIG.previewMaxChars,
    retentionDays: null,
    engineBudgets: {
      recentItemCount: DEFAULT_CONFIG.recentItemCount,
      largeOutputTokens: DEFAULT_CONFIG.largeOutputTokens,
    },
    updatedAt: now.toISOString(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseConfig(raw: unknown): LocalConfig {
  const fallback = defaultConfig();
  if (!isRecord(raw)) {
    return fallback;
  }
  const agents = Array.isArray(raw.enabledAgents)
    ? raw.enabledAgents.filter((entry): entry is LocalConfig["enabledAgents"][number] =>
        AGENTS.includes(entry as LocalConfig["enabledAgents"][number]),
      )
    : fallback.enabledAgents;
  const mode = raw.semanticMode;
  const semanticMode: SemanticMode =
    mode === "off" || mode === "local" || mode === "remote" ? mode : "off";
  const provider = raw.semanticProvider === "jev" ? "jev" : null;
  return {
    schemaVersion: typeof raw.schemaVersion === "number" ? raw.schemaVersion : CONFIG_SCHEMA_VERSION,
    enabledAgents: agents.length > 0 ? agents : fallback.enabledAgents,
    semanticMode,
    semanticProvider: semanticMode === "remote" ? provider : null,
    reportPreviews: raw.reportPreviews === true,
    previewMaxChars:
      typeof raw.previewMaxChars === "number" && raw.previewMaxChars > 0
        ? raw.previewMaxChars
        : fallback.previewMaxChars,
    retentionDays:
      typeof raw.retentionDays === "number" && raw.retentionDays > 0 ? raw.retentionDays : null,
    engineBudgets: {
      recentItemCount:
        isRecord(raw.engineBudgets) && typeof raw.engineBudgets.recentItemCount === "number"
          ? raw.engineBudgets.recentItemCount
          : fallback.engineBudgets.recentItemCount,
      largeOutputTokens:
        isRecord(raw.engineBudgets) && typeof raw.engineBudgets.largeOutputTokens === "number"
          ? raw.engineBudgets.largeOutputTokens
          : fallback.engineBudgets.largeOutputTokens,
    },
    ...(typeof raw.hookCommand === "string" ? { hookCommand: raw.hookCommand } : {}),
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : fallback.updatedAt,
  };
}

export async function loadConfig(paths: EnginePaths): Promise<{
  config: LocalConfig;
  exists: boolean;
  error?: string;
}> {
  try {
    const text = await readFile(paths.configPath, "utf8");
    try {
      return { config: parseConfig(JSON.parse(text) as unknown), exists: true };
    } catch (error) {
      return {
        config: defaultConfig(),
        exists: true,
        error: error instanceof Error ? error.message : "malformed config",
      };
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { config: defaultConfig(), exists: false };
    }
    return {
      config: defaultConfig(),
      exists: false,
      error: error instanceof Error ? error.message : "unreadable config",
    };
  }
}

export async function saveConfig(paths: EnginePaths, config: LocalConfig): Promise<void> {
  await mkdir(dirname(paths.configPath), { recursive: true });
  await writeFile(paths.configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}
