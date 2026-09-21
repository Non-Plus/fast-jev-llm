import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { contentHash } from "../file-state.js";
import type { SemanticItemResult } from "../types.js";

export interface SemanticCacheKeyInput {
  provider: string;
  providerVersion?: string;
  candidateHash: string;
  stateHash: string;
  policyVersion: string;
}

export function semanticCacheKey(input: SemanticCacheKeyInput): string {
  return contentHash(
    JSON.stringify({
      provider: input.provider,
      providerVersion: input.providerVersion ?? "",
      candidateHash: input.candidateHash,
      stateHash: input.stateHash,
      policyVersion: input.policyVersion,
    }),
  );
}

export async function readSemanticCache(
  directory: string,
  key: string,
): Promise<SemanticItemResult | undefined> {
  try {
    const raw = await readFile(join(directory, `${key}.json`), "utf8");
    const parsed = JSON.parse(raw) as SemanticItemResult;
    if (typeof parsed.itemId !== "string" || typeof parsed.action !== "string") {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

export async function writeSemanticCache(
  directory: string,
  key: string,
  value: SemanticItemResult,
): Promise<void> {
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, `${key}.json`), `${JSON.stringify(value)}\n`, "utf8");
}
