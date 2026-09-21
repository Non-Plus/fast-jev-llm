# Architecture: Provider-Independent Context Engine

A coding-agent session accumulates tool output far faster than useful
signal: repeated file reads, stale `git status`, old test failures, and
directory listings that have already been superseded. This engine
compacts that transcript **deterministically**, without calling a model.

Later stages (semantic classification, learned compression, Cursor
adapters, archival, project memory) plug in through stable ports.

Codex is integrated only as a **passive shadow adapter**: it parses
JSONL into the canonical `Transcript` and runs `compact()`. It does not
replace Codex compaction or mutate sessions.

Cursor is integrated the same way: `packages/adapter-cursor` parses
Cursor agent-transcript JSONL into the same canonical `Transcript` and
runs the same `compact()`. It does not replace Cursor compaction or
mutate Cursor context.

## Goals

- Canonical, provider-neutral transcript types
- Immutable input: the original transcript is never mutated
- Every item receives a winning decision: `PROTECT` | `KEEP` | `COMPRESS` | `DROP`
- Retention (`protected` | `normal`) is independent of compression eligibility (`allowed` | `forbidden`)
- A full **audit trail** of every rule evaluation, including losers
- Typed `reasonCode` values for programmatic consumers; human `reason`
  text is display-only
- Authority-ordered merge: safety > structural > heuristic > semantic
- Deterministic pruning plus retention protection (protected items cannot be dropped; they may still be compressed when compression is allowed)
- Deterministic importance (`CRITICAL` | `IMPORTANT` | `NORMAL` | `EPHEMERAL`) that influences rules but never itself deletes
- Message origin (`user` | `developer` | `system` | `tool` | `plugin` | `agent` | `unknown`) separate from role and vendor
- Pluggable `TokenEstimator` (default: approximate chars/4)
- File-state-aware read pruning, snapshot command pruning, structured compression
- Optional semantic relevance classification behind `semanticMode` (default `off`)

## Non-goals (this slice)

- Active Codex or Cursor compaction, context replacement, or message injection
- Local LLMs (Ollama/MLX), embeddings, or vector databases
- HTTP servers, UI, or databases
- Local archival and project memory
- Streaming / incremental session mutation APIs
- Graph databases or graph algorithms for relations

## Package layout

```
packages/core                 Canonical types + compaction engine
packages/adapter-codex        Codex JSONL → Transcript + shadow analysis
packages/adapter-cursor       Cursor JSONL → Transcript + shadow analysis
packages/providers            SemanticProvider barrel + noop
packages/providers/jev        Isolated TypeSafe Jev provider
cli                           `ctx compact`, `ctx codex analyze|explain`, `ctx cursor analyze|explain`
benchmarks                    Timing harness + large JSONL shadow benches
fixtures                      Shared example sessions
```

## Canonical model

```
Transcript
  └── ContextMessage[]          original, treated as frozen

ContextItem                     derived work unit
ContextDecision                 one rule evaluation (winner or loser)
ItemDecisionRecord              winning + all evaluations for an item
ContextRelation                 optional lightweight edge
SessionState                    items + token totals + TaskState + relations
TokenEstimator                  estimate(text): number
CompressionStrategy             head_tail | error_extract | test_summary
SemanticProvider                optional port
CompactionResult                compacted items + audit + stats
```

### Decisions

Every decision contains:

| Field        | Role                                              |
|--------------|---------------------------------------------------|
| `itemId`     | Source item                                       |
| `action`     | `PROTECT` / `KEEP` / `COMPRESS` / `DROP`          |
| `rule`       | Rule name                                         |
| `reasonCode` | Stable programmatic code                          |
| `reason`     | Human-readable; never used for control flow       |
| `authority`  | `safety` \| `structural` \| `heuristic` \| `semantic` |
| `retention`  | `protected` \| `normal` — protected items cannot be dropped |
| `compression`| `allowed` \| `forbidden` — independent of retention |
| `importance` | optional `CRITICAL` \| `IMPORTANT` \| `NORMAL` \| `EPHEMERAL` |

`CompactionResult` exposes:

- `decisions` — winning decision per item (same length as `items`)
- `evaluations` — every rule emission, including losing ones
- `decisionRecords` — `{ itemId, winning, evaluations }` per item

### Reason codes

`SUPERSEDED_FILE_READ`, `WRITE_INVALIDATED_READ`, `SUPERSEDED_GIT_STATUS`,
`SUPERSEDED_GIT_DIFF`, `OLD_DIRECTORY_LISTING`, `SUPERSEDED_TEST_RUN`,
`TEST_FAILURE_RESOLVED`, `DUPLICATE_OUTPUT`, `LARGE_OUTPUT`,
`LARGE_BUILD_OUTPUT`, `LARGE_TEST_OUTPUT`, `LARGE_GIT_DIFF`,
`LARGE_DIRECTORY_LISTING`, `RECENT_CONTEXT`, `USER_CONSTRAINT`,
`SYSTEM_INSTRUCTION`, `CURRENT_TASK`, `UNRESOLVED_ERROR`, plus
`SEMANTIC_CLASSIFICATION`, `SEMANTIC_KEEP`, `SEMANTIC_COMPRESS`,
`SEMANTIC_DROP`, `SEMANTIC_LOW_CONFIDENCE`, `SEMANTIC_PROVIDER_FAILURE`,
and `SENSITIVE_CONTENT_REMOTE_BLOCK`.

### Authority merge

1. Synthesize `KEEP` / `DEFAULT_KEEP` / `heuristic` when nothing matches.
2. Retention protection is collected independently of the winning action.
   A protected item cannot be `DROP`ped.
3. Compression eligibility is collected independently. Any `forbidden`
   evaluation blocks compression; otherwise recent tool results may be
   `COMPRESS`ed.
4. Otherwise higher authority wins: safety > structural > heuristic > semantic.
5. Semantic may compete with heuristic **only** when the item is eligible
   (not retention-protected). It cannot override safety or structural
   decisions, and cannot un-protect or drop a protected item.
6. Equal authority uses action rank: `DROP` > `COMPRESS` > `KEEP`.
   The first equal-rank winner is kept. `PROTECT` evaluations contribute
   retention/compression rather than always winning the action.

### File state

Normalized tool metadata for file operations includes:

- `normalizedPath`
- `contentHash` when content is available
- `operationIndex`
- `writeBetweenReads`

The superseded-file-read rule does **not** treat every later read of a
path as a duplicate snapshot:

- Read A, Read A (no write) → earlier `SUPERSEDED_FILE_READ`
- Read A, Write A, Read A → earlier `WRITE_INVALIDATED_READ`

### Relations

Optional `ContextRelation` edges (`supersedes`, `invalidates`,
`validates`, `depends_on`, `caused_by`) are a flat list. No graph store
or algorithms. Normalization/rules emit obvious ones:

- later file read **supersedes** earlier read
- file write **invalidates** previous read
- successful test **validates** the latest preceding write

### Failures

When a tool result is a failure, `failureKind` is attached
deterministically: `test`, `build`, `compile`, `lint`, `runtime`,
`network`, `deployment`, or `unknown`. No AI classification.

### Command pruning

Generic commands are dropped only when a later execution of the same
command produced **equivalent normalized output** (`DUPLICATE_OUTPUT`).
Identity uses `command` (or tool name) plus `normalizedContentHash`.
Normalization is conservative: trim, unify newlines, and strip known
line-start timestamps. Identical command strings with different
normalized hashes are kept. File reads/writes are excluded from this
rule.

The relation recorded is `newerItem supersedes olderItem`.

Snapshot categories (git status, git diff, directory listings, file
reads/tests) have their own structural rules and are not inferred from
command-string equality.

### Compression

`CompressionStrategy` produces `{ strategy, originalTokens, retainedTokens, content }`:

| Strategy          | When                                              |
|-------------------|---------------------------------------------------|
| `error_extract`   | Build/compiler output (`build_run` or diagnostics) |
| `test_summary`    | Test-run output                                   |
| `git_diff`        | `git diff` / `diff --git` (falls back to `head_tail`) |
| `directory_list`  | Directory listings; noisy dirs counted not dumped |
| `head_tail`       | Fallback                                          |

No LLM compression. A `SemanticProvider.compress` hook still overrides
when a caller supplies one.

### Task state

`SessionState.task` is filled conservatively:

- `rootTask` — first substantive user message
- `currentTask` — last substantive user message (`yes` / `continue` are acks)
- `constraints` — explicit constraint language or `metadata.constraint`
- `acceptanceCriteria` — `Acceptance criteria:` / checklist lines / metadata

No sophisticated task inference.

## Data flow

```
Codex JSONL  ─┐
              ├─► adapter (vendor-specific) ─► Transcript (frozen)
Cursor JSONL ─┘                                        │
                                                       ▼
                                                 normalize()
                                                       │
                                                       ▼
                                                 SessionState
                                                       │
                          ┌────────────────────────────┼────────────────────────────┐
                          ▼                            ▼                            ▼
                   protect rules                  prune rules               semantic (optional)
                          └────────────────────────────┼────────────────────────────┘
                                                       ▼
                                                 merge + materialize
                                                       ▼
                                               CompactionResult
```

```ts
compact(transcript: Transcript, options?: CompactOptions): Promise<CompactionResult>
```

## Token estimation

```ts
interface TokenEstimator {
  estimate(text: string): number;
}

class ApproximateTokenEstimator implements TokenEstimator {
  // tokens ≈ ceil(characterLength / charsPerToken)  default 4
}
```

No external tokenizer. Callers may inject another `TokenEstimator`
through `EngineConfig.tokenEstimator`. `estimateTokens()` remains as a
convenience wrapper.

## Statistics

Reported fields:

- original / compact tokens
- protected context split into verbatim vs compressible tokens
- kept / compressed (retained) / dropped tokens
- compression savings, drop savings, total potential savings
- reduction percentage
- per-rule counts
- token **reduction** grouped by `reasonCode`

## Configuration

```ts
interface EngineConfig {
  recentItemCount: number;      // default 8
  largeOutputTokens: number;    // default 2000; also the generic tool budget unless overridden
  charsPerToken: number;        // default 4
  tokenEstimator?: TokenEstimator;
  toolOutputBudgets: {
    generic: 2000;
    build: 2000;
    test: 1500;
    gitDiff: 3000;
    directoryList: 1000;
  };
  reportPreviews: boolean;      // default true
  previewMaxChars: number;      // default 200
  semanticMode: "off" | "local" | "remote"; // default off
  semanticPolicy: SemanticPolicy;
  semanticBatchMaxItems: number;
  semanticBatchMaxTokens: number;
  semanticTimeoutMs: number;
  semanticCache: boolean;
  semanticCacheDir: string;
}
```

Budgets are compression **targets**, not blind truncation limits.
Structured compressors preserve useful fields first, then fit the target.

`reportPreviews` / `previewMaxChars` control shadow/local report previews.
When `reportPreviews` is false, report JSON contains no source-content
previews. Reports stay on the local machine.

See [SEMANTIC_LAYER.md](./SEMANTIC_LAYER.md) and [PRIVACY.md](./PRIVACY.md)
for classification, remote sending, redaction, and failure handling.

## Immutability

`compact()` never mutates the caller's `Transcript`. Result objects are
deep-frozen. `COMPRESS` yields a new item with stub content and a
`metadata.compression` payload.

## CLI and benchmarks

Both print original tokens, protected verbatim vs compressible tokens,
kept / compressed / dropped tokens, compression and drop savings,
reduction percent, and reduction grouped by `reasonCode`. Cursor reports
also include `effectiveTokens` and Cursor version when known. Benchmarks
also report average `compact()` latency and structured compressor quality.
