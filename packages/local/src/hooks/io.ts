import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { AgentId, EnginePaths } from "../types.js";

export async function readJsonFile(
  path: string,
): Promise<{ ok: true; value: unknown } | { ok: false; error: string; missing: boolean }> {
  try {
    const text = await readFile(path, "utf8");
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { ok: false, error: "missing", missing: true };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : "unreadable",
      missing: false,
    };
  }
}

export async function backupAgentConfig(
  paths: EnginePaths,
  agent: AgentId,
  contents: string,
  now = new Date(),
): Promise<string> {
  await mkdir(paths.backupsDir, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const target = join(
    paths.backupsDir,
    `${agent}-${basename(paths.agentConfig[agent])}-${stamp}.json`,
  );
  await writeFile(target, contents.endsWith("\n") ? contents : `${contents}\n`, "utf8");
  return target;
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
