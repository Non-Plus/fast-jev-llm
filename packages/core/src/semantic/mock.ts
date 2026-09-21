import type {
  SemanticAction,
  SemanticClassificationRequest,
  SemanticClassificationResult,
  SemanticItemResult,
  SemanticProvider,
} from "../types.js";

export interface MockSemanticResponse {
  action?: SemanticAction;
  relevanceScore?: number;
  confidence?: number;
  reason?: string;
  reasonCode?: SemanticItemResult["reasonCode"];
}

export interface MockSemanticProviderOptions {
  responses?: Record<string, MockSemanticResponse>;
  defaultResponse?: MockSemanticResponse;
  fail?: boolean | string;
  failOnce?: boolean;
  timeout?: boolean;
  omitIds?: readonly string[];
  extraIds?: readonly string[];
  invalidActions?: boolean;
  nanScores?: boolean;
  delayMs?: number;
}

function scoresFor(configured: MockSemanticResponse): { action: SemanticAction; relevanceScore: number; confidence: number } {
  const action = configured.action ?? "KEEP";
  const confidence = configured.confidence ?? 0.9;
  if (configured.relevanceScore !== undefined) {
    return { action, relevanceScore: configured.relevanceScore, confidence };
  }
  if (action === "KEEP") {
    return { action, relevanceScore: 0.85, confidence };
  }
  if (action === "COMPRESS") {
    return { action, relevanceScore: 0.5, confidence };
  }
  return { action, relevanceScore: 0.1, confidence };
}

export class MockSemanticProvider implements SemanticProvider {
  readonly name = "mock";
  readonly version = "mock-1";
  readonly remote = false;
  calls: SemanticClassificationRequest[] = [];
  private failedOnce = false;

  constructor(private readonly options: MockSemanticProviderOptions = {}) {}

  async classify(request: SemanticClassificationRequest): Promise<SemanticClassificationResult> {
    this.calls.push(request);
    if (this.options.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, this.options.delayMs));
    }
    if (this.options.timeout) {
      throw new Error("semantic provider timeout");
    }
    if (this.options.failOnce && !this.failedOnce) {
      this.failedOnce = true;
      throw new Error(typeof this.options.fail === "string" ? this.options.fail : "mock failure");
    }
    if (this.options.fail) {
      throw new Error(typeof this.options.fail === "string" ? this.options.fail : "mock failure");
    }

    const omit = new Set(this.options.omitIds ?? []);
    const decisions: SemanticItemResult[] = [];
    for (const candidate of request.candidates) {
      if (omit.has(candidate.itemId)) {
        continue;
      }
      const configured = this.options.responses?.[candidate.itemId] ?? this.options.defaultResponse ?? {};
      const scored = scoresFor(configured);
      const relevanceScore = this.options.nanScores ? Number.NaN : scored.relevanceScore;
      const action = this.options.invalidActions ? ("PROTECT" as SemanticAction) : scored.action;
      decisions.push({
        itemId: candidate.itemId,
        action,
        relevanceScore,
        confidence: scored.confidence,
        reasonCode: configured.reasonCode ?? "SEMANTIC_CLASSIFICATION",
        reason: configured.reason ?? "mock semantic decision",
      });
    }
    for (const extra of this.options.extraIds ?? []) {
      decisions.push({
        itemId: extra,
        action: "DROP",
        relevanceScore: 0,
        confidence: 1,
        reasonCode: "SEMANTIC_CLASSIFICATION",
        reason: "unknown extra id",
      });
    }
    return {
      provider: this.name,
      providerVersion: this.version,
      decisions,
      usage: {
        requests: 1,
        inputTokens: request.candidates.length * 20,
        outputTokens: request.candidates.length * 5,
        latencyMs: this.options.delayMs ?? 1,
        estimatedCostUnavailable: true,
      },
    };
  }
}
