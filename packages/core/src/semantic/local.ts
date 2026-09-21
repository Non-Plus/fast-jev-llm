import type {
  SemanticClassificationRequest,
  SemanticClassificationResult,
  SemanticProvider,
} from "../types.js";

/**
 * Local-mode port. A real local classifier is intentionally not implemented
 * in this slice (no Ollama/MLX/embeddings).
 */
export class UnimplementedLocalSemanticProvider implements SemanticProvider {
  readonly name = "local";
  readonly remote = false;

  async classify(request: SemanticClassificationRequest): Promise<SemanticClassificationResult> {
    void request;
    return {
      provider: this.name,
      decisions: [],
      failure: "local semantic provider is not implemented",
    };
  }
}
