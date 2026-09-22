# Benchmarks

Observed reduction varies substantially by agent, transcript format, and
session workload. This document does **not** claim a single headline
percentage such as an unconditional “84.9% reduction.”

Shadow estimates are not live savings. The agent’s context is unchanged.

## What was measured

| Kind | Notes |
| --- | --- |
| Synthetic fixtures | Checked-in JSONL under `packages/adapter-*/fixtures` |
| Real local sessions | Optional, never committed; size-capped |
| Data completeness | `full_tool_results` vs `tool_calls_only` vs `partial` |
| Baseline approximation | `benchmarks/` Fast-Jev-style strategy, not upstream source |

## Completeness

Cursor’s observed transcript format may omit tool results. That
materially affects comparison with Codex and Claude. Aggregate stats
print completeness histograms for this reason.

## How to run (developers)

```bash
pnpm bench:compare
pnpm bench:codex
pnpm bench:cursor
pnpm bench:claude
```

See [BENCHMARKING.md](BENCHMARKING.md) for metrics (`unsafeDropCount` is
primary) and fairness rules.

Do not publish real transcript contents.
