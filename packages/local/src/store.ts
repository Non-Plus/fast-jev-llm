import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentId, EnginePaths, StoreReport } from "./types.js";
import { AGENTS } from "./types.js";
import { reportsDir } from "./paths.js";
import { parseStoreReport, reportFileName } from "./report-schema.js";

export async function writeStoreReport(paths: EnginePaths, report: StoreReport): Promise<string> {
  const dir = reportsDir(paths, report.agent);
  await mkdir(dir, { recursive: true });
  const target = join(dir, reportFileName(report));
  await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return target;
}

export async function readStoreReportFile(path: string): Promise<StoreReport | undefined> {
  try {
    const text = await readFile(path, "utf8");
    return parseStoreReport(JSON.parse(text) as unknown);
  } catch {
    return undefined;
  }
}

export async function listReportFiles(paths: EnginePaths, agent?: AgentId): Promise<string[]> {
  const agents = agent ? [agent] : [...AGENTS];
  const files: string[] = [];
  for (const id of agents) {
    const dir = reportsDir(paths, id);
    let names: string[] = [];
    try {
      names = await readdir(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.endsWith(".json")) {
        continue;
      }
      files.push(join(dir, name));
    }
  }
  return files;
}

export async function loadReports(
  paths: EnginePaths,
  options?: { agent?: AgentId; skipMalformed?: boolean },
): Promise<{ reports: StoreReport[]; skipped: number }> {
  const files = await listReportFiles(paths, options?.agent);
  const reports: StoreReport[] = [];
  let skipped = 0;
  for (const file of files) {
    const parsed = await readStoreReportFile(file);
    if (parsed) {
      reports.push(parsed);
    } else {
      skipped += 1;
    }
  }
  return { reports, skipped };
}

export async function pruneReports(
  paths: EnginePaths,
  olderThanMs: number,
  now = Date.now(),
): Promise<number> {
  const files = await listReportFiles(paths);
  let removed = 0;
  for (const file of files) {
    const report = await readStoreReportFile(file);
    const mtime = report ? Date.parse(report.timestamp) : (await stat(file)).mtimeMs;
    if (!Number.isFinite(mtime) || now - mtime < olderThanMs) {
      continue;
    }
    await rm(file, { force: true });
    removed += 1;
  }
  return removed;
}

export async function clearReports(paths: EnginePaths): Promise<number> {
  const files = await listReportFiles(paths);
  for (const file of files) {
    await rm(file, { force: true });
  }
  return files.length;
}
