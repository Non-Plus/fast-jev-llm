# fast-jev-compaction baseline (comparison model)

This document describes the **documented** behavior of
[fast-jev-compaction](https://github.com/tamaratran/fast-jev-compaction)
and how this repo approximates it for **shadow comparison only**.

We did **not** copy implementation code from that repository.

Labels used below:

- **observed implementation** — statements taken from the upstream
  README / plugin docs as published
- **documented behavior** — same, when the README presents it as the
  algorithm
- **our interpretation** — mapping we use in `FastJevBaselineStrategy`
  because internals are not reproduced

`FastJevBaselineStrategy` lives in `benchmarks/`, not `packages/core`.

## Integration model (observed implementation)

The upstream plugin is a **Claude Code function-hook plugin**, not a
command hook. It is documented to require
`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` and to subscribe to:

- `session.compact`
- `turn.complete`

It receives conversation state through that experimental hook API
(tool calls and results already structured), not by independently
parsing `~/.claude/projects/**.jsonl` as its primary path.

**This repo does not attach to those hooks.** Comparison runs on a
canonical `Transcript` produced by `packages/adapter-claude`.

## Algorithm (documented behavior)

From the upstream README (high level):

1. Pair `tool_use` with `tool_result`.
2. Pin the **first message** and the last `preserveRecentMessages`
   (default **6**).
3. Only **historical tool calls/results** are pruning candidates.
4. User and assistant **text is never dropped**.
5. Jev (TypeSafe System One) is asked two noul questions:
   `keepCall` and `keepResult`.
6. `keepThreshold` default **0.5**.
7. Keep result → keep the pair. Keep call only → keep the call and
   **truncate** the result (`truncateHeadChars` default **300**).
   Otherwise drop the pair.
8. Token caps documented: `maxStateTokens` 25000, `maxRequestTokens`
   30000.
9. On failure, or if reduction is below `minReductionRatio` **0.25**,
   fall back to **Claude built-in summary compaction**.

External API: Jev / TypeSafe. No other remote APIs are documented as
required.

## What it preserves / prunes (documented)

| Keep | Candidate |
| --- | --- |
| First + recent messages | Historical tool pairs |
| All user/assistant prose | Tool outputs scored below threshold |

It does **not** document a deterministic supersession pass (file-read
after write, resolved tests, duplicate git status) before calling Jev.

## How this repo approximates it

`benchmarks/src/fast-jev-baseline.ts`:

| Documented piece | Baseline handling |
| --- | --- |
| Pairing | Uses already-normalized `tool_pair` items from core |
| Pin first + last N messages | Implemented |
| Never drop user/assistant text | Implemented (`kind === "message"` always KEEP) |
| keepCall / keepResult | **Interpretation:** Semantic `KEEP` → both true; `COMPRESS` → call only + truncate; `DROP` or score `< 0.5` → drop pair |
| Threshold 0.5 / truncate 300 | Implemented when a `SemanticProvider` is supplied |
| Jev prompts / noul schema | **Unavailable** — not copied |
| `maxStateTokens` packing | **Unavailable** |
| Fallback to Claude `/compact` | **Unavailable** (would mutate or invoke Claude) |
| `minReductionRatio` | **Unavailable** |

If no provider is supplied, scoring is marked **unavailable** and
candidates are kept. The harness does not invent relevance scores.

Unsafe drops are counted against the **same protect-rule oracle** used
for our engine (user constraints, current task, unresolved errors,
system instructions). That oracle is our interpretation of “must not
lose critical context”; it is not an upstream field.

## Fairness

- Identical source transcripts.
- When both sides use a semantic provider, the same `SemanticProvider`
  instance/config is passed.
- Native transcript (strategy A) is **unmodified source**, not Claude
  native compaction.
- Observed Claude compaction (strategy E) is reported only when a
  `compact_boundary` (or equivalent) is present on the transcript.
- No winner label. `unsafeDropCount` outranks reduction percent.

## Limitations of the comparison

- Not the live plugin; not Claude native compact.
- Two-question Jev policy is collapsed onto one `SemanticProvider`
  action.
- Fallback-to-Claude-summary is not executed.
- Candidate packing/token caps are not reproduced.
- Protect-rule unsafe-drop oracle is ours, applied equally.
