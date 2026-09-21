import { access, constants } from "node:fs/promises";
import type { EnginePaths } from "./types.js";
import { loadConfig } from "./config.js";
import { detectAgents } from "./detect.js";
import { resolveHookCommand } from "./hook-command.js";
import { planInstall } from "./install.js";
import { reportsDir, resolveEnginePaths } from "./paths.js";
import { jevProviderFromEnv } from "@fast-jev/provider-jev";
import { AGENTS } from "./types.js";

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export async function runDoctor(paths: EnginePaths = resolveEnginePaths()): Promise<{
  checks: DoctorCheck[];
  exitCode: number;
}> {
  const checks: DoctorCheck[] = [];
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  checks.push({
    name: "Node version",
    ok: nodeMajor >= 22,
    detail: process.versions.node,
  });
  checks.push({
    name: "ctx process",
    ok: true,
    detail: process.argv[1] ?? "unknown",
  });

  const loaded = await loadConfig(paths);
  checks.push({
    name: "config",
    ok: !loaded.error,
    detail: loaded.error ? loaded.error : loaded.exists ? paths.configPath : "missing (defaults)",
  });

  try {
    await access(paths.reportsRoot, constants.W_OK);
    checks.push({
      name: "report directory",
      ok: true,
      detail: paths.reportsRoot,
    });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    checks.push({
      name: "report directory",
      ok: code === "ENOENT",
      detail: code === "ENOENT" ? "not created yet" : error instanceof Error ? error.message : "unwritable",
    });
  }
  for (const agent of AGENTS) {
    checks.push({
      name: `${agent} reports dir`,
      ok: true,
      detail: reportsDir(paths, agent),
    });
  }

  const detected = detectAgents();
  const hookCommand = resolveHookCommand(loaded.config.hookCommand);
  const plans = await planInstall(paths, hookCommand, AGENTS);
  for (const agent of detected) {
    checks.push({
      name: `${agent.displayName} installed`,
      ok: true,
      detail: agent.installed ? agent.version ?? agent.binary ?? "yes" : "not found",
    });
    const plan = plans.find((entry) => entry.agent === agent.id);
    const malformed = plan?.notes.some((note) => note.includes("malformed")) ?? false;
    checks.push({
      name: `${agent.displayName} hook`,
      ok: !malformed,
      detail: malformed
        ? plan?.notes.join("; ") ?? "malformed"
        : plan?.alreadyInstalled
          ? "installed"
          : "not installed",
    });
  }

  const jev = jevProviderFromEnv();
  checks.push({
    name: "semantic mode",
    ok: true,
    detail: loaded.config.semanticMode,
  });
  checks.push({
    name: "Jev credential",
    ok: loaded.config.semanticMode !== "remote" || Boolean(jev),
    detail: jev ? "available" : "not present",
  });

  const failed = checks.filter((check) => !check.ok);
  return { checks, exitCode: failed.length === 0 ? 0 : 1 };
}

export function formatDoctor(checks: DoctorCheck[]): string {
  return [
    "Context Engine doctor",
    "",
    ...checks.map((check) => `${check.ok ? "✓" : "✗"} ${check.name.padEnd(28)} ${check.detail}`),
  ].join("\n");
}
