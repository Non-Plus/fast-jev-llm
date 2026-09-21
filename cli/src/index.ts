#!/usr/bin/env node
import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import { compact, formatStats, type SemanticMode, type SemanticProvider, type Transcript } from "@fast-jev/core";
import {
  analyzeClaudeSession,
  formatShadowAnalysis as formatClaudeShadowAnalysis,
  formatShadowExplain as formatClaudeShadowExplain,
  toShadowJsonDocument as toClaudeShadowJsonDocument,
  writeShadowReport as writeClaudeShadowReport,
} from "@fast-jev/adapter-claude";
import {
  analyzeCodexSession,
  formatShadowAnalysis as formatCodexShadowAnalysis,
  formatShadowExplain as formatCodexShadowExplain,
  toShadowJsonDocument as toCodexShadowJsonDocument,
  writeShadowReport as writeCodexShadowReport,
} from "@fast-jev/adapter-codex";
import {
  analyzeCursorSession,
  formatShadowAnalysis as formatCursorShadowAnalysis,
  formatShadowExplain as formatCursorShadowExplain,
  toShadowJsonDocument as toCursorShadowJsonDocument,
  writeShadowReport as writeCursorShadowReport,
} from "@fast-jev/adapter-cursor";
import { jevProviderFromEnv } from "@fast-jev/provider-jev";
import { codingSessionTranscript } from "../../fixtures/coding-session.ts";

function workspaceCwd(): string {
  return process.env.INIT_CWD ?? process.cwd();
}

function expandPath(input: string): string {
  if (input === "~") {
    return homedir();
  }
  if (input.startsWith("~/")) {
    return resolve(homedir(), input.slice(2));
  }
  if (isAbsolute(input)) {
    return input;
  }
  return resolve(workspaceCwd(), input);
}

function usage(): never {
  console.error(`Usage:
  ctx compact [transcript.json]
  ctx codex analyze <transcript.jsonl> [--json] [--save] [--save-dir <dir>] [--preview-length <n>] [--no-previews]
      [--semantic-mode off|local|remote] [--semantic-provider jev] [--semantic-cache]
  ctx codex explain <transcript.jsonl> [--preview-length <n>] [--no-previews]
      [--semantic-mode off|local|remote] [--semantic-provider jev] [--semantic-cache]
  ctx cursor analyze <session-source> [--json] [--save] [--save-dir <dir>] [--preview-length <n>]
      [--report-previews] [--no-report-previews] [--cwd <dir>]
      [--semantic-mode off|local|remote] [--semantic-provider jev] [--semantic-cache]
  ctx cursor explain <session-source> [--preview-length <n>] [--no-report-previews]
      [--semantic-mode off|local|remote] [--semantic-provider jev] [--semantic-cache]
  ctx claude analyze <transcript.jsonl> [--json] [--save] [--save-dir <dir>] [--preview-length <n>]
      [--report-previews] [--no-report-previews] [--cwd <dir>]
      [--semantic-mode off|local|remote] [--semantic-provider jev] [--semantic-cache]
  ctx claude explain <transcript.jsonl> [--preview-length <n>] [--no-report-previews]
      [--semantic-mode off|local|remote] [--semantic-provider jev] [--semantic-cache]

Default semantic-mode is off. Remote classification is never implicit.
Shadow mode only. No Codex, Cursor, or Claude context is modified.`);
  process.exit(2);
}

async function resolveClaudeSessionSource(input: string): Promise<string> {
  const path = expandPath(input);
  const info = await stat(path);
  if (!info.isDirectory()) {
    return path;
  }
  const entries = (await readdir(path))
    .filter((entry) => entry.endsWith(".jsonl") && !entry.startsWith("agent-"))
    .sort();
  const first = entries[0];
  if (!first) {
    throw new Error(`No .jsonl transcript found in ${path}`);
  }
  return join(path, first);
}

async function resolveCursorSessionSource(input: string): Promise<string> {
  const path = expandPath(input);
  const info = await stat(path);
  if (!info.isDirectory()) {
    return path;
  }
  const nested = join(path, `${basename(path)}.jsonl`);
  if (existsSync(nested)) {
    return nested;
  }
  const entries = (await readdir(path)).filter((entry) => entry.endsWith(".jsonl")).sort();
  const first = entries[0];
  if (!first) {
    throw new Error(`No .jsonl transcript found in ${path}`);
  }
  return join(path, first);
}

function takeFlag(args: string[], name: string): boolean {
  const index = args.indexOf(name);
  if (index < 0) {
    return false;
  }
  args.splice(index, 1);
  return true;
}

function takeOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) {
    return undefined;
  }
  const value = args[index + 1];
  args.splice(index, 2);
  return value;
}

function resolveSemantic(
  args: string[],
): { mode: SemanticMode; provider?: SemanticProvider; cache: boolean } {
  const cache = takeFlag(args, "--semantic-cache");
  const modeRaw = takeOption(args, "--semantic-mode") ?? "off";
  const providerName = takeOption(args, "--semantic-provider");
  if (modeRaw !== "off" && modeRaw !== "local" && modeRaw !== "remote") {
    throw new Error("--semantic-mode must be off, local, or remote");
  }
  const mode: SemanticMode = modeRaw;
  if (!providerName) {
    if (mode === "remote") {
      throw new Error("semantic-mode remote requires --semantic-provider jev");
    }
    return { mode, cache };
  }
  if (providerName !== "jev") {
    throw new Error(`Unknown semantic provider: ${providerName}`);
  }
  if (mode !== "remote") {
    throw new Error("Refusing remote classification: pass --semantic-mode remote to send packed candidates to Jev.");
  }
  const provider = jevProviderFromEnv();
  if (!provider) {
    throw new Error("Jev requires TYPESAFE_API_KEY or JEV_API_KEY. Nothing was sent.");
  }
  return { mode, provider, cache };
}

async function runCompact(file?: string): Promise<void> {
  const transcript: Transcript = file
    ? (JSON.parse(await readFile(expandPath(file), "utf8")) as Transcript)
    : codingSessionTranscript;
  const result = await compact(transcript);
  console.log(formatStats(result.stats, result.sessionId));
  console.log("\nNon-KEEP decisions:");
  for (const decision of result.decisions) {
    if (decision.action === "KEEP") {
      continue;
    }
    console.log(
      `  [${decision.action.padEnd(8)}] ${decision.itemId}  ${decision.rule}  ${decision.reason}`,
    );
  }
}

async function runCodex(args: string[]): Promise<void> {
  const command = args.shift();
  if (command !== "analyze" && command !== "explain") {
    usage();
  }
  const json = takeFlag(args, "--json");
  const save = takeFlag(args, "--save");
  const noPreviews = takeFlag(args, "--no-previews");
  const saveDir = takeOption(args, "--save-dir");
  const previewRaw = takeOption(args, "--preview-length");
  const semantic = resolveSemantic(args);
  const file = args[0];
  if (!file || args.length !== 1) {
    usage();
  }
  if (command === "explain" && json) {
    usage();
  }

  const previewLength = previewRaw !== undefined ? Number(previewRaw) : undefined;
  if (previewLength !== undefined && (!Number.isFinite(previewLength) || previewLength <= 0)) {
    throw new Error("--preview-length must be a positive number");
  }

  const path = expandPath(file);
  const result = await analyzeCodexSession(
    { path },
    {
      sourcePath: path,
      ...(previewLength !== undefined ? { previewLength } : {}),
      ...(noPreviews ? { reportPreviews: false } : {}),
      config: {
        semanticMode: semantic.mode,
        semanticCache: semantic.cache,
      },
      ...(semantic.provider ? { semanticProvider: semantic.provider } : {}),
    },
  );

  if (save || saveDir) {
    const saved = await writeCodexShadowReport(result, {
      ...(saveDir !== undefined ? { directory: saveDir } : {}),
      sourcePath: path,
    });
    if (!json) {
      console.error(`Wrote shadow report: ${saved}`);
    }
  }

  if (command === "explain") {
    console.log(formatCodexShadowExplain(result));
    return;
  }
  if (json) {
    console.log(JSON.stringify(toCodexShadowJsonDocument(result, path), null, 2));
    return;
  }
  console.log(formatCodexShadowAnalysis(result));
}

async function runCursor(args: string[]): Promise<void> {
  const command = args.shift();
  if (command !== "analyze" && command !== "explain") {
    usage();
  }
  const json = takeFlag(args, "--json");
  const save = takeFlag(args, "--save");
  const noPreviews = takeFlag(args, "--no-previews") || takeFlag(args, "--no-report-previews");
  takeFlag(args, "--report-previews");
  const saveDir = takeOption(args, "--save-dir");
  const previewRaw = takeOption(args, "--preview-length");
  const cwd = takeOption(args, "--cwd");
  const cursorVersion = takeOption(args, "--cursor-version");
  const semantic = resolveSemantic(args);
  const file = args[0];
  if (!file || args.length !== 1) {
    usage();
  }
  if (command === "explain" && json) {
    usage();
  }

  const previewLength = previewRaw !== undefined ? Number(previewRaw) : undefined;
  if (previewLength !== undefined && (!Number.isFinite(previewLength) || previewLength <= 0)) {
    throw new Error("--preview-length must be a positive number");
  }

  const path = await resolveCursorSessionSource(file);
  const result = await analyzeCursorSession(
    { path },
    {
      sourcePath: path,
      ...(previewLength !== undefined ? { previewLength } : {}),
      ...(noPreviews ? { reportPreviews: false } : {}),
      ...(cwd !== undefined ? { cwd: expandPath(cwd) } : {}),
      ...(cursorVersion !== undefined ? { cursorVersion } : {}),
      config: {
        semanticMode: semantic.mode,
        semanticCache: semantic.cache,
      },
      ...(semantic.provider ? { semanticProvider: semantic.provider } : {}),
    },
  );

  if (save || saveDir) {
    const saved = await writeCursorShadowReport(result, {
      ...(saveDir !== undefined ? { directory: saveDir } : {}),
      sourcePath: path,
    });
    if (!json) {
      console.error(`Wrote shadow report: ${saved}`);
    }
  }

  if (command === "explain") {
    console.log(formatCursorShadowExplain(result));
    return;
  }
  if (json) {
    console.log(JSON.stringify(toCursorShadowJsonDocument(result, path), null, 2));
    return;
  }
  console.log(formatCursorShadowAnalysis(result));
}

async function runClaude(args: string[]): Promise<void> {
  const command = args.shift();
  if (command !== "analyze" && command !== "explain") {
    usage();
  }
  const json = takeFlag(args, "--json");
  const save = takeFlag(args, "--save");
  const noPreviews = takeFlag(args, "--no-previews") || takeFlag(args, "--no-report-previews");
  takeFlag(args, "--report-previews");
  const saveDir = takeOption(args, "--save-dir");
  const previewRaw = takeOption(args, "--preview-length");
  const cwd = takeOption(args, "--cwd");
  const claudeVersion = takeOption(args, "--claude-version");
  const semantic = resolveSemantic(args);
  const file = args[0];
  if (!file || args.length !== 1) {
    usage();
  }
  if (command === "explain" && json) {
    usage();
  }

  const previewLength = previewRaw !== undefined ? Number(previewRaw) : undefined;
  if (previewLength !== undefined && (!Number.isFinite(previewLength) || previewLength <= 0)) {
    throw new Error("--preview-length must be a positive number");
  }

  const path = await resolveClaudeSessionSource(file);
  const result = await analyzeClaudeSession(
    { path },
    {
      sourcePath: path,
      ...(previewLength !== undefined ? { previewLength } : {}),
      ...(noPreviews ? { reportPreviews: false } : {}),
      ...(cwd !== undefined ? { cwd: expandPath(cwd) } : {}),
      ...(claudeVersion !== undefined ? { claudeVersion } : {}),
      config: {
        semanticMode: semantic.mode,
        semanticCache: semantic.cache,
      },
      ...(semantic.provider ? { semanticProvider: semantic.provider } : {}),
    },
  );

  if (save || saveDir) {
    const saved = await writeClaudeShadowReport(result, {
      ...(saveDir !== undefined ? { directory: saveDir } : {}),
      sourcePath: path,
    });
    if (!json) {
      console.error(`Wrote shadow report: ${saved}`);
    }
  }

  if (command === "explain") {
    console.log(formatClaudeShadowExplain(result));
    return;
  }
  if (json) {
    console.log(JSON.stringify(toClaudeShadowJsonDocument(result, path), null, 2));
    return;
  }
  console.log(formatClaudeShadowAnalysis(result));
}

const argv = process.argv.slice(2);
while (argv[0] === "--") {
  argv.shift();
}
if (argv[0] === "codex") {
  await runCodex(argv.slice(1));
} else if (argv[0] === "cursor") {
  await runCursor(argv.slice(1));
} else if (argv[0] === "claude") {
  await runClaude(argv.slice(1));
} else if (argv[0] === "compact") {
  await runCompact(argv[1]);
} else if (argv[0] === "help" || argv[0] === "--help" || argv[0] === "-h") {
  usage();
} else {
  await runCompact(argv[0]);
}
