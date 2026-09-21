# Cursor compatibility matrix

Observed against **Cursor 3.21.16** (macOS arm64) plus official hook
docs. Parsing is fail-open: unknown event types, unknown content parts,
and extra JSON fields are skipped or ignored.

Shadow mode is observation only. It never rewrites transcripts, never
replaces Cursor compaction, and never injects context.

Fixtures identify `observed_wire_format: "cursor-agent-transcript-jsonl-v1"`
and `cursor_version: "3.21.16"` when they represent this format.

## Local product versions observed

| Source | Version | Notes |
| --- | --- | --- |
| `cursor --version` | `3.21.16` | Installed editor CLI |
| App `package.json` | `3.21.16` | `/Applications/Cursor.app` |
| Hook docs example `cursor_version` | e.g. `1.7.2` | Docs samples; not this machine |
| Transcript files | no version field | Version supplied via `--cursor-version` or hook `cursor_version` |

## Session format

Documented pointer: hook `transcript_path` / `CURSOR_TRANSCRIPT_PATH`.

Observed on-disk layout (this machine):

```
~/.cursor/projects/<slug>/agent-transcripts/<conversation-id>/<conversation-id>.jsonl
```

Each line is a JSON object. Shapes accepted:

| Line | Handling |
| --- | --- |
| `{ "role", "message": { "content": [...] } }` | Conversation event (observed) |
| `{ "type": "turn_ended", "status", "error?" }` | Ignored (observed) |
| `{ "type": "session_meta", ... }` | Fixture / optional metadata |
| `{ "role": "tool", ... }` | Tool result (fail-open; not observed locally) |
| content part `tool_result` | Tool result (fail-open; not observed locally) |
| unknown `type` | `unknown_event`, continue |
| invalid JSON | malformed line, continue |
| extra fields | ignored |

Observed content parts: `text`, `tool_use`. Unknown part types warn and
are skipped.

### Tool-call format

Observed `tool_use`:

```json
{ "type": "tool_use", "name": "Read", "input": { "path": "src/auth.ts" } }
```

No `id` in observed files. The adapter synthesizes `tool_NNNN` when
`id` / `tool_use_id` / `call_id` are absent.

Fail-open accepted aliases: `tool_call`, `arguments`, `params`,
`tool_name`.

### Tool-result format

Not present in local agent-transcript JSONL. The adapter still accepts:

```json
{ "type": "tool_result", "tool_use_id": "…", "content": "…" }
```

and `role: "tool"` messages. Missing results become
`unpaired_tool_call` and must not crash analysis.

Unpaired calls mean large-output compression often cannot run (core
skips `unpaired_tool_call` for size compression). Superseding still
works from tool kind + path/command.

## Workspace handling

| Source | Used as cwd |
| --- | --- |
| `--cwd` | yes |
| fixture `session_meta.cwd` | yes |
| hook `workspace_roots[0]` | yes (optional hook) |
| project slug under `~/.cursor/projects` | **no** (ambiguous, undocumented) |

Paths are normalized relative to cwd when they stay inside the
workspace. Original vendor path is stored as `originalPath`.
`<workspace>/src/auth.ts`, `./src/auth.ts`, and `src/auth.ts` resolve
to `src/auth.ts`. Paths outside the workspace keep the original string
and set `pathOutsideRepo`.

## Model metadata

| Source | Availability |
| --- | --- |
| Hook common schema `model` / `model_id` | documented |
| Observed transcript JSONL | **not present** |
| Fixture `session_meta.model` | optional |

Shadow reports include `model` only when present.

## Hook availability and safety

Official agent hooks (Cmd+K / Agent Chat). Timeout is configured per
script in **seconds** (`timeout`, default “platform default”). Failures
are fail-open unless `failClosed: true`. Exit `2` denies.

| Hook | Payload (beyond common schema) | Can mutate? | Can block? | Transcript path? | Inject context? | Safe for passive analysis? |
| --- | --- | --- | --- | --- | --- | --- |
| `sessionStart` | `session_id`, `is_background_agent`, `composer_mode` | `env` for later hooks | no (fire-and-forget; `continue` not enforced) | common `transcript_path` | **yes** `additional_context` | no (injection) |
| `sessionEnd` | `session_id`, `reason`, `duration_ms`, `is_background_agent`, `final_status`, `error_message` | no (output unused) | no (fire-and-forget) | common `transcript_path` (may be null) | no | **yes** — only optional hook we ship |
| `preToolUse` | `tool_name`, `tool_input`, `tool_use_id`, `cwd` | **yes** `updated_input` | **yes** `permission: deny` / exit 2 | yes | deny messages to user/agent | no |
| `postToolUse` | `tool_output` (JSON string), `duration` | MCP output replace | no | yes | **yes** `additional_context` | no |
| `postToolUseFailure` | `error_message`, `failure_type`, `duration`, `is_interrupt` | no | no | yes | no | theoretically observe-only; not used (per-tool, timeout-sensitive) |
| `beforeShellExecution` / `beforeMCPExecution` | command / MCP input | no | **yes** permission allow/deny/ask | yes | no | no |
| `afterShellExecution` / `afterMCPExecution` | output | limited | no | yes | possible additional context on some after-hooks | no |
| `beforeReadFile` | file path | no | **yes** permission | yes | no | no |
| `afterFileEdit` | file + diff | formatters / post process | no | yes | no | no |
| `beforeSubmitPrompt` | prompt | can validate / block | **yes** | yes | possible | no |
| `preCompact` | `trigger`, usage tokens, message counts | `user_message` display only | **no** (cannot modify compaction) | yes | no | observational only; **cannot replace context**; not used |
| `stop` | `status`, `loop_count` | **yes** `followup_message` | no | yes | injects a user message | no |
| `subagentStart` / `subagentStop` | subagent metadata; `agent_transcript_path` on stop | start can deny | start **yes** | subagent path | stop follow-up | no |
| `afterAgentResponse` / `afterAgentThought` | response / thinking text | no (docs: tracking) | no | yes | no | possible observe-only; not used (fires every turn; timeout risk) |
| Tab / `workspaceOpen` | file or workspace roots | plugin paths | Tab read can deny | no session transcript | plugin load | no |

**Timeout:** expensive analysis must not run synchronously inside a hook
with a short timeout. The optional `sessionEnd` hook always spawns
detached analysis and exits 0.

`preCompact` must not be treated as a compaction API. Docs state it
cannot block or modify compaction.

Cloud agents do not run `sessionStart` / `sessionEnd`. User-level
`~/.cursor/hooks.json` is not available to cloud agents.

## Plugin format

Documented: hooks can be installed through plugins from Customize;
`hooks.json` `version: 1`. Third-party Claude Code settings can map
onto Cursor hook names.

Observed locally: `~/.cursor/plugins/{cache,local}` and VS Code-style
`~/.cursor/extensions`. This repo does **not** ship or auto-install a
Cursor plugin.

## Known limitations

- Observed transcripts omit tool results → many `unpaired_tool_call` items.
- No timestamps / model / Cursor version inside observed JSONL.
- `Glob` canonical path is the directory inferred from `glob_pattern`
  (`src/**` → `src`), matching Codex `ls src`.
- `Grep` is `command`, not a new `ToolKind`.
- Do not reconstruct missing `transcript_path`.
- Do not read Application Support databases.
- Future Cursor fields must fail open.

## Fixtures

| Fixture | Format / version |
| --- | --- |
| `packages/adapter-cursor/fixtures/observed-transcript.jsonl` | observed 3.21.16, no ids/results |
| `packages/adapter-cursor/fixtures/conformance/*.jsonl` | paired Cursor + Codex operations |
| `packages/adapter-cursor/fixtures/cross-agent/auth.*.jsonl` | conceptual auth session, both vendors |
| `cursor_version` on Cursor fixtures | `3.21.16` |
| Codex comparison fixtures | `codex-rollout-jsonl-v1` / CLI 0.151.0 envelope |
