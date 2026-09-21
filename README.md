# Fast Jev context engine

Provider-independent context management for AI coding agents.

The core engine is deterministic: it never calls a model. **Shadow
adapters** can observe real Codex, Cursor, or Claude Code sessions
and report what the engine would protect, keep, compress, and drop
**without modifying those products**.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md),
[docs/SHADOW_MODE.md](docs/SHADOW_MODE.md),
[docs/SEMANTIC_LAYER.md](docs/SEMANTIC_LAYER.md),
[docs/PRIVACY.md](docs/PRIVACY.md),
[docs/BENCHMARKING.md](docs/BENCHMARKING.md),
[docs/CODEX_INTEGRATION.md](docs/CODEX_INTEGRATION.md),
[docs/CURSOR_INTEGRATION.md](docs/CURSOR_INTEGRATION.md),
[docs/CLAUDE_INTEGRATION.md](docs/CLAUDE_INTEGRATION.md),
and [docs/FAST_JEV_BASELINE.md](docs/FAST_JEV_BASELINE.md).

## Requirements

- Node.js 22+
- pnpm

## Commands

```bash
pnpm install
pnpm test
pnpm compact
pnpm bench
pnpm bench:codex
pnpm bench:cursor
pnpm bench:claude
pnpm bench:compare
```

### Codex (shadow analysis)

```bash
pnpm ctx -- codex analyze ~/.codex/sessions/2026/09/21/rollout-….jsonl
pnpm ctx -- codex analyze session.jsonl --json
pnpm ctx -- codex explain session.jsonl
pnpm ctx -- codex analyze session.jsonl --semantic-mode remote --semantic-provider jev
```

Shadow mode **analyzes what Context Engine would remove without
modifying the Codex session.**

### Cursor (shadow analysis)

```bash
pnpm ctx -- cursor analyze ~/.cursor/projects/<slug>/agent-transcripts/<id>/<id>.jsonl
pnpm ctx -- cursor analyze session.jsonl --json --cwd /path/to/workspace
pnpm ctx -- cursor explain session.jsonl
pnpm ctx -- cursor analyze session.jsonl --semantic-mode remote --semantic-provider jev
```

Shadow mode **analyzes what Context Engine would remove without
modifying the Cursor session.**

### Claude Code (shadow analysis)

```bash
pnpm ctx -- claude analyze ~/.claude/projects/<slug>/<session>.jsonl
pnpm ctx -- claude analyze session.jsonl --json
pnpm ctx -- claude explain session.jsonl
pnpm ctx -- claude analyze session.jsonl --semantic-mode remote --semantic-provider jev
```

Shadow mode **analyzes what Context Engine would remove without
modifying the Claude session.**

Semantic classification is **off by default**. Remote providers such as
Jev run only with an explicit `--semantic-mode remote` and never send
forbidden or recognized-secret items. See [docs/PRIVACY.md](docs/PRIVACY.md).

`pnpm compact` still runs the engine against `fixtures/coding-session.ts`.

## Privacy

Shadow analysis is local. Transcripts, source, tool output, and
commands are not sent anywhere unless you explicitly enable
`semantic-mode remote`. There is no telemetry. Default semantic mode is
`off`.
