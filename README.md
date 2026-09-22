# fast-jev-llm

**Context optimization for Claude Code, Codex, and Cursor.**

Shadow Mode only. The engine analyzes what context could be protected,
kept, compressed, or dropped **without modifying** the coding agent’s
real context.

Independent open-source project. Not affiliated with Anthropic, OpenAI,
Cursor, TypeSafe, or [fast-jev-compaction](https://github.com/tamaratran/fast-jev-compaction).

[Install](#install) · [Quick start](#quick-start) · [Remote Jev](#optional-remote-jev-typesafe) · [Safety](docs/SAFETY.md) · [Privacy](docs/PRIVACY.md) · [Setup](docs/SETUP.md) · [Config](docs/CONFIGURATION.md)

## What is this?

Long coding-agent sessions accumulate stale file reads, superseded test
failures, old git snapshots, directory listings, huge build output, and
historical debugging dumps.

fast-jev-llm separates context items into:

| Decision | Meaning |
| --- | --- |
| **PROTECT** | Must remain (constraints, current task, unresolved errors, …) |
| **KEEP** | Remain as-is |
| **COMPRESS** | Keep a shorter form |
| **DROP** | The engine *believes* this item could be removed |

**DROP is an estimate.** It does **not** mean the agent actually removed
it. This release does not enable active compaction.

```
Coding Agent
     ↓
Transcript
     ↓
Adapter
     ↓
Context Engine
     ↓
Protect / Keep / Compress / Drop
     ↓
Local Shadow Report
```

## Supported agents

| Agent | Support | Transcript data |
| --- | --- | --- |
| Codex | Shadow | full tool results |
| Cursor | Shadow | tool calls only* |
| Claude Code | Shadow | full tool results |

\*Based on currently observed Cursor transcript format. Tested with
Codex CLI 0.151, Cursor 3.21, Claude Code 2.1. Later versions are not
guaranteed compatible.

Jev is an **optional** semantic relevance provider, not a required
dependency. Deterministic analysis is the default (`semanticMode=off`).

## Install

Node.js 22 or newer.

```bash
npm install -g fast-jev-llm
ctx setup
```

or:

```bash
npx fast-jev-llm setup
```

## Quick start

```bash
ctx setup

# use Codex, Cursor, and Claude Code normally

ctx stats
```

Example (`ctx stats`):

```
Context Engine — Local Shadow Statistics

Period                 All time
Sessions               42

Tokens observed        8.42M
Effective context      4.11M
Potential reduction    51.2%

Data completeness
────────────────────────
full_tool_results      30
tool_calls_only        12
```

Observed reduction varies substantially by agent, transcript format, and
session workload. Do not compare Cursor `tool_calls_only` sessions with
Codex/Claude as if the inputs were equivalent.

Other commands: `ctx status`, `ctx doctor`, `ctx sessions`,
`ctx session <id>`, `ctx --help`, `ctx --version`.

## Optional: remote Jev (TypeSafe)

**Default is local shadow analysis only** (`semanticMode=off`). Nothing is
sent to Jev unless you opt in.

To enable remote semantic classification for hooks and CLI analysis:

1. **API key in the environment** (never commit; not stored in
   `~/.context-engine/config.json`):

   ```bash
   export TYPESAFE_API_KEY="your-key"   # or JEV_API_KEY
   ```

   Optional: `JEV_BASE_URL`, `JEV_MODEL`, `JEV_TIMEOUT_MS` (see
   [docs/CONFIGURATION.md](docs/CONFIGURATION.md)).

2. **Enable remote mode in setup** (requires explicit confirmation):

   ```bash
   ctx setup --yes --semantic-mode remote --confirm-remote
   ```

3. **Verify**:

   ```bash
   ctx doctor    # shows semantic mode and whether Jev credentials are present
   ctx status
   ```

One-off CLI analysis with Jev (does not change saved config):

```bash
ctx codex analyze /path/to/session.jsonl --semantic-mode remote --semantic-provider jev
```

Remote mode sends **packed candidate summaries** to TypeSafe Jev, not full
transcripts. Eligibility rules and redaction apply first; see
[docs/PRIVACY.md](docs/PRIVACY.md). Full setup steps:
[docs/SETUP.md](docs/SETUP.md).

## Why this exists

Agents keep tool history that is often superseded. The engine is a
**local, inspectable** way to measure that. It does not claim to
automatically improve coding quality.

## Architecture

```
                Core
                 │
       ┌─────────┼─────────┐
       │         │         │
     Codex     Cursor    Claude
       │         │         │
       └─────────┼─────────┘
                 │
        Canonical Context
                 │
        Deterministic Engine
                 │
        Optional Semantic
                 │
              Reports
```

Adapters normalize vendor transcripts into a provider-independent
representation. The core never imports Codex, Cursor, or Claude types.

V0.1 is **CLI-first**. Internal `@fast-jev/*` packages are not a
supported public library API.

## Privacy

Default:

- local analysis
- no telemetry, analytics, crash reporter, or upload
- no raw transcript copies in the report store
- no cloud account

Remote semantic mode is **opt-in**; configure with
[Optional: remote Jev](#optional-remote-jev-typesafe). The sensitive-content
gate is best-effort, not a full secret scanner. See [docs/PRIVACY.md](docs/PRIVACY.md).

## Prior art / inspiration

This project was inspired in part by
[fast-jev-compaction](https://github.com/tamaratran/fast-jev-compaction).

| | fast-jev-compaction | fast-jev-llm |
| --- | --- | --- |
| Focus | Claude-oriented Jev-guided pruning | Provider-independent deterministic analysis |
| Agents | Claude-oriented | Codex, Cursor, Claude Code |
| Default | Jev-backed compaction library/plugin | Shadow analysis, semantic mode off |
| This release | Active compaction in that project | **Observation only** |

fast-jev-llm is not a fork, successor, or official companion of
fast-jev-compaction.

Benchmark details: [docs/BENCHMARKS.md](docs/BENCHMARKS.md). This README
does not claim superiority.

## Versioning

The public npm package starts at **0.1.0**. 0.x means the CLI, config, and
report schema may still evolve. The report schema is versioned independently
(`schemaVersion` in each local report).

V0.1 is **CLI-only**. Internal `@fast-jev/*` packages are private.

See [docs/VERSIONING.md](docs/VERSIONING.md).

## License

MIT. See [LICENSE](LICENSE) and [docs/THIRD_PARTY_NOTICES.md](docs/THIRD_PARTY_NOTICES.md).

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Success (`--help` / `--version` included) |
| 1 | Operational failure |
| 2 | Invalid usage |

SessionEnd hooks always exit 0 (fail open). `--debug` logs extra
diagnostics and never prints credential values.

macOS and Linux are tested. Windows is not claimed.
