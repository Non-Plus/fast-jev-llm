# Semantic relevance layer

Optional classification for items the **deterministic** engine already
marked as safe to evaluate. Semantic output is never authoritative over
protected context.

Default: `semanticMode = off`. Nothing is sent anywhere.

## What it does

After protect + prune:

1. Assign `semanticEligibility`: `forbidden` | `eligible` | `recommended`
2. Pack a compact session state (not the transcript)
3. Batch candidates (`semanticBatchMaxItems` / `semanticBatchMaxTokens`)
4. Ask a `SemanticProvider` for relevance scores
5. Apply **core** policy thresholds
6. Veto DROP against retention protection, structural KEEP, current-task
   and unresolved-error evaluations
7. Merge with safety > structural > heuristic > semantic

Providers may return `KEEP` | `COMPRESS` | `DROP`. They cannot return
`PROTECT`. Thresholds live in `SemanticPolicy`, not in the provider.

Conservative defaults:

| Relevance | Action |
|-----------|--------|
| ≥ 0.70 | KEEP |
| 0.35–0.70 | COMPRESS |
| < 0.35 and confidence ≥ 0.80 | DROP |
| < 0.35 and confidence < 0.80 | COMPRESS |

On timeout, network failure, invalid JSON, missing/duplicate/unknown
ids, invalid actions, or NaN scores: keep the deterministic decision.
Classification failure never DROPs and never fails `compact()`.

## Provider contract

```ts
interface SemanticProvider {
  readonly name: string;
  classify(request: SemanticClassificationRequest): Promise<SemanticClassificationResult>;
}
```

`SemanticClassificationRequest` contains packed session state, packed
candidates, a token budget, and a policy version. Providers must not
import Codex types.

`MockSemanticProvider` (`packages/core`) is the test double.
`JevSemanticProvider` (`packages/providers/jev`) is the first remote
implementation (TypeSafe System One). Local providers (Ollama, MLX,
embeddings) are not implemented.

## Privacy modes

| Mode | Behavior |
|------|----------|
| `off` (default) | Deterministic engine only |
| `local` | Interface only; no real local model yet |
| `remote` | May call Jev after an explicit CLI/config opt-in |

Remote providers set `remote: true`. The engine refuses them unless
`semanticMode === "remote"`.

## Codex shadow

```bash
ctx codex analyze session.jsonl
ctx codex analyze session.jsonl --semantic-mode remote --semantic-provider jev
ctx codex explain session.jsonl --semantic-mode remote --semantic-provider jev
```

Still **shadow mode**: no Codex context, transcripts, compaction, or
prompts are modified.

## Cursor shadow

```bash
ctx cursor analyze session.jsonl
ctx cursor analyze session.jsonl --semantic-mode remote --semantic-provider jev
ctx cursor explain session.jsonl --semantic-mode remote --semantic-provider jev
```

Same semantic layer. Still **shadow mode**: no Cursor context is modified.
