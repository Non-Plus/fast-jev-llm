# Shadow mode

Shadow mode runs the provider-independent context engine **against a
canonical copy** of a real agent session and reports what the engine
*would* protect, keep, compress, and drop.

It does not change Codex, Cursor, or Claude Code.

> Analyzes what Context Engine would remove without modifying the
> session.

## What it does

```
Codex JSONL   ─┐
Cursor JSONL  ─┼─► vendor adapter (streamed)
Claude JSONL  ─┘     → canonical Transcript  (@fast-jev/core types only)
                    → core.compact()
                    → ShadowAnalysisResult
```

`packages/core` never imports Codex, Cursor, or Claude types.

`analyzeCodexSession()` / `analyzeCursorSession()` /
`analyzeClaudeSession()` never write to the source transcript. Parsers
do not mutate in-memory event objects.

Product commands (`ctx setup`, `ctx status`, `ctx stats`, …) are
documented in [SETUP.md](SETUP.md) and [DOGFOODING.md](DOGFOODING.md).
They still do not modify agent context.

## CLI

Codex:

```bash
ctx codex analyze ~/.codex/sessions/2026/09/21/rollout-….jsonl
ctx codex analyze session.jsonl --json
ctx codex analyze session.jsonl --save --save-dir .context-engine/shadow
ctx codex explain session.jsonl --preview-length 160
ctx codex analyze session.jsonl --json --no-previews
ctx codex analyze session.jsonl --semantic-mode remote --semantic-provider jev
```

Cursor:

```bash
ctx cursor analyze ~/.cursor/projects/<slug>/agent-transcripts/<id>/<id>.jsonl
ctx cursor analyze session.jsonl --json --cwd /path/to/workspace
ctx cursor analyze session.jsonl --save
ctx cursor explain session.jsonl --no-report-previews
ctx cursor analyze session.jsonl --semantic-mode remote --semantic-provider jev
```

Claude Code:

```bash
ctx claude analyze ~/.claude/projects/<slug>/<session>.jsonl
ctx claude analyze session.jsonl --json --cwd /path/to/workspace
ctx claude analyze session.jsonl --save
ctx claude explain session.jsonl --no-report-previews
ctx claude analyze session.jsonl --semantic-mode remote --semantic-provider jev
```

Default `--semantic-mode off` for all three. All are shadow analysis.

Human Codex output ends with:

```
Shadow mode only. No Codex context was modified.
```

Human Cursor output ends with:

```
Shadow mode only.
No Cursor context was modified.
```

Human Claude output ends with:

```
Shadow mode only.
No Claude context was modified.
```

`--json` prints a machine-readable document:

- `metadata` (session id, source `codex` / `cursor` / `claude`, mode `shadow`, timestamp, model, cwd, vendor version when known)
- `statistics` (including `effectiveTokens` for Cursor)
- `decisions` (winning decision per item)
- `decisionTrace` (every rule evaluation)
- `relationships`

`explain` prints one block per item. Content previews are truncated
(`--preview-length`, default 200) and omitted with `--no-previews` /
`--no-report-previews`.

## Report storage

`--save` writes **only the report**:

```
.context-engine/shadow/<session-id>.json
```

That directory is gitignored. Source transcripts are never copied there.

## Privacy

Shadow analysis runs locally on the calling machine.

Remote semantic classification is opt-in (`--semantic-mode remote`) and
sends only a packed, redacted candidate set. See
[PRIVACY.md](./PRIVACY.md) and [SEMANTIC_LAYER.md](./SEMANTIC_LAYER.md).

There is no telemetry. Adapters, CLI, and optional session-end hooks
do not open sockets unless remote semantic mode is explicitly enabled.

## Optional hooks

**Codex:** documented `SessionEnd` only. See
[CODEX_INTEGRATION.md](./CODEX_INTEGRATION.md).

**Cursor:** documented `sessionEnd` only. Fire-and-forget, detached
analysis, never auto-installed. See
[CURSOR_INTEGRATION.md](./CURSOR_INTEGRATION.md).

**Claude Code:** documented `SessionEnd` only. Fire-and-forget,
detached analysis, never auto-installed. **Do not use `PreCompact`**
(it can block compaction). See
[CLAUDE_INTEGRATION.md](./CLAUDE_INTEGRATION.md).

Do not attach this engine to Codex `PreCompact` / Cursor `preCompact` /
Claude `PreCompact` as a compaction replacement. Cursor `preCompact`
cannot modify compaction. Codex and Claude pre-compact hooks can block
the product.

## What is not implemented

- active Codex, Cursor, or Claude compaction or context replacement
- message injection or tool blocking
- Ollama / MLX / local LLM providers
- embeddings / vector databases
- project memory / full archival
- UI, server, daemon, cloud telemetry
