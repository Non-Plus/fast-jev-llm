import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { EnginePaths, HookPlan } from "../types.js";
import { countCommands, isRecord } from "../json.js";
import { hookInvocation, isOurHookCommand } from "../hook-command.js";
import { backupAgentConfig, readJsonFile } from "./io.js";

export function applyCursorHook(
  raw: unknown,
  command: string,
): { next: Record<string, unknown>; changed: boolean; existingCount: number; alreadyInstalled: boolean } {
  const doc: Record<string, unknown> = isRecord(raw) ? { ...raw } : { version: 1 };
  const hooks = isRecord(doc.hooks) ? { ...doc.hooks } : {};
  const sessionEnd = Array.isArray(hooks.sessionEnd) ? [...hooks.sessionEnd] : [];
  const existingCount = countCommands(sessionEnd);
  const alreadyInstalled = sessionEnd.some((entry) => isRecord(entry) && isOurHookCommand(entry.command));
  if (alreadyInstalled) {
    return {
      next: { ...doc, version: doc.version ?? 1, hooks: { ...hooks, sessionEnd } },
      changed: false,
      existingCount,
      alreadyInstalled: true,
    };
  }
  sessionEnd.push({
    command,
    timeout: 3,
    failClosed: false,
  });
  return {
    next: { ...doc, version: doc.version ?? 1, hooks: { ...hooks, sessionEnd } },
    changed: true,
    existingCount,
    alreadyInstalled: false,
  };
}

export function removeCursorHook(raw: unknown): {
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
      message: "Cursor hooks.json is not a JSON object; left untouched.",
    };
  }
  const hooks = isRecord(raw.hooks) ? { ...raw.hooks } : {};
  if (!Array.isArray(hooks.sessionEnd)) {
    return { next: raw, changed: false, conservative: false, message: "No sessionEnd hooks to remove." };
  }
  const kept = hooks.sessionEnd.filter((entry) => !isRecord(entry) || !isOurHookCommand(entry.command));
  const removed = kept.length !== hooks.sessionEnd.length;
  const nextHooks = { ...hooks };
  if (kept.length > 0) {
    nextHooks.sessionEnd = kept;
  } else {
    delete nextHooks.sessionEnd;
  }
  return {
    next: { ...raw, hooks: nextHooks },
    changed: removed,
    conservative: false,
    message: removed ? "Removed Context Engine sessionEnd hook." : "No Context Engine sessionEnd hook found.",
  };
}

export async function planCursor(paths: EnginePaths, hookCommand: string): Promise<HookPlan> {
  const configPath = paths.agentConfig.cursor;
  const command = hookInvocation(hookCommand, "cursor");
  const read = await readJsonFile(configPath);
  const usable = read.ok && isRecord(read.value);
  const applied = applyCursorHook(usable ? read.value : {}, command);
  return {
    agent: "cursor",
    displayName: "Cursor",
    configPath,
    eventName: "sessionEnd",
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

export async function installCursor(
  paths: EnginePaths,
  hookCommand: string,
  dryRun: boolean,
): Promise<{ backup?: string; wrote: boolean; message: string }> {
  const configPath = paths.agentConfig.cursor;
  const command = hookInvocation(hookCommand, "cursor");
  const read = await readJsonFile(configPath);
  if (!read.ok && !read.missing) {
    return { wrote: false, message: `Refusing to modify malformed ${configPath}: ${read.error}` };
  }
  if (read.ok && !isRecord(read.value)) {
    return { wrote: false, message: `Refusing to modify non-object ${configPath}` };
  }
  const applied = applyCursorHook(read.ok ? read.value : {}, command);
  if (!applied.changed) {
    return { wrote: false, message: "Cursor hook already installed." };
  }
  if (dryRun) {
    return { wrote: false, message: "Dry-run: would add Cursor sessionEnd hook." };
  }
  let backup: string | undefined;
  if (read.ok) {
    backup = await backupAgentConfig(paths, "cursor", `${JSON.stringify(read.value, null, 2)}\n`);
  }
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(applied.next, null, 2)}\n`, "utf8");
  return { wrote: true, ...(backup !== undefined ? { backup } : {}), message: "Installed Cursor sessionEnd hook." };
}

export async function uninstallCursor(
  paths: EnginePaths,
  dryRun: boolean,
): Promise<{ backup?: string; removed: boolean; conservative: boolean; message: string }> {
  const configPath = paths.agentConfig.cursor;
  const read = await readJsonFile(configPath);
  if (!read.ok) {
    return {
      removed: false,
      conservative: !read.missing,
      message: read.missing ? "No Cursor hooks.json present." : `Cannot safely edit malformed ${configPath}.`,
    };
  }
  const next = removeCursorHook(read.value);
  if (!next.changed) {
    return { removed: false, conservative: next.conservative, message: next.message };
  }
  if (dryRun) {
    return { removed: false, conservative: false, message: "Dry-run: would remove Cursor Context Engine hook." };
  }
  const backup = await backupAgentConfig(paths, "cursor", `${JSON.stringify(read.value, null, 2)}\n`);
  await writeFile(configPath, `${JSON.stringify(next.next, null, 2)}\n`, "utf8");
  return { removed: true, conservative: false, backup, message: next.message };
}
