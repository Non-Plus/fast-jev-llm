import { spawnSync } from "node:child_process";
import type { AgentId, DetectedAgent } from "./types.js";

const DISPLAY: Record<AgentId, string> = {
  codex: "Codex",
  cursor: "Cursor",
  claude: "Claude Code",
};

const BINARIES: Record<AgentId, string> = {
  codex: "codex",
  cursor: "cursor",
  claude: "claude",
};

function which(binary: string, env: NodeJS.ProcessEnv): string | undefined {
  const result = spawnSync("which", [binary], { encoding: "utf8", env, timeout: 2000 });
  const path = result.stdout.trim();
  return result.status === 0 && path.length > 0 ? path : undefined;
}

function versionOf(binaryPath: string, env: NodeJS.ProcessEnv): string | undefined {
  const result = spawnSync(binaryPath, ["--version"], { encoding: "utf8", env, timeout: 3000 });
  if (result.status !== 0) {
    return undefined;
  }
  const text = `${result.stdout}\n${result.stderr}`.trim();
  const line = text.split("\n")[0]?.trim();
  return line && line.length > 0 ? line : undefined;
}

export function detectAgents(env: NodeJS.ProcessEnv = process.env): DetectedAgent[] {
  return (["codex", "cursor", "claude"] as const).map((id) => {
    const binaryName = BINARIES[id];
    const binary = which(binaryName, env);
    return {
      id,
      displayName: DISPLAY[id],
      installed: Boolean(binary),
      ...(binary !== undefined ? { binary } : {}),
      ...(binary !== undefined ? { version: versionOf(binary, env) } : {}),
    };
  });
}

export { DISPLAY as AGENT_DISPLAY };
