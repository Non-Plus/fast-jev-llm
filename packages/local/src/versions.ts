import { createRequire } from "node:module";
import { DEFAULT_SEMANTIC_POLICY } from "@fast-jev/core";
import { RULESET_VERSION } from "./types.js";

const require = createRequire(import.meta.url);

function pkgVersion(specifier: string, fallback: string): string {
  try {
    const pkg = require(specifier) as { version?: string };
    return pkg.version ?? fallback;
  } catch {
    return fallback;
  }
}

export const ENGINE_VERSION = pkgVersion("../package.json", "0.1.0");
export const CORE_VERSION = pkgVersion("@fast-jev/core/package.json", "0.1.0");
export const ADAPTER_VERSIONS = {
  codex: pkgVersion("@fast-jev/adapter-codex/package.json", "0.1.0"),
  cursor: pkgVersion("@fast-jev/adapter-cursor/package.json", "0.1.0"),
  claude: pkgVersion("@fast-jev/adapter-claude/package.json", "0.1.0"),
} as const;

export function semanticPolicyVersion(): string {
  return DEFAULT_SEMANTIC_POLICY.policyVersion;
}

export { RULESET_VERSION };
