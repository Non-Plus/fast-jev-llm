# Codex compatibility matrix

This document records **observed** Codex wire formats this adapter has
been tested against. Parsing is fail-open: unknown envelope types,
unknown `response_item` payload types, and extra JSON fields are skipped
or ignored. The adapter is **not** coupled to one exact Codex version.

Shadow mode is observation only. It never rewrites transcripts, never
replaces Codex compaction, and never injects context.

Shadow reports remain **local**. There is no telemetry.

## Local product versions observed

| Source | Version | Notes |
| --- | --- | --- |
| `codex --version` | `codex-cli 0.151.0` | Installed CLI used for Task 3/4 |
| `session_meta.cli_version` | `0.151.0` | Typical CLI rollout |
| `session_meta.cli_version` | `0.154.0-alpha.6.2`, `0.155.0-alpha.9.2` | Desktop / app-server rollouts seen on the same machine |

Treat `codex --version` as the local product version. Treat
`session_meta.cli_version` as the emitter of that particular JSONL file.

## JSONL envelope

Observed rollout files:

`~/.codex/sessions/YYYY/MM/DD/rollout-<timestamp>-<session-id>.jsonl`

Each line is a JSON object. The shape we accept:

```json
{ "timestamp": "ISO-8601", "type": "<envelope>", "payload": { } }
```

Unknown top-level fields are ignored. A line that is not a JSON object
is counted as malformed and skipped.

### Envelope types

| `type` | Handling |
| --- | --- |
| `session_meta` | Session id, cwd, model, `cli_version`, originator |
| `turn_context` | cwd / model updates |
| `response_item` | Messages and tool calls (see payload `type`) |
| `event_msg` | Ignored |
| `token_usage_record` | Ignored |
| `world_state` | Ignored |
| anything else | Recorded as `unknown_event`, parse continues |

## `response_item` payload types

| `payload.type` | Handling |
| --- | --- |
| `message` | Canonical `ContextMessage`. Codex `developer` → role `system` + origin `developer`. `user` / `assistant` / `system` mapped directly. Origin is recorded separately from role. |
| `function_call` | Assistant tool call; `arguments` is JSON or a command string |
| `function_call_output` | Tool result |
| `custom_tool_call` | JS-wrapped `tools.exec_command({cmd})` (and similar) unwrapped into a command |
| `custom_tool_call_output` | Tool result; `output` may be a string or content-part array |
| `reasoning` | Ignored |
| `compaction` | Ignored (shadow mode does not consume Codex compaction) |
| anything else | `unknown_event`, parse continues |

Tool outputs may include `is_error` / `isError`, `exit_code` / `exitCode`,
or `status: "failed"`. Missing fields fail open (tool is not assumed to
have failed).

## `session_meta` fields used

| Field | Use |
| --- | --- |
| `id` / `session_id` | Canonical session id |
| `timestamp` | Report metadata |
| `cwd` | Path normalization only |
| `cli_version` | Report / compatibility metadata |
| `originator` | Report metadata |
| `model` | Report metadata |
| extra fields | Ignored |

Fixtures set `observed_wire_format: "codex-rollout-jsonl-v1"` on
`session_meta` so testers can see which wire format a file represents.
The parser does not require that field.

## `transcript_path`

Documented SessionEnd stdin includes `transcript_path: string | null`.
Official docs call this a convenience pointer, **not** a stable
interface. The on-disk JSONL shape may change. Shadow mode reads the
file if the path is present and skips analysis if it is missing.
It never writes to that path.

## Hooks

Observed locally (`codex features list` on 0.151.0):

| Feature | Status |
| --- | --- |
| `hooks` | stable, enabled |
| `plugin_hooks` | removed |

Documented events we **do not** attach in shadow mode (they can steer
Codex): `PreToolUse`, `PostToolUse`, `PreCompact`, `PostCompact`,
`SessionStart`.

Optional attach point only: **SessionEnd** (advisory, cannot keep the
thread open, default timeout 1s). See [CODEX_INTEGRATION.md](./CODEX_INTEGRATION.md).

## Fixtures and the format they represent

All JSONL fixtures under `packages/adapter-codex/fixtures/` are
`codex-rollout-jsonl-v1` envelopes with `cli_version` `0.151.0` unless
noted.

| Fixture | What it covers |
| --- | --- |
| `normal-session.jsonl` | `session_meta`, `turn_context`, `message` (developer+user+assistant), `custom_tool_call`, `custom_tool_call_output`, `function_call`, `function_call_output` |
| `multiple-turns.jsonl` | Two user turns |
| `long-tool-output.jsonl` | Large `function_call_output` |
| `interrupted-tool-call.jsonl` | `custom_tool_call` without output |
| `missing-tool-result.jsonl` | Call without matching output, plus a later result |
| `unpaired-tool-result.jsonl` | Output without a matching call |
| `unknown-event.jsonl` | Unknown envelope + unknown `response_item` type |
| `malformed-line.jsonl` | Non-JSON lines |
| `huge-build-failure.jsonl` | Recent huge `npm run build` failure + user constraint |
| `huge-build-success.jsonl` | Recent huge successful build |
| `huge-test-suite.jsonl` | Large test runner output |
| `large-git-diff.jsonl` | Multi-file `git diff` |
| `large-directory-tree.jsonl` | `find .` including `node_modules` / `dist` / `.git` |
| `duplicate-generic-command.jsonl` | Same `pwd` twice, equivalent normalized output |
| `same-command-different-output.jsonl` | Same `echo` twice, different output |
| `developer-plugin-content.jsonl` | Developer instruction vs plugin dump |
| `explicit-user-constraints.jsonl` | Standing user constraints |
| `recent-huge-tool-result.jsonl` | Recent huge `Read` / lockfile dump |
| `old-superseded-tool-result.jsonl` | Older `git status` superseded by a later one |

## Fail-open contract

- Unknown events never abort parsing.
- Unknown fields never abort parsing.
- Missing tool results become `unpaired_tool_call`.
- Orphan outputs become `unpaired_tool_result`.
- The original JSONL is never mutated.
