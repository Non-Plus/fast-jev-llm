# Architecture: Provider-Independent Context Engine

A coding-agent session accumulates tool output far faster than useful
signal: repeated file reads, stale `git status`, old test failures, and
directory listings that have already been superseded. This engine
compacts that transcript **deterministically**, without calling a model.

Later stages (semantic classification, learned compression, Codex/Cursor
adapters, archival, project memory) plug in through stable ports. They
are not implemented here.

## Goals

- Canonical, provider-neutral transcript types
- Immutable input: the original transcript is never mutated
- Every item receives a winning decision: `PROTECT` | `KEEP` | `COMPRESS` | `DROP`
- A full **audit trail** of every rule evaluation, including losers
- Typed `reasonCode` values for programmatic consumers; human `reason`
  text is display-only
- Authority-ordered merge: safety > structural > heuristic > semantic
- Deterministic pruning plus a protected-context veto (`PROTECT` is sticky)
- Pluggable `TokenEstimator` (default: approximate chars/4)
- File-state-aware read pruning, snapshot command pruning, structured compression
- A compaction pipeline that can later call a `SemanticProvider` without
  changing its shape

## Non-goals (this slice)

- Codex or Cursor adapters
- LLM calls, embeddings, or Jev
- HTTP servers, UI, or databases
- Local archival and project memory
- Streaming / incremental session mutation APIs
- Graph databases or graph algorithms for relations

## Package layout

```
packages/core         Canonical types + compaction engine
packages/providers    Future SemanticProvider implementations (stub only)
cli                   Compact a JSON transcript and print statistics
benchmarks            Timing harness + stats over the fixture transcript
fixtures              Shared example sessions
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

`CompactionResult` exposes:

- `decisions` — winning decision per item (same length as `items`)
- `evaluations` — every rule emission, including losing ones
- `decisionRecords` — `{ itemId, winning, evaluations }` per item

### Reason codes

`SUPERSEDED_FILE_READ`, `WRITE_INVALIDATED_READ`, `SUPERSEDED_GIT_STATUS`,
`SUPERSEDED_GIT_DIFF`, `OLD_DIRECTORY_LISTING`, `SUPERSEDED_TEST_RUN`,
`TEST_FAILURE_RESOLVED`, `DUPLICATE_OUTPUT`, `LARGE_OUTPUT`,
`RECENT_CONTEXT`, `USER_CONSTRAINT`, `SYSTEM_INSTRUCTION`,
`CURRENT_TASK`, `UNRESOLVED_ERROR`, plus `DEFAULT_KEEP` and
`SEMANTIC_CLASSIFICATION`.

### Authority merge

1. Synthesize `KEEP` / `DEFAULT_KEEP` / `heuristic` when nothing matches.
2. `PROTECT` is sticky from any authority and cannot be overridden.
3. Otherwise higher authority wins: safety > structural > heuristic > semantic.
4. Semantic may compete with heuristic **only** when the item is eligible
   (not already `PROTECT`). It cannot override safety or structural
   decisions, and cannot un-protect.
5. Equal authority uses action rank: `DROP` > `COMPRESS` > `KEEP`.
   The first equal-rank winner is kept.

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
command produced **identical normalized output** (`DUPLICATE_OUTPUT`).
Identical command strings with different outputs are kept.

Snapshot categories (git status, git diff, directory listings, file
reads/tests) have their own structural rules and are not inferred from
command-string equality.

### Compression

`CompressionStrategy` produces `{ strategy, originalTokens, retainedTokens, content }`:

| Strategy        | When                                              |
|-----------------|---------------------------------------------------|
| `error_extract` | Build/compiler failures or recognizable diagnostics |
| `test_summary`  | Test-run output                                   |
| `head_tail`     | Fallback                                          |

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
Transcript (frozen)
        │
        ▼
  normalize()     pair tools, classify, hash file ops, estimate tokens
        │
        ▼
  SessionState    items + TaskState + relations
        │
        ├─► protect rules      PROTECT (safety + heuristic recency)
        ├─► prune rules        DROP / COMPRESS
        └─► SemanticProvider   optional; eligible non-PROTECT items only
                │
                ▼
        merge (authority + sticky PROTECT)
                │
                ▼
        materialize()          KEEP/PROTECT copy; COMPRESS stub; omit DROP
                │
                ▼
  CompactionResult     winning + evaluations + stats by reasonCode
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

- original / protected / kept / compressed / dropped tokens
- reduction percentage
- per-rule counts
- token **reduction** grouped by `reasonCode`

## Configuration

```ts
interface EngineConfig {
  recentItemCount: number;      // default 8
  largeOutputTokens: number;    // default 2000
  charsPerToken: number;        // default 4
  tokenEstimator?: TokenEstimator;
}
```

## Immutability

`compact()` never mutates the caller's `Transcript`. Result objects are
deep-frozen. `COMPRESS` yields a new item with stub content and a
`metadata.compression` payload.

## CLI and benchmarks

Both print original, protected, kept, compressed, dropped tokens,
reduction percent, and reduction grouped by `reasonCode`. Benchmarks
also report average `compact()` latency.
