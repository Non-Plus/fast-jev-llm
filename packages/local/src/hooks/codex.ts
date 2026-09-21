import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { EnginePaths, HookPlan } from "../types.js";
import { countCommands, isRecord } from "../json.js";
import { hookInvocation, isOurHookCommand } from "../hook-command.js";
import { backupAgentConfig, readJsonFile } from "./io.js";

function emptyCodexDoc(): Record<string, unknown> {
  return { hooks: {} };
}

export function applyCodexHook(
  raw: unknown,
  command: string,
): { next: Record<string, unknown>; changed: boolean; existingCount: number; alreadyInstalled: boolean } {
  const doc = isRecord(raw) ? { ...raw } : emptyCodexDoc();
  const hooks = isRecord(doc.hooks) ? { ...doc.hooks } : {};
  const sessionEnd = Array.isArray(hooks.SessionEnd) ? [...hooks.SessionEnd] : [];
  const existingCount = countCommands(sessionEnd);
  const alreadyInstalled = sessionEnd.some((entry) => JSON.stringify(entry).includes("--context-engine-shadow"));
  if (alreadyInstalled) {
    return {
      next: { ...doc, hooks: { ...hooks, SessionEnd: sessionEnd } },
      changed: false,
      existingCount,
      alreadyInstalled: true,
    };
  }
  sessionEnd.push({
    hooks: [
      {
        type: "command",
        command,
        timeout: 3,
        statusMessage: "Context Engine shadow analysis",
      },
    ],
  });
  return {
    next: { ...doc, hooks: { ...hooks, SessionEnd: sessionEnd } },
    changed: true,
    existingCount,
    alreadyInstalled: false,
  };
}

export function removeCodexHook(raw: unknown): {
  next: Record<string, unknown>;
  changed: boolean;
  conservative: boolean;
  message: string;
} {
  if (!isRecord(raw)) {
    return {
      next: {},
      changed: false,
      conservative: true,
      message: "Codex hooks.json is not a JSON object; left untouched.",
    };
  }
  const hooks = isRecord(raw.hooks) ? { ...raw.hooks } : {};
  if (!Array.isArray(hooks.SessionEnd)) {
    return { next: raw, changed: false, conservative: false, message: "No SessionEnd hooks to remove." };
  }
  const nextSession: unknown[] = [];
  let removed = false;
  for (const matcher of hooks.SessionEnd) {
    if (!isRecord(matcher) || !Array.isArray(matcher.hooks)) {
      nextSession.push(matcher);
      continue;
    }
    const kept = matcher.hooks.filter((hook) => !isRecord(hook) || !isOurHookCommand(hook.command));
    if (kept.length !== matcher.hooks.length) {
      removed = true;
    }
    if (kept.length > 0) {
      nextSession.push({ ...matcher, hooks: kept });
    }
  }
  const nextHooks = { ...hooks };
  if (nextSession.length > 0) {
    nextHooks.SessionEnd = nextSession;
  } else {
    delete nextHooks.SessionEnd;
  }
  return {
    next: { ...raw, hooks: nextHooks },
    changed: removed,
    conservative: false,
    message: removed ? "Removed Context Engine SessionEnd hook." : "No Context Engine SessionEnd hook found.",
  };
}

export async function planCodex(paths: EnginePaths, hookCommand: string): Promise<HookPlan> {
  const configPath = paths.agentConfig.codex;
  const command = hookInvocation(hookCommand, "codex");
  const read = await readJsonFile(configPath);
  const usable = read.ok && isRecord(read.value);
  const applied = applyCodexHook(usable ? read.value : {}, command);
  return {
    agent: "codex",
    displayName: "Codex",
    configPath,
    eventName: "SessionEnd",
    command,
    existingHookCount: applied.existingCount,
    alreadyInstalled: applied.alreadyInstalled,
    wouldWrite: Boolean(applied.changed && (usable || (!read.ok && read.missing))),
    notes: read.ok
      ? usable
        ? []
        : ["Existing file is not a JSON object; install will not overwrite it."]
      : read.missing
        ? ["File is missing and will be created."]
        : [`Existing file is malformed (${read.error}); install will not overwrite it.`],
  };
}

export async function installCodex(
  paths: EnginePaths,
  hookCommand: string,
  dryRun: boolean,
): Promise<{ backup?: string; wrote: boolean; message: string }> {
  const configPath = paths.agentConfig.codex;
  const command = hookInvocation(hookCommand, "codex");
  const read = await readJsonFile(configPath);
  if (!read.ok && !read.missing) {
    return { wrote: false, message: `Refusing to modify malformed ${configPath}: ${read.error}` };
  }
  if (read.ok && !isRecord(read.value)) {
    return { wrote: false, message: `Refusing to modify non-object ${configPath}` };
  }
  const applied = applyCodexHook(read.ok ? read.value : {}, command);
  if (!applied.changed) {
    return { wrote: false, message: "Codex hook already installed." };
  }
  if (dryRun) {
    return { wrote: false, message: "Dry-run: would add Codex SessionEnd hook." };
  }
  let backup: string | undefined;
  if (read.ok) {
    backup = await backupAgentConfig(paths, "codex", `${JSON.stringify(read.value, null, 2)}\n`);
  }
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(applied.next, null, 2)}\n`, "utf8");
  return { wrote: true, ...(backup !== undefined ? { backup } : {}), message: "Installed Codex SessionEnd hook." };
}

export async function uninstallCodex(
  paths: EnginePaths,
  dryRun: boolean,
): Promise<{ backup?: string; removed: boolean; conservative: boolean; message: string }> {
  const configPath = paths.agentConfig.codex;
  const read = await readJsonFile(configPath);
  if (!read.ok) {
    return {
      removed: false,
      conservative: !read.missing,
      message: read.missing ? "No Codex hooks.json present." : `Cannot safely edit malformed ${configPath}.`,
    };
  }
  const next = removeCodexHook(read.value);
  if (!next.changed) {
    return { removed: false, conservative: next.conservative, message: next.message };
  }
  if (dryRun) {
    return { removed: false, conservative: false, message: "Dry-run: would remove Codex Context Engine hook." };
  }
  const backup = await backupAgentConfig(paths, "codex", `${JSON.stringify(read.value, null, 2)}\n`);
  await writeFile(configPath, `${JSON.stringify(next.next, null, 2)}\n`, "utf8");
  return { removed: true, conservative: false, backup, message: next.message };
}
