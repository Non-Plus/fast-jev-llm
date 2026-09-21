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
- Every item receives a decision: `PROTECT` | `KEEP` | `COMPRESS` | `DROP`
- Every decision records `action`, `reason`, `itemId`, and `rule`
- Deterministic pruning plus a protected-context veto
- A compaction pipeline that can later call a `SemanticProvider` without
  changing its shape
- Approximate token counts and compaction statistics

## Non-goals (this slice)

- Codex or Cursor adapters
- LLM calls, embeddings, or Jev
- HTTP servers, UI, or databases
- Local archival and project memory
- Streaming / incremental session mutation APIs

## Package layout

```
packages/core         Canonical types + compaction engine
packages/providers    Future SemanticProvider implementations (stub only)
cli                   Compact a JSON transcript and print statistics
benchmarks            Timing harness over the fixture transcript
fixtures              Shared example sessions
```

`packages/providers` exists so Jev / OpenAI / Anthropic / local models
can be added later without moving the pipeline. It currently exports a
no-op provider.

## Canonical model

The engine does not speak "OpenAI messages" or "Cursor turns". Adapters
(later) will map vendor payloads into these types.

```
Transcript
  └── ContextMessage[]          original, treated as frozen
        ├── ToolCall[]          optional, on assistant messages
        └── toolCallId          on tool-result messages

ContextItem                     derived work unit (new objects)
  ├── message                   user / assistant / system text
  ├── tool_pair                 matched ToolCall + ToolResult
  ├── unpaired_tool_call
  └── unpaired_tool_result

ContextDecision                 one winning decision per item
SessionState                    derived snapshot of items + token totals
PruningRule                     pure function over items
SemanticProvider                optional port (classify / compress)
CompactionResult                decisions + compacted items + stats
```

### Why `ContextItem` is separate from `ContextMessage`

Pruning wants a **tool-call/result pair** as a single unit ("this file
read of `src/index.ts`"). Vendor transcripts split that across two
messages. Normalization produces `ContextItem`s; the original messages
stay untouched and are referenced by `messageIds`.

### Tool kinds

During normalization, each tool pair is classified heuristically from
tool name + arguments (no LLM):

| `ToolKind`         | Examples                                      |
|--------------------|-----------------------------------------------|
| `file_read`        | Read, cat, get_file_contents                  |
| `file_write`       | Write, apply_patch (not pruned in this slice) |
| `git_status`       | `git status`                                  |
| `git_diff`         | `git diff`                                    |
| `directory_list`   | ls, Glob, list_dir                            |
| `test_run`         | vitest, jest, pytest, `npm test`              |
| `command`          | generic shell                                 |
| `other`            | everything else                               |

Classification is conservative: unknown tools become `other`/`command`
and are only affected by the repeated-command rule.

## Data flow

```
Transcript (frozen)
        │
        ▼
  normalize()          pair tools, classify kind, estimate tokens
        │
        ▼
  SessionState         immutable ContextItem[]
        │
        ├─► protect rules      may only emit PROTECT
        ├─► prune rules        may emit DROP or COMPRESS
        └─► SemanticProvider   optional; cannot override PROTECT
                │
                ▼
        merge decisions        PROTECT > DROP > COMPRESS > KEEP
                │
                ▼
        materialize()          copy KEEP/PROTECT; stub COMPRESS; omit DROP
                │
                ▼
  CompactionResult     compacted items + audit decisions + stats
```

The pipeline is a single async function:

```ts
compact(transcript: Transcript, options?: CompactOptions): Promise<CompactionResult>
```

It is async only so a future `SemanticProvider` can be awaited. The
current path is synchronous work inside that function.

## Decision merge

1. Every item starts as `KEEP` (`rule: "default"`).
2. Protect rules run first. `PROTECT` is sticky.
3. Prune rules run next. They may not change a `PROTECT` item.
4. If several prune rules fire, the **stronger** action wins:
   `DROP` > `COMPRESS` > `KEEP`.
5. An optional semantic provider may emit decisions for non-protected
   items. Same merge order. It cannot un-protect or revive a `DROP`
   unless we later add an explicit override policy (we will not).
6. Exactly one **winning** decision per item is returned. Rules that
   lose the merge are not included; this keeps the result small and
   makes `rule` unambiguously "the rule responsible".

## Deterministic prune rules

Each rule is a pure function:

```ts
(items: readonly ContextItem[], config: EngineConfig) => ContextDecision[]
```

Rules inspect the full list and emit decisions for **older** items,
keeping the latest representative.

| Rule                         | What it drops                                      |
|------------------------------|----------------------------------------------------|
| `superseded-file-read`       | Earlier reads of the same path                     |
| `superseded-git-status`      | Earlier `git status` outputs                       |
| `superseded-git-diff`        | Earlier `git diff` outputs                         |
| `old-directory-listing`      | Earlier listings of the same directory/glob        |
| `superseded-test-run`        | Earlier runs of the same test target               |
| `successful-test-supersedes-failures` | Failed runs of a target once a later run passed |
| `repeated-command-output`    | Earlier runs of the same command string            |
| `compress-large-output`      | Latest tool output still over a token threshold → `COMPRESS` |

`compress-large-output` is the only rule that emits `COMPRESS` in this
slice. Compression itself is deterministic truncation (head + tail +
byte/token metadata), not a model summary.

## Protected-context rules

Protect rules only emit `PROTECT`. They are the veto against pruning.

| Rule                      | What it protects                                      |
|---------------------------|-------------------------------------------------------|
| `system-instructions`     | `system` messages (standing instructions)             |
| `explicit-user-constraint`| User text that states constraints, or `metadata.constraint` |
| `recent-items`            | The last *N* items (default 8)                        |
| `unresolved-error`        | Latest error/failing test that has not been followed by success for that target |
| `current-task`            | The most recent substantive user message              |

`recent-items` uses item order, not wall clock. Transcripts may not have
timestamps.

## Token estimation

Approximate, deterministic, no tokenizer dependency:

```
tokens ≈ ceil(characterLength / charsPerToken)
```

Default `charsPerToken = 4`. Good enough for budget math and statistics;
not a billing figure. A later adapter may inject a real tokenizer
through the same `estimateTokens(text, config)` function.

## Semantic provider port

```ts
interface SemanticProvider {
  readonly name: string;
  classify?(
    items: readonly ContextItem[],
    session: SessionState,
  ): Promise<readonly ContextDecision[]>;
  compress?(
    item: ContextItem,
  ): Promise<string>;
}
```

The pipeline:

1. Always runs protect + prune.
2. If `options.semanticProvider` is set, calls `classify` on
   non-protected items and merges.
3. For `COMPRESS` items, uses `provider.compress` when present,
   otherwise the deterministic stub.

No provider is required. Adding Jev later is a new class in
`packages/providers` plus passing it into `compact()`. The pipeline file
does not need to change if the port remains stable.

## Statistics

`CompactionStats` reports:

- original / compact token counts and item counts
- tokens kept, protected, compressed, dropped
- per-rule counts and tokens (based on **winning** decisions)

The original transcript is not copied into the result. Callers already
hold it.

## Configuration

Kept small on purpose:

```ts
interface EngineConfig {
  recentItemCount: number;      // default 8
  largeOutputTokens: number;    // default 2000
  charsPerToken: number;        // default 4
}
```

No plugin registry, no middleware stack, no per-rule YAML.

## Immutability

- `compact()` deep-freezes a copy of the input (or works only on
  derived objects).
- Tests assert that the caller's `Transcript` is reference-equal in
  content after compaction.
- `ContextItem`s in the result are new objects. `COMPRESS` produces a
  new item with shorter `content` and an updated `tokenCount`.

## CLI and benchmarks

- `cli` reads a JSON `Transcript`, calls `compact()`, prints stats.
- `benchmarks` runs `compact()` in a loop over the fixture (optionally
  scaled) and prints ms / tokens dropped.

Neither talks to a network.

## Design review (simplifications applied)

Before implementation, the following were cut:

| Rejected | Why |
|----------|-----|
| Plugin registry / DI container | An array of rule functions is enough |
| Separate prune/protect packages | Two modules in `core` |
| Event emitters, middleware hooks | Pipeline is five functions |
| `compactSync` plus `compact` | One async entry point |
| Immutable.js / structured clone of the whole result | Derived items + freeze |
| Real tokenizers | `chars/4` until a provider needs more |
| Archival, memory, adapters | Explicit non-goals |
| Audit log of losing rules | One winning decision per item |
| Timestamp-based recency | Item order only |
| Class hierarchy for rules | Plain functions with a `name` |

The core surface is: **types**, **normalize**, **rules**, **compact**.
Everything else is a future package behind `SemanticProvider` or an
adapter that produces a `Transcript`.
