# Fast Jev context engine

Provider-independent context management for AI coding agents.

This repository currently implements **Task 1**: the canonical core
(deterministic pruning, protected context, compaction, statistics).
Codex/Cursor adapters, archival, project memory, and LLM providers are
intentionally not implemented yet.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for types, data flow,
and the simplifications applied before implementation.

## Requirements

- Node.js 22+
- pnpm

## Commands

```bash
pnpm install
pnpm test
pnpm compact
pnpm bench
```

`pnpm compact` runs the engine against `fixtures/coding-session.ts` and
prints compaction statistics.
