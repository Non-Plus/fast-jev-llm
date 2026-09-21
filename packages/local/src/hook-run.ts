import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { AgentId, EnginePaths } from "./types.js";
import { resolveEnginePaths } from "./paths.js";
import { analyzeAndStore } from "./analyze-store.js";

const selfPath = fileURLToPath(import.meta.url);

function debug(message: string): void {
  if (process.env.CONTEXT_ENGINE_DEBUG === "1") {
    process.stderr.write(`[context-engine-hook] ${message}\n`);
  }
}

async function readStdin(source?: AsyncIterable<string | Buffer>): Promise<string> {
  const chunks: Buffer[] = [];
  const stream = source ?? process.stdin;
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseEvent(raw: string): Record<string, unknown> | undefined {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function transcriptFromEvent(event: Record<string, unknown> | undefined, agent: AgentId): string | undefined {
  if (typeof event?.transcript_path === "string" && event.transcript_path.length > 0) {
    return event.transcript_path;
  }
  if (agent === "cursor" && typeof process.env.CURSOR_TRANSCRIPT_PATH === "string") {
    return process.env.CURSOR_TRANSCRIPT_PATH;
  }
  if (agent === "claude" && typeof process.env.CLAUDE_TRANSCRIPT_PATH === "string") {
    return process.env.CLAUDE_TRANSCRIPT_PATH;
  }
  return undefined;
}

function cwdFromEvent(event: Record<string, unknown> | undefined): string | undefined {
  if (typeof event?.cwd === "string" && event.cwd.length > 0) {
    return event.cwd;
  }
  const roots = event?.workspace_roots;
  if (Array.isArray(roots) && typeof roots[0] === "string" && roots[0].length > 0) {
    return roots[0];
  }
  return undefined;
}

function agentVersionFromEvent(event: Record<string, unknown> | undefined, agent: AgentId): string | undefined {
  if (agent === "cursor" && typeof event?.cursor_version === "string") {
    return event.cursor_version;
  }
  if (agent === "claude") {
    if (typeof event?.version === "string") {
      return event.version;
    }
    if (typeof event?.claude_version === "string") {
      return event.claude_version;
    }
  }
  if (agent === "codex" && typeof event?.cli_version === "string") {
    return event.cli_version;
  }
  return undefined;
}

async function runAnalyze(
  agent: AgentId,
  transcriptPath: string,
  cwd?: string,
  agentVersion?: string,
  paths: EnginePaths = resolveEnginePaths(),
): Promise<void> {
  await analyzeAndStore(paths, agent, transcriptPath, {
    ...(cwd !== undefined ? { cwd } : {}),
    ...(agentVersion !== undefined ? { agentVersion } : {}),
  });
}

function spawnDetached(agent: AgentId, transcriptPath: string, cwd?: string, agentVersion?: string): void {
  const entry = process.argv[1] ?? selfPath;
  const prefix = entry.endsWith(".ts") ? ["--import", "tsx", entry] : [entry];
  const childArgs = [...prefix, "hook", agent, "--analyze", transcriptPath];
  if (cwd) {
    childArgs.push("--cwd", cwd);
  }
  if (agentVersion) {
    childArgs.push("--agent-version", agentVersion);
  }
  const child = spawn(process.execPath, childArgs, {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      CONTEXT_ENGINE_HOOK_CHILD: "1",
    },
  });
  child.unref();
}

/**
 * Fail-open SessionEnd handler. Never throws to the caller; never writes stdout.
 */
export async function runAgentHook(
  agent: AgentId,
  argv: readonly string[],
  options?: {
    stdin?: AsyncIterable<string | Buffer>;
    stdinText?: string;
    paths?: EnginePaths;
  },
): Promise<void> {
  const paths = options?.paths ?? resolveEnginePaths();
  try {
    const analyzeIndex = argv.indexOf("--analyze");
    if (analyzeIndex >= 0) {
      const transcriptPath = argv[analyzeIndex + 1];
      const cwdIndex = argv.indexOf("--cwd");
      const versionIndex = argv.indexOf("--agent-version");
      const cwd = cwdIndex >= 0 ? argv[cwdIndex + 1] : undefined;
      const agentVersion = versionIndex >= 0 ? argv[versionIndex + 1] : undefined;
      if (!transcriptPath) {
        return;
      }
      await runAnalyze(agent, transcriptPath, cwd, agentVersion, paths);
      return;
    }

    const raw = options?.stdinText ?? (await readStdin(options?.stdin));
    const event = parseEvent(raw);
    const transcriptPath = transcriptFromEvent(event, agent);
    if (!transcriptPath) {
      debug("hook event had no transcript_path; skipping analysis");
      return;
    }
    const cwd = cwdFromEvent(event);
    const agentVersion = agentVersionFromEvent(event, agent);
    if (process.env.CONTEXT_ENGINE_HOOK_SYNC === "1") {
      await runAnalyze(agent, transcriptPath, cwd, agentVersion, paths);
      return;
    }
    spawnDetached(agent, transcriptPath, cwd, agentVersion);
  } catch (error) {
    debug(error instanceof Error ? error.message : "hook failed");
  }
}
