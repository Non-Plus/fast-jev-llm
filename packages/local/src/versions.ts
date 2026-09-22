import { DEFAULT_SEMANTIC_POLICY } from "@fast-jev/core";
import { RULESET_VERSION } from "./types.js";
import { RELEASE_VERSION } from "./release-version.js";

export const ENGINE_VERSION = RELEASE_VERSION;
export const CORE_VERSION = RELEASE_VERSION;
export const ADAPTER_VERSIONS = {
  codex: RELEASE_VERSION,
  cursor: RELEASE_VERSION,
  claude: RELEASE_VERSION,
} as const;

export function semanticPolicyVersion(): string {
  return DEFAULT_SEMANTIC_POLICY.policyVersion;
}

export { RULESET_VERSION };
