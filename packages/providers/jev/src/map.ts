import type {
  PackedCandidate,
  SemanticClassificationRequest,
  SemanticItemResult,
} from "@fast-jev/core";

export const JEV_SCORE_CRITERIA = [
  "Clearly irrelevant to the current task, constraints, and errors",
  "Mostly leftover historical output with little current value",
  "Possibly useful background; worth compressing rather than dropping",
  "Relevant to the current task or recent work",
  "Essential for the current task, constraints, or unresolved errors",
] as const;

export interface JevScoreQuestion {
  type: "score";
  instructions: string;
  criteria: string[];
}

export interface JevSystemOneRequest {
  model: string;
  state: unknown;
  questions: Record<string, JevScoreQuestion>;
}

export interface JevScoreAnswer {
  type: "score";
  score: number;
  confidence?: number;
  legend?: Record<string, string>;
  probabilities?: Record<string, number>;
}

export interface JevSystemOneResponse {
  model?: string;
  answers?: Record<string, JevScoreAnswer | { type: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export function questionKey(index: number): string {
  return `c${index}`;
}

export function toJevRequest(request: SemanticClassificationRequest, model: string): JevSystemOneRequest {
  const questions: Record<string, JevScoreQuestion> = {};
  request.candidates.forEach((candidate, index) => {
    questions[questionKey(index)] = {
      type: "score",
      instructions: `How relevant is candidate ${candidate.itemId} (${candidate.kind}${candidate.toolKind ? `/${candidate.toolKind}` : ""}) to the current task, user constraints, and unresolved errors?`,
      criteria: [...JEV_SCORE_CRITERIA],
    };
  });
  return {
    model,
    state: {
      sessionId: request.sessionId,
      currentTask: request.packedState.currentTask ?? "",
      userConstraints: request.packedState.userConstraints,
      currentErrors: request.packedState.currentErrors,
      modifiedFiles: request.packedState.modifiedFiles,
      recentActivity: request.packedState.recentActivity,
      architecturalFacts: request.packedState.architecturalFacts,
      tokenBudget: request.tokenBudget,
      policyVersion: request.policyVersion,
      candidates: request.candidates.map(summarizeCandidate),
    },
    questions,
  };
}

function summarizeCandidate(candidate: PackedCandidate): Record<string, unknown> {
  return {
    itemId: candidate.itemId,
    kind: candidate.kind,
    origin: candidate.origin,
    importance: candidate.importance,
    toolKind: candidate.toolKind,
    command: candidate.command,
    path: candidate.path,
    order: candidate.order,
    ageFromEnd: candidate.ageFromEnd,
    tokenCount: candidate.tokenCount,
    relationships: candidate.relationships,
    contentPreview: candidate.contentPreview,
  };
}

export function relevanceFromScore(score: number, levels = JEV_SCORE_CRITERIA.length): number {
  const max = Math.max(1, levels - 1);
  if (!Number.isFinite(score)) {
    return 0;
  }
  return Math.min(1, Math.max(0, score / max));
}

export function toSemanticResults(
  request: SemanticClassificationRequest,
  response: JevSystemOneResponse,
): SemanticItemResult[] {
  const answers = response.answers ?? {};
  const results: SemanticItemResult[] = [];
  request.candidates.forEach((candidate, index) => {
    const answer = answers[questionKey(index)];
    if (!answer || answer.type !== "score" || !("score" in answer)) {
      return;
    }
    const relevanceScore = relevanceFromScore(answer.score);
    const confidence = Number.isFinite(answer.confidence) ? (answer.confidence as number) : 0;
    results.push({
      itemId: candidate.itemId,
      action: "KEEP",
      relevanceScore,
      confidence,
      reasonCode: "SEMANTIC_CLASSIFICATION",
      reason: "Jev score mapped to relevance; action is assigned by core policy",
    });
  });
  return results;
}
