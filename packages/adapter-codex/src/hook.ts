import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { analyzeCodexSession } from "./analyze.js";
import { writeShadowReport } from "./report.js";

const hookCliPath = fileURLToPath(new URL("./hook-cli.js", import.meta.url));

function debug(message: string): void {
  if (process.env.CONTEXT_ENGINE_DEBUG === "1") {
    process.stderr.write(`[context-engine-hook] ${message}\n`);
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

function shadowDirFor(cwd: string | undefined): string {
  if (process.env.CONTEXT_ENGINE_SHADOW_DIR) {
    return process.env.CONTEXT_ENGINE_SHADOW_DIR;
  }
  return join(cwd && cwd.length > 0 ? cwd : process.cwd(), ".context-engine", "shadow");
}

function spawnDetachedAnalyze(transcriptPath: string, cwd: string | undefined): void {
  const child = spawn(
    process.execPath,
    [
      hookCliPath,
      "--analyze",
      transcriptPath,
      "--save-dir",
      shadowDirFor(cwd),
    ],
    {
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        CONTEXT_ENGINE_HOOK_CHILD: "1",
      },
    },
  );
  child.unref();
}

async function runAnalyze(transcriptPath: string, saveDir: string): Promise<void> {
  const result = await analyzeCodexSession({ path: transcriptPath }, { sourcePath: transcriptPath });
  await writeShadowReport(result, { directory: saveDir, sourcePath: transcriptPath });
}

/**
 * Optional Codex SessionEnd hook.
 *
 * Fail-open: never throws, never writes to the transcript, never injects
 * context, and always exits 0 in hook mode so Codex continues normally.
 */
export async function runCodexHookCli(argv: readonly string[]): Promise<void> {
  try {
    const analyzeIndex = argv.indexOf("--analyze");
    if (analyzeIndex >= 0) {
      const transcriptPath = argv[analyzeIndex + 1];
      const saveDirIndex = argv.indexOf("--save-dir");
      const saveDir = saveDirIndex >= 0 ? argv[saveDirIndex + 1] : shadowDirFor(undefined);
      if (!transcriptPath || !saveDir) {
        return;
      }
      await runAnalyze(transcriptPath, saveDir);
      return;
    }

    const raw = await readStdin();
    const event = parseHookEvent(raw);
    const transcriptPath =
      typeof event?.transcript_path === "string" ? event.transcript_path : undefined;
    const cwd = typeof event?.cwd === "string" ? event.cwd : undefined;
    if (transcriptPath) {
      spawnDetachedAnalyze(transcriptPath, cwd);
    } else {
      debug("SessionEnd event had no transcript_path; skipping analysis");
    }
  } catch (error) {
    debug(error instanceof Error ? error.message : "hook failed");
  }
}
