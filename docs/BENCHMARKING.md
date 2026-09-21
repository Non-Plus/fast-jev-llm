# Benchmarking

Shadow benchmarks compare strategies on **identical source
transcripts**. They never modify Claude, Codex, or Cursor context.

## Strategies

| Id | Meaning |
| --- | --- |
| A `native-transcript` | Unmodified source context |
| B `deterministic` | Core engine, `semanticMode=off` |
| C `deterministic-semantic` | Core engine plus optional `SemanticProvider` |
| D `fast-jev-style-baseline` | Documented Fast-Jev algorithm approximation (`benchmarks/`) |
| E `observed-claude-compaction` | Only if a compact boundary is safely observed; **not** the same as A |

Do not call A–D “Claude native compaction.”

## Metrics

For each strategy:

- effective tokens, reduction %
- protected user constraints retained
- current task retained
- unresolved errors retained
- historical tool tokens retained
- tool outputs removed / compressed
- **unsafeDropCount** (primary)
- semantic calls / candidates / external tokens sent
- latency where measurable

A 90% reduction with a lost user requirement is worse than a 60%
reduction with `unsafeDropCount = 0`.

## semanticCandidateReduction

Central architectural metric:

```
raw historical tool candidates (Fast-Jev-style candidate set)
        vs
tokens still needing semantic classification after deterministic protect/prune
```

Also reported: semantic calls avoided and external tokens avoided
versus the baseline, when the baseline actually invoked a provider.

## Commands

```bash
pnpm bench:claude          # 10MB / 50MB parser benches vs Codex/Cursor
pnpm bench:compare         # fixture + real Claude (if a safe-size session exists)
pnpm --filter @fast-jev/benchmarks test
```

`--small` on `bench:claude` runs a 1MB smoke size.

## Adversarial cases

`benchmarks/fixtures/adversarial/all-cases.claude.jsonl` includes:

- critical user constraint early in the session
- old unresolved error
- old error later resolved
- file read before and after write
- large irrelevant build success
- large relevant build failure
- exploratory search later abandoned
- architecture decision made early
- assistant speculation later disproved
- plugin/system dump
- secret-like `.env` content

Every strategy prints `unsafeDropCount`.

## Fairness rules

- Same transcripts.
- Same provider/model configuration when both use Jev / mocks.
- Deterministic processing is reported with its latency; it is not
  “free quality.”
- Missing vendor data (for example Cursor transcripts without tool
  results) is called out as **data completeness**, not hidden.

## Three-agent table

When real sessions exist:

```
Agent     Original   Effective   Reduction   Data completeness
Codex     …          …           …           full tool results
Cursor    …          …           …           tool calls only
Claude    …          …           …           full tool results
```

Do not compare reduction percentages without that column.
