import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { EnginePaths, HookPlan } from "../types.js";
import { countCommands, isRecord } from "../json.js";
import { hookInvocation, isOurHookCommand } from "../hook-command.js";
import { backupAgentConfig, readJsonFile } from "./io.js";

export function applyClaudeHook(
  raw: unknown,
  command: string,
): { next: Record<string, unknown>; changed: boolean; existingCount: number; alreadyInstalled: boolean } {
  const doc = isRecord(raw) ? { ...raw } : {};
  const hooks = isRecord(doc.hooks) ? { ...doc.hooks } : {};
  const sessionEnd = Array.isArray(hooks.SessionEnd) ? [...hooks.SessionEnd] : [];
  const existingCount = countCommands(sessionEnd);
  const alreadyInstalled = JSON.stringify(sessionEnd).includes("--context-engine-shadow");
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
        failClosed: false,
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

export function removeClaudeHook(raw: unknown): {
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
      message: "Claude settings.json is not a JSON object; left untouched.",
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

export async function planClaude(paths: EnginePaths, hookCommand: string): Promise<HookPlan> {
  const configPath = paths.agentConfig.claude;
  const command = hookInvocation(hookCommand, "claude");
  const read = await readJsonFile(configPath);
  const usable = read.ok && isRecord(read.value);
  const applied = applyClaudeHook(usable ? read.value : {}, command);
  return {
    agent: "claude",
    displayName: "Claude Code",
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

export async function installClaude(
  paths: EnginePaths,
  hookCommand: string,
  dryRun: boolean,
): Promise<{ backup?: string; wrote: boolean; message: string }> {
  const configPath = paths.agentConfig.claude;
  const command = hookInvocation(hookCommand, "claude");
  const read = await readJsonFile(configPath);
  if (!read.ok && !read.missing) {
    return { wrote: false, message: `Refusing to modify malformed ${configPath}: ${read.error}` };
  }
  if (read.ok && !isRecord(read.value)) {
    return { wrote: false, message: `Refusing to modify non-object ${configPath}` };
  }
  const applied = applyClaudeHook(read.ok ? read.value : {}, command);
  if (!applied.changed) {
    return { wrote: false, message: "Claude hook already installed." };
  }
  if (dryRun) {
    return { wrote: false, message: "Dry-run: would add Claude SessionEnd hook." };
  }
  let backup: string | undefined;
  if (read.ok) {
    backup = await backupAgentConfig(paths, "claude", `${JSON.stringify(read.value, null, 2)}\n`);
  }
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(applied.next, null, 2)}\n`, "utf8");
  return { wrote: true, ...(backup !== undefined ? { backup } : {}), message: "Installed Claude SessionEnd hook." };
}

export async function uninstallClaude(
  paths: EnginePaths,
  dryRun: boolean,
): Promise<{ backup?: string; removed: boolean; conservative: boolean; message: string }> {
  const configPath = paths.agentConfig.claude;
  const read = await readJsonFile(configPath);
  if (!read.ok) {
    return {
      removed: false,
      conservative: !read.missing,
      message: read.missing ? "No Claude settings.json present." : `Cannot safely edit malformed ${configPath}.`,
    };
  }
  const next = removeClaudeHook(read.value);
  if (!next.changed) {
    return { removed: false, conservative: next.conservative, message: next.message };
  }
  if (dryRun) {
    return { removed: false, conservative: false, message: "Dry-run: would remove Claude Context Engine hook." };
  }
  const backup = await backupAgentConfig(paths, "claude", `${JSON.stringify(read.value, null, 2)}\n`);
  await writeFile(configPath, `${JSON.stringify(next.next, null, 2)}\n`, "utf8");
  return { removed: true, conservative: false, backup, message: next.message };
}
