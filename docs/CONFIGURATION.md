# Configuration

Local product state lives under `~/.context-engine/` unless
`CONTEXT_ENGINE_HOME` is set (tests use that override).

```
~/.context-engine/
  config.json
  reports/
    codex/
    cursor/
    claude/
  backups/
```

## `config.json`

```json
{
  "schemaVersion": 1,
  "enabledAgents": ["codex", "cursor", "claude"],
  "semanticMode": "off",
  "semanticProvider": null,
  "reportPreviews": false,
  "previewMaxChars": 200,
  "retentionDays": null,
  "engineBudgets": {
    "recentItemCount": 8,
    "largeOutputTokens": 2000
  },
  "hookCommand": "ctx",
  "updatedAt": "2026-09-21T00:00:00.000Z"
}
```

| Field | Meaning |
| --- | --- |
| `enabledAgents` | Agents chosen during `ctx setup` |
| `semanticMode` | `off` (default), `local`, or `remote` |
| `semanticProvider` | `jev` when remote is explicitly enabled; otherwise `null` |
| `reportPreviews` | Default `false`. Aggregate reports never store source, prompts, or tool dumps |
| `retentionDays` | Advisory only. Automatic deletion is **off**. Use `ctx reports prune` |
| `engineBudgets` | Passed into shadow `compact()` |
| `hookCommand` | Command prefix written into agent hook files |

Secrets are never stored here. Jev uses `TYPESAFE_API_KEY` or `JEV_API_KEY`.

## Report files

Each report is JSON, `schemaVersion: 1`. Identity is
`agent + session ID + engine version + semantic mode`, so SessionEnd
firing twice overwrites the same file instead of duplicating it.

A newer engine version writes a **distinct** file so dogfooding data
can be compared after rule changes.

Fields include token counts, reason-code totals, `unsafeDropCount`,
`dataCompleteness`, semantic usage metadata, and version stamps
(`engineVersion`, `coreVersion`, `adapterVersion`, `rulesetVersion`,
`semanticPolicyVersion`). Transcripts are not copied into the store.

`dataCompleteness` is one of:

- `full_tool_results`
- `tool_calls_only`
- `partial`
- `unknown`

Cursor sessions are often `tool_calls_only`. Do not treat their
reduction % as equivalent to Codex or Claude.

Unsupported or corrupted report files are skipped by `ctx stats`.

## Retention

Default: no automatic deletion.

```bash
ctx reports prune --older-than 30d
ctx reports clear --yes
```

`ctx reports clear` requires `--yes`.

## Environment

| Variable | Purpose |
| --- | --- |
| `HOME` | Locates `~/.codex`, `~/.cursor`, `~/.claude` |
| `CONTEXT_ENGINE_HOME` | Override for `~/.context-engine` |
| `CONTEXT_ENGINE_HOOK_SYNC=1` | Run hook analysis in-process (tests) |
| `CONTEXT_ENGINE_DEBUG=1` | Write hook failures to stderr |
| `TYPESAFE_API_KEY` / `JEV_API_KEY` | Jev credentials; never logged |
