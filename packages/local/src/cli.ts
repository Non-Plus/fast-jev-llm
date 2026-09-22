import { writeFile } from "node:fs/promises";
import type { Writable } from "node:stream";
import type { AgentId, EnginePaths } from "./types.js";
import { AGENTS } from "./types.js";
import { parseAgent, parseAgentList, parseDays, parseLimit, parseOlderThan, takeFlag, takeOption } from "./args.js";
import { aggregateReports } from "./aggregate.js";
import { formatDoctor, runDoctor } from "./doctor.js";
import { runAgentHook } from "./hook-run.js";
import { uninstallAgents } from "./install.js";
import { resolveEnginePaths } from "./paths.js";
import { filterSessions, findSession, formatSessionDetail, formatSessionsTable, formatStats, statsExportDocument } from "./reports-view.js";
import { runSetup } from "./setup.js";
import { formatDogfood, formatStatus } from "./status.js";
import { clearReports, loadReports, pruneReports } from "./store.js";

import { RELEASE_VERSION } from "./release-version.js";

export const PRODUCT_USAGE = `fast-jev-llm ${RELEASE_VERSION} — ctx

Context optimization for Claude Code, Codex, and Cursor.
Shadow mode only: analyzes transcripts; does not modify agent context.

Usage:
  ctx setup [--dry-run] [--yes] [--agents codex,cursor,claude]
      [--semantic-mode off|remote] [--confirm-remote]
  ctx status
  ctx doctor
  ctx sessions [--agent <id>] [--workspace <name>] [--limit <n>]
  ctx session <id>
  ctx stats [--days <n>] [--agent <id>] [--json] [--export <file>]
  ctx uninstall [codex|cursor|claude] [--dry-run]
  ctx reports prune --older-than 30d
  ctx reports clear [--yes]
  ctx dogfood status
  ctx hook <codex|cursor|claude>
  ctx compact <transcript.json>
  ctx codex|cursor|claude analyze|explain <session>
  ctx --version
  ctx --help

Options:
  --debug    Developer logs (never prints credential values)

Exit codes: 0 success, 1 operational failure, 2 invalid usage.
Hooks always exit 0 (fail open).

No telemetry. Semantic classification defaults off.
Reports stay in ~/.context-engine/. Active compaction is not enabled.`;

const COMMAND_HELP: Record<string, string> = {
  setup: `ctx setup — install passive SessionEnd hooks

  ctx setup
  ctx setup --dry-run
  ctx setup --yes
  ctx setup --yes --agents codex,cursor,claude
  ctx setup --yes --semantic-mode remote --confirm-remote

Default analysis is local deterministic only. Remote Jev is opt-in.
Does not modify agent context. Requires confirmation before writes.`,
  status: `ctx status — show shadow mode, hooks, report counts, and privacy defaults.`,
  doctor: `ctx doctor — check Node, config, hooks, and whether Jev credentials exist.

Exit 0 if no hard failures. Never prints credential values.`,
  sessions: `ctx sessions — list local shadow reports (newest first)

  --agent codex|cursor|claude
  --workspace <display-name>
  --limit <n>`,
  session: `ctx session <id> — show one local report. No transcript is stored.`,
  stats: `ctx stats — aggregate local shadow statistics

  --days 1|7|30
  --agent codex|cursor|claude
  --json
  --export stats.json

Reduction varies by agent and transcript completeness.
Cursor sessions are often tool_calls_only.`,
  uninstall: `ctx uninstall [codex|cursor|claude] — remove only Context Engine hooks.`,
  reports: `ctx reports prune --older-than 30d
ctx reports clear --yes`,
  dogfood: `ctx dogfood status — whether detected agents are collecting shadow reports.`,
};

const PRODUCT = new Set([
  "setup",
  "status",
  "doctor",
  "sessions",
  "session",
  "stats",
  "uninstall",
  "reports",
  "dogfood",
  "hook",
]);

export interface ProductIo {
  stdout: Writable;
  stderr: Writable;
}

function out(io: ProductIo | undefined): Writable {
  return io?.stdout ?? process.stdout;
}

function err(io: ProductIo | undefined): Writable {
  return io?.stderr ?? process.stderr;
}

function println(stream: Writable, text: string): void {
  stream.write(`${text}\n`);
}

export async function runProductCommand(
  argv: string[],
  options?: { paths?: EnginePaths; io?: ProductIo },
): Promise<number | null> {
  const command = argv[0];
  if (!command || !PRODUCT.has(command)) {
    return null;
  }
  const paths = options?.paths ?? resolveEnginePaths();
  const rest = argv.slice(1);
  if (command !== "hook" && (rest.includes("--help") || rest.includes("-h"))) {
    println(out(options?.io), COMMAND_HELP[command] ?? PRODUCT_USAGE);
    return 0;
  }
  try {
    if (command === "setup") {
      return await cmdSetup(rest, paths, options?.io);
    }
    if (command === "status") {
      println(out(options?.io), await formatStatus(paths));
      return 0;
    }
    if (command === "doctor") {
      const result = await runDoctor(paths);
      println(out(options?.io), formatDoctor(result.checks));
      return result.exitCode;
    }
    if (command === "sessions") {
      return await cmdSessions(rest, paths, options?.io);
    }
    if (command === "session") {
      return await cmdSession(rest, paths, options?.io);
    }
    if (command === "stats") {
      return await cmdStats(rest, paths, options?.io);
    }
    if (command === "uninstall") {
      return await cmdUninstall(rest, paths, options?.io);
    }
    if (command === "reports") {
      return await cmdReports(rest, paths, options?.io);
    }
    if (command === "dogfood") {
      if (rest[0] && rest[0] !== "status") {
        println(err(options?.io), PRODUCT_USAGE);
        return 2;
      }
      println(out(options?.io), await formatDogfood(paths));
      return 0;
    }
    if (command === "hook") {
      const marker = rest.indexOf("--context-engine-shadow");
      if (marker >= 0) {
        rest.splice(marker, 1);
      }
      const agent = parseAgent(rest.shift());
      if (!agent) {
        return 0;
      }
      await runAgentHook(agent, rest, { paths });
      return 0;
    }
  } catch (error) {
    if (command === "hook") {
      return 0;
    }
    println(err(options?.io), error instanceof Error ? error.message : "command failed");
    return 1;
  }
  return 2;
}

async function cmdSetup(args: string[], paths: EnginePaths, io?: ProductIo): Promise<number> {
  const dryRun = takeFlag(args, "--dry-run");
  const yes = takeFlag(args, "--yes");
  const confirmRemote = takeFlag(args, "--confirm-remote");
  const agentsRaw = takeOption(args, "--agents");
  const modeRaw = takeOption(args, "--semantic-mode") ?? "off";
  if (modeRaw !== "off" && modeRaw !== "local" && modeRaw !== "remote") {
    throw new Error("--semantic-mode must be off, local, or remote");
  }
  if (args.length > 0) {
    throw new Error(`Unexpected setup arguments: ${args.join(" ")}`);
  }
  const result = await runSetup(paths, {
    dryRun,
    yes: yes || dryRun,
    confirmRemote,
    semanticMode: modeRaw,
    semanticProvider: modeRaw === "remote" ? "jev" : null,
    agents: agentsRaw ? parseAgentList(agentsRaw) : AGENTS,
    stdout: out(io),
  });
  if (result.skipped.length > 0) {
    println(out(io), "");
    println(out(io), result.skipped.join("\n"));
  }
  if (result.backups.length > 0) {
    println(out(io), "");
    println(out(io), `Backups:\n${result.backups.map((path) => `  ${path}`).join("\n")}`);
  }
  println(out(io), "");
  println(out(io), result.dryRun ? "Dry-run: no files were written." : "Shadow analysis hooks installed. No agent context will be modified.");
  return 0;
}

async function cmdSessions(args: string[], paths: EnginePaths, io?: ProductIo): Promise<number> {
  const agent = parseAgent(takeOption(args, "--agent"));
  const workspace = takeOption(args, "--workspace");
  const limit = parseLimit(takeOption(args, "--limit"), 20);
  const loaded = await loadReports(paths, agent ? { agent } : undefined);
  const rows = filterSessions(loaded.reports, {
    ...(agent !== undefined ? { agent } : {}),
    ...(workspace !== undefined ? { workspace } : {}),
  }).slice(0, limit);
  println(out(io), formatSessionsTable(rows));
  return 0;
}

async function cmdSession(args: string[], paths: EnginePaths, io?: ProductIo): Promise<number> {
  const id = args[0];
  if (!id) {
    throw new Error("Usage: ctx session <id>");
  }
  const loaded = await loadReports(paths);
  const report = findSession(loaded.reports, id);
  if (!report) {
    println(err(io), `No session report found for ${id}.`);
    return 1;
  }
  println(out(io), formatSessionDetail(report));
  return 0;
}

async function cmdStats(args: string[], paths: EnginePaths, io?: ProductIo): Promise<number> {
  const json = takeFlag(args, "--json");
  const exportPath = takeOption(args, "--export");
  const days = parseDays(takeOption(args, "--days"));
  const agent = parseAgent(takeOption(args, "--agent"));
  const loaded = await loadReports(paths, agent ? { agent } : undefined);
  const stats = aggregateReports(loaded.reports, {
    ...(days !== undefined ? { days } : {}),
    ...(agent !== undefined ? { agent } : {}),
  });
  stats.skippedReports = loaded.skipped;
  const document = statsExportDocument(stats);
  if (exportPath) {
    await writeFile(exportPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    println(err(io), `Wrote ${exportPath}`);
  }
  if (json) {
    println(out(io), JSON.stringify(document, null, 2));
    return 0;
  }
  println(out(io), formatStats(stats));
  return 0;
}

async function cmdUninstall(args: string[], paths: EnginePaths, io?: ProductIo): Promise<number> {
  const dryRun = takeFlag(args, "--dry-run");
  let agents: AgentId[] = [...AGENTS];
  if (args[0]) {
    agents = [parseAgent(args[0])!];
    if (args.length > 1) {
      throw new Error("Usage: ctx uninstall [codex|cursor|claude]");
    }
  }
  const results = await uninstallAgents(paths, agents, dryRun);
  for (const result of results) {
    const flag = result.conservative ? "!" : result.removed ? "✓" : "·";
    println(out(io), `${flag} ${result.agent}: ${result.message}`);
  }
  println(out(io), dryRun ? "Dry-run: no files were written." : "Unrelated user hooks were left in place.");
  return results.some((result) => result.conservative) ? 1 : 0;
}

async function cmdReports(args: string[], paths: EnginePaths, io?: ProductIo): Promise<number> {
  const sub = args.shift();
  if (sub === "prune") {
    const raw = takeOption(args, "--older-than");
    if (!raw) {
      throw new Error("Usage: ctx reports prune --older-than 30d");
    }
    const removed = await pruneReports(paths, parseOlderThan(raw));
    println(out(io), `Removed ${removed} report${removed === 1 ? "" : "s"}.`);
    return 0;
  }
  if (sub === "clear") {
    const yes = takeFlag(args, "--yes");
    if (!yes) {
      throw new Error("Refusing to clear reports without --yes.");
    }
    const removed = await clearReports(paths);
    println(out(io), `Cleared ${removed} report${removed === 1 ? "" : "s"}.`);
    return 0;
  }
  println(err(io), "Usage: ctx reports prune --older-than 30d | ctx reports clear --yes");
  return 2;
}
