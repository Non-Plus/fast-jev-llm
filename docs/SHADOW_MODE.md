# Shadow mode

Shadow mode runs the provider-independent context engine **against a
canonical copy** of a real Codex session and reports what the engine
*would* protect, keep, compress, and drop.

It does not change Codex.

> Analyzes what Context Engine would remove without modifying the
> Codex session.

## What it does

```
Codex JSONL
    → adapter-codex parser (streamed)
    → canonical Transcript  (@fast-jev/core types only)
    → core.compact()
    → ShadowAnalysisResult
```

`packages/core` never imports Codex types.

`analyzeCodexSession()` never writes to the source transcript. The
parser does not mutate in-memory event objects.

## CLI

```bash
ctx codex analyze ~/.codex/sessions/2026/09/21/rollout-….jsonl
ctx codex analyze session.jsonl --json
ctx codex analyze session.jsonl --save --save-dir .context-engine/shadow
ctx codex explain session.jsonl --preview-length 160
ctx codex analyze session.jsonl --json --no-previews
ctx codex analyze session.jsonl --semantic-mode remote --semantic-provider jev
```

Human output always ends with:

```
Shadow mode only. No Codex context was modified.
```

`--json` prints a machine-readable document:

- `metadata` (session id, source `codex`, mode `shadow`, timestamp, model, cwd)
- `statistics`
- `decisions` (winning decision per item)
- `decisionTrace` (every rule evaluation)
- `relationships`

This is the contract later benchmarks and UIs should consume. No adapter
change is required to add those later.

`explain` prints one block per item:

- Action, Importance, Retention, Compression
- Reason code, original / retained / saved tokens
- Relationships and a short narrative when protection and compression interact

Content previews are truncated (`--preview-length`, default 200
characters) and omitted entirely with `--no-previews`. Huge tool output
is never dumped to the terminal. Shadow reports remain local.

## Report storage

`--save` writes **only the report**:

```
.context-engine/shadow/<session-id>.json
```

That directory is gitignored. The original rollout JSONL is never
copied there.

## Privacy

Shadow analysis runs locally on the calling machine.

`EngineConfig.reportPreviews` (default `true`) and `previewMaxChars`
(default `200`) control whether short local previews are stored. When
previews are disabled, report JSON contains no source-content previews.

It does not transmit anything by default.

Remote semantic classification is opt-in (`--semantic-mode remote`) and
sends only a packed, redacted candidate set. See
[PRIVACY.md](./PRIVACY.md) and [SEMANTIC_LAYER.md](./SEMANTIC_LAYER.md).

There is no telemetry or analytics. The adapter, CLI, and SessionEnd
hook do not open sockets unless remote semantic mode is explicitly
enabled.

## Optional Codex hook

If you want analysis after a session ends, the documented **SessionEnd**
hook is the only safe attachment point: it is advisory, provides
`transcript_path`, and cannot steer Codex. See
[CODEX_INTEGRATION.md](./CODEX_INTEGRATION.md).

Do not attach this engine to `PreCompact` / `PostCompact` in shadow
mode. Those hooks can stop Codex when they return `continue: false`.

See [CODEX_COMPATIBILITY.md](./CODEX_COMPATIBILITY.md) for the tested
wire-format matrix.

## What is not implemented

- active Codex compaction or context replacement
- message injection
- Ollama / MLX / local LLM providers
- embeddings / vector databases
- project memory / full archival
- Cursor adapter, UI, server, daemon, cloud telemetry
