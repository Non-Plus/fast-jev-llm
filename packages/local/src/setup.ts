import { createInterface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";
import type { SemanticMode } from "@fast-jev/core";
import type { AgentId, EnginePaths, SetupResult } from "./types.js";
import { AGENTS } from "./types.js";
import { detectAgents } from "./detect.js";
import { formatInstallPlan, installSelected, planInstall } from "./install.js";
import { resolveHookCommand } from "./hook-command.js";

const REMOTE_WARNING = `Remote semantic classification can send selected context to an external
provider.`;

export interface SetupOptions {
  dryRun: boolean;
  yes: boolean;
  confirmRemote: boolean;
  semanticMode?: SemanticMode;
  semanticProvider?: "jev" | null;
  agents?: readonly AgentId[];
  hookCommand?: string;
  stdin?: Readable;
  stdout?: Writable;
}

function write(out: Writable, text: string): void {
  out.write(`${text}\n`);
}

export function formatDetectedAgents(): string {
  const detected = detectAgents();
  const lines = ["Context Engine Setup", "", "Detected coding agents:", ""];
  for (const agent of detected) {
    if (agent.installed) {
      lines.push(`✓ ${agent.displayName}`);
      lines.push(`  ${agent.version ?? "version unknown"}`);
    } else {
      lines.push(`○ ${agent.displayName}`);
      lines.push("  not found");
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

async function promptYes(rl: ReturnType<typeof createInterface>, question: string, defaultYes: boolean): Promise<boolean> {
  const suffix = defaultYes ? " [Y/n] " : " [y/N] ";
  const answer = (await rl.question(`${question}${suffix}`)).trim().toLowerCase();
  if (answer.length === 0) {
    return defaultYes;
  }
  return answer === "y" || answer === "yes";
}

export async function runSetup(paths: EnginePaths, options: SetupOptions): Promise<SetupResult> {
  const stdout = options.stdout ?? process.stdout;
  write(stdout, formatDetectedAgents());
  write(stdout, "");

  let agents: AgentId[] = options.agents ? [...options.agents] : [...AGENTS];
  let semanticMode: SemanticMode = options.semanticMode ?? "off";
  let confirmRemote = options.confirmRemote;

  if (!options.yes && !options.dryRun) {
    const stdin = options.stdin ?? process.stdin;
    if (!("isTTY" in stdin) || !stdin.isTTY) {
      throw new Error("ctx setup is interactive. Re-run with --yes, or --dry-run.");
    }
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      write(stdout, "Choose agents to enable for passive shadow analysis:");
      const selected: AgentId[] = [];
      const detected = detectAgents();
      for (const id of AGENTS) {
        const found = detected.find((entry) => entry.id === id);
        const enable = await promptYes(rl, found?.displayName ?? id, true);
        if (enable) {
          selected.push(id);
        }
      }
      agents = selected.length > 0 ? selected : [...AGENTS];
      write(stdout, "");
      write(stdout, "Analysis mode:");
      write(stdout, "  1) Local deterministic only");
      write(stdout, "  2) Local + remote semantic provider");
      const modeAnswer = (await rl.question("Choice [1]: ")).trim();
      if (modeAnswer === "2") {
        write(stdout, "");
        write(stdout, REMOTE_WARNING);
        const ok = await promptYes(rl, "Enable remote semantic classification?", false);
        if (!ok) {
          semanticMode = "off";
        } else {
          semanticMode = "remote";
          confirmRemote = true;
        }
      } else {
        semanticMode = "off";
      }
      const hookCommand = resolveHookCommand(options.hookCommand);
      const plans = await planInstall(paths, hookCommand, agents);
      write(stdout, "");
      write(stdout, formatInstallPlan(plans));
      write(stdout, "");
      const proceed = await promptYes(rl, "Proceed?", false);
      if (!proceed) {
        return {
          dryRun: true,
          wrote: false,
          plans,
          configPath: paths.configPath,
          backups: [],
          skipped: ["Setup cancelled."],
        };
      }
    } finally {
      rl.close();
    }
  } else {
    const hookCommand = resolveHookCommand(options.hookCommand);
    const plans = await planInstall(paths, hookCommand, agents);
    write(stdout, "Analysis mode: Local deterministic only (default)");
    if (semanticMode === "remote") {
      write(stdout, REMOTE_WARNING);
    } else {
      write(stdout, `Semantic mode: ${semanticMode}`);
    }
    write(stdout, "");
    write(stdout, formatInstallPlan(plans));
  }

  return installSelected(paths, {
    agents,
    dryRun: options.dryRun,
    hookCommand: options.hookCommand,
    semanticMode,
    semanticProvider: semanticMode === "remote" ? (options.semanticProvider ?? "jev") : null,
    confirmRemote,
  });
}
