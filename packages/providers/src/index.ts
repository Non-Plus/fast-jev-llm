import type {
  SemanticClassificationRequest,
  SemanticClassificationResult,
  SemanticProvider,
} from "@fast-jev/core";

/**
 * Placeholder provider used in tests. Real adapters live beside this file
 * (`jev/` for TypeSafe Jev).
 */
export class NoopSemanticProvider implements SemanticProvider {
  readonly name = "noop";
  readonly remote = false;

  async classify(_request: SemanticClassificationRequest): Promise<SemanticClassificationResult> {
    void _request;
    return { provider: this.name, decisions: [] };
  }
}

export type { SemanticProvider } from "@fast-jev/core";
export {
  JevSemanticProvider,
  jevProviderFromEnv,
  type JevSemanticProviderOptions,
} from "@fast-jev/provider-jev";
