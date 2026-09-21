import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { analyzeClaudeSession } from "./analyze.js";
import { writeShadowReport } from "./report.js";

const hookCliPath = fileURLToPath(new URL("./hook-cli.js", import.meta.url));

function debug(message: string): void {
  if (process.env.CONTEXT_ENGINE_DEBUG === "1") {
    process.stderr.write(`[context-engine-claude-hook] ${message}\n`);
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseHookEvent(raw: string): Record<string, unknown> | undefined {
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

function firstWorkspaceRoot(event: Record<string, unknown> | undefined): string | undefined {
  if (typeof event?.cwd === "string" && event.cwd.length > 0) {
    return event.cwd;
  }
  const roots = event?.workspace_roots;
  if (Array.isArray(roots) && typeof roots[0] === "string" && roots[0].length > 0) {
    return roots[0];
  }
  return undefined;
}

function shadowDirFor(cwd: string | undefined): string {
  if (process.env.CONTEXT_ENGINE_SHADOW_DIR) {
    return process.env.CONTEXT_ENGINE_SHADOW_DIR;
  }
  return join(cwd && cwd.length > 0 ? cwd : process.cwd(), ".context-engine", "shadow");
}

function spawnDetachedAnalyze(
  transcriptPath: string,
  cwd: string | undefined,
  claudeVersion: string | undefined,
): void {
  const args = [
    hookCliPath,
    "--analyze",
    transcriptPath,
    "--save-dir",
    shadowDirFor(cwd),
  ];
  if (cwd) {
    args.push("--cwd", cwd);
  }
  if (claudeVersion) {
    args.push("--claude-version", claudeVersion);
  }
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      CONTEXT_ENGINE_HOOK_CHILD: "1",
    },
  });
  child.unref();
}

async function runAnalyze(
  transcriptPath: string,
  saveDir: string,
  cwd: string | undefined,
  claudeVersion: string | undefined,
): Promise<void> {
  const result = await analyzeClaudeSession(
    { path: transcriptPath },
    {
      sourcePath: transcriptPath,
      ...(cwd !== undefined ? { cwd } : {}),
      ...(claudeVersion !== undefined ? { claudeVersion } : {}),
    },
  );
  await writeShadowReport(result, { directory: saveDir, sourcePath: transcriptPath });
}

/**
 * Optional Claude SessionEnd hook.
 *
 * Fail-open: never throws, never writes to the transcript, never injects
 * context, never blocks Claude, and always exits 0 in hook mode.
 * Analysis is spawned detached so hook timeouts cannot stall the agent.
 */
export async function runClaudeHookCli(argv: readonly string[]): Promise<void> {
  try {
    const analyzeIndex = argv.indexOf("--analyze");
    if (analyzeIndex >= 0) {
      const transcriptPath = argv[analyzeIndex + 1];
      const saveDirIndex = argv.indexOf("--save-dir");
      const cwdIndex = argv.indexOf("--cwd");
      const versionIndex = argv.indexOf("--claude-version");
      const saveDir = saveDirIndex >= 0 ? argv[saveDirIndex + 1] : shadowDirFor(undefined);
      const cwd = cwdIndex >= 0 ? argv[cwdIndex + 1] : undefined;
      const claudeVersion = versionIndex >= 0 ? argv[versionIndex + 1] : undefined;
      if (!transcriptPath || !saveDir) {
        return;
      }
      await runAnalyze(transcriptPath, saveDir, cwd, claudeVersion);
      return;
    }

    const raw = await readStdin();
    const event = parseHookEvent(raw);
    const transcriptPath =
      (typeof event?.transcript_path === "string" ? event.transcript_path : undefined) ??
      process.env.CLAUDE_TRANSCRIPT_PATH;
    const cwd = firstWorkspaceRoot(event);
    const claudeVersion =
      (typeof event?.version === "string" ? event.version : undefined) ??
      (typeof event?.claude_version === "string" ? event.claude_version : undefined) ??
      process.env.CLAUDE_CODE_VERSION;
    if (transcriptPath && transcriptPath.length > 0) {
      spawnDetachedAnalyze(transcriptPath, cwd, claudeVersion);
    } else {
      debug("sessionEnd event had no transcript_path; skipping analysis");
    }
  } catch (error) {
    debug(error instanceof Error ? error.message : "hook failed");
  }
}
