import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import type { AgentId, EnginePaths, StoreReport } from "../src/types.js";
import { resolveEnginePaths } from "../src/paths.js";

const testHomesRoot = fileURLToPath(new URL("../.testhomes", import.meta.url));

export function codexFixture(name: string): string {
  return fileURLToPath(new URL(`../../adapter-codex/fixtures/${name}`, import.meta.url));
}

export function cursorFixture(name: string): string {
  return fileURLToPath(new URL(`../../adapter-cursor/fixtures/${name}`, import.meta.url));
}

export function claudeFixture(name: string): string {
  return fileURLToPath(new URL(`../../adapter-claude/fixtures/${name}`, import.meta.url));
}

export async function makeFakeHome(): Promise<{ home: string; paths: EnginePaths; cleanup: () => Promise<void> }> {
  await mkdir(testHomesRoot, { recursive: true });
  const home = await mkdtemp(join(testHomesRoot, "ctx-engine-home-"));
  const engineHome = join(home, ".context-engine");
  const paths = resolveEnginePaths({ home, engineHome });
  // Agent config dirs named ".cursor"/".claude" are blocked in this environment.
  // Tests remap to sibling folders so we never touch the real user configs.
  paths.agentConfig.codex = join(home, "codex-config", "hooks.json");
  paths.agentConfig.cursor = join(home, "cursor-config", "hooks.json");
  paths.agentConfig.claude = join(home, "claude-config", "settings.json");
  return {
    home,
    paths,
    cleanup: async () => {
      await rm(home, { recursive: true, force: true });
    },
  };
}

export async function seedAgentConfigs(paths: EnginePaths): Promise<void> {
  await mkdir(dirname(paths.agentConfig.codex), { recursive: true });
  await mkdir(dirname(paths.agentConfig.cursor), { recursive: true });
  await mkdir(dirname(paths.agentConfig.claude), { recursive: true });
  await writeFile(
    paths.agentConfig.codex,
    `${JSON.stringify(
      {
        hooks: {
          PreToolUse: [
            {
              hooks: [{ type: "command", command: "echo unrelated-codex-pre" }],
            },
          ],
          SessionEnd: [
            {
              hooks: [{ type: "command", command: "echo unrelated-codex-end" }],
            },
          ],
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    paths.agentConfig.cursor,
    `${JSON.stringify(
      {
        version: 1,
        hooks: {
          sessionEnd: [{ command: "echo unrelated-cursor-end", timeout: 5 }],
          sessionStart: [{ command: "echo unrelated-cursor-start" }],
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    paths.agentConfig.claude,
    `${JSON.stringify(
      {
        permissions: { allow: ["Bash"] },
        hooks: {
          PreToolUse: [
            {
              hooks: [{ type: "command", command: "echo unrelated-claude-pre" }],
            },
          ],
          SessionEnd: [
            {
              hooks: [{ type: "command", command: "echo unrelated-claude-end", timeout: 10 }],
            },
          ],
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

export function captureIo(): { stdout: Writable; stderr: Writable; text: () => string; errText: () => string } {
  let out = "";
  let err = "";
  const stdout = new Writable({
    write(chunk, _encoding, callback) {
      out += String(chunk);
      callback();
    },
  });
  const stderr = new Writable({
    write(chunk, _encoding, callback) {
      err += String(chunk);
      callback();
    },
  });
  return {
    stdout,
    stderr,
    text: () => out,
    errText: () => err,
  };
}

export function sampleReport(overrides: Partial<StoreReport> & Pick<StoreReport, "sessionId" | "agent">): StoreReport {
  return {
    schemaVersion: 1,
    reportId: `${overrides.agent}-${overrides.sessionId}`,
    agentVersion: "test",
    timestamp: "2026-09-21T00:00:00.000Z",
    workspaceId: "abcd1234abcd1234",
    workspaceDisplayName: "sample-app",
    model: "gpt-test",
    dataCompleteness: "full_tool_results",
    originalTokens: 1000,
    effectiveTokens: 400,
    protectedVerbatimTokens: 100,
    protectedCompressibleTokens: 50,
    keptTokens: 200,
    compressedRetainedTokens: 150,
    droppedTokens: 500,
    compressionSavings: 400,
    dropSavings: 200,
    semanticDropSavings: 0,
    potentialReductionPercent: 60,
    reasonCodeTotals: { LARGE_OUTPUT: 200, SUPERSEDED_FILE_READ: 100 },
    unsafeDropCount: 0,
    semanticMode: "off",
    analysisDurationMs: 12,
    engineVersion: "0.1.0",
    coreVersion: "0.1.0",
    adapterVersion: "0.1.0",
    rulesetVersion: "ruleset-v1",
    semanticPolicyVersion: "semantic-policy-v1",
    ...overrides,
  };
}

export function assertFakeHome(paths: EnginePaths): void {
  if (!paths.home.includes("ctx-engine-home-")) {
    throw new Error(`Refusing to run setup tests against ${paths.home}`);
  }
}

export function countMarker(text: string): number {
  return text.split("--context-engine-shadow").length - 1;
}

export type { AgentId };
