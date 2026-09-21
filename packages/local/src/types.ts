import type { SemanticMode } from "@fast-jev/core";

export const AGENTS = ["codex", "cursor", "claude"] as const;
export type AgentId = (typeof AGENTS)[number];

export const REPORT_SCHEMA_VERSION = 1;
export const CONFIG_SCHEMA_VERSION = 1;
export const HOOK_MARKER = "--context-engine-shadow";
export const RULESET_VERSION = "ruleset-v1";

export type DataCompleteness = "full_tool_results" | "tool_calls_only" | "partial" | "unknown";

export interface EnginePaths {
  home: string;
  engineHome: string;
  configPath: string;
  reportsRoot: string;
  backupsDir: string;
  agentConfig: Record<AgentId, string>;
}

export interface LocalConfig {
  schemaVersion: number;
  enabledAgents: AgentId[];
  semanticMode: SemanticMode;
  semanticProvider: "jev" | null;
  reportPreviews: boolean;
  previewMaxChars: number;
  retentionDays: number | null;
  engineBudgets: {
    recentItemCount: number;
    largeOutputTokens: number;
  };
  hookCommand?: string;
  updatedAt: string;
}

export interface DetectedAgent {
  id: AgentId;
  displayName: string;
  installed: boolean;
  version?: string;
  binary?: string;
}

export interface StoreReport {
  schemaVersion: number;
  reportId: string;
  sessionId: string;
  agent: AgentId;
  agentVersion?: string;
  timestamp: string;
  workspaceId: string;
  workspaceDisplayName?: string;
  model?: string;
  dataCompleteness: DataCompleteness;
  originalTokens: number;
  effectiveTokens: number;
  protectedVerbatimTokens: number;
  protectedCompressibleTokens: number;
  keptTokens: number;
  compressedRetainedTokens: number;
  droppedTokens: number;
  compressionSavings: number;
  dropSavings: number;
  semanticDropSavings: number;
  potentialReductionPercent: number;
  reasonCodeTotals: Record<string, number>;
  unsafeDropCount: number;
  semanticMode: SemanticMode;
  semanticProvider?: string;
  semanticUsage?: {
    candidateCount: number;
    tokensSentExternally: number;
    providerFailures: number;
  };
  analysisDurationMs: number;
  engineVersion: string;
  coreVersion: string;
  adapterVersion: string;
  rulesetVersion: string;
  semanticPolicyVersion: string;
}

export interface HookPlan {
  agent: AgentId;
  displayName: string;
  configPath: string;
  eventName: string;
  command: string;
  existingHookCount: number;
  alreadyInstalled: boolean;
  wouldWrite: boolean;
  notes: string[];
}

export interface SetupResult {
  dryRun: boolean;
  wrote: boolean;
  plans: HookPlan[];
  configPath: string;
  backups: string[];
  skipped: string[];
}

export interface UninstallResult {
  agent: AgentId;
  configPath: string;
  removed: boolean;
  conservative: boolean;
  message: string;
  backup?: string;
}
