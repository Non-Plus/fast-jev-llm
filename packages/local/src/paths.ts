import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentId, EnginePaths } from "./types.js";

export function resolveEnginePaths(options?: {
  home?: string;
  engineHome?: string;
}): EnginePaths {
  const home = options?.home ?? process.env.HOME ?? homedir();
  const engineHome =
    options?.engineHome ?? process.env.CONTEXT_ENGINE_HOME ?? join(home, ".context-engine");
  return {
    home,
    engineHome,
    configPath: join(engineHome, "config.json"),
    reportsRoot: join(engineHome, "reports"),
    backupsDir: join(engineHome, "backups"),
    agentConfig: {
      codex: join(home, ".codex", "hooks.json"),
      cursor: join(home, ".cursor", "hooks.json"),
      claude: join(home, ".claude", "settings.json"),
    },
  };
}

export function reportsDir(paths: EnginePaths, agent: AgentId): string {
  return join(paths.reportsRoot, agent);
}
