import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { toShadowJsonDocument } from "./analyze.js";
import type { ShadowAnalysisResult } from "./types.js";

export const DEFAULT_SHADOW_DIR = ".context-engine/shadow";

export function shadowReportPath(sessionId: string, directory = DEFAULT_SHADOW_DIR): string {
  const safe = sessionId.replace(/[^A-Za-z0-9._-]+/g, "_");
  return join(directory, `${safe}.json`);
}

/**
 * Persist the analysis REPORT only. Never copies the source transcript.
 */
export async function writeShadowReport(
  result: ShadowAnalysisResult,
  options?: { directory?: string; sourcePath?: string },
): Promise<string> {
  const directory = options?.directory ?? DEFAULT_SHADOW_DIR;
  const target = shadowReportPath(result.sessionId, directory);
  await mkdir(dirname(target), { recursive: true });
  const document = toShadowJsonDocument(result, options?.sourcePath);
  await writeFile(target, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  return target;
}
