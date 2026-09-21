import type { ContextDecision, SemanticProvider } from "@fast-jev/core";

/**
 * Placeholder provider. Real Jev / OpenAI / Anthropic / local adapters
 * should implement SemanticProvider and live in this package.
 */
export class NoopSemanticProvider implements SemanticProvider {
  readonly name = "noop";

  async classify(): Promise<readonly ContextDecision[]> {
    return [];
  }
}

export type { SemanticProvider } from "@fast-jev/core";
