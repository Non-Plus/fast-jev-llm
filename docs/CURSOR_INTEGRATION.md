# Cursor integration (shadow mode)

This document records the Cursor installation and surfaces inspected
for Task 6, plus the only integration this repo uses.

Wire-format details live in
[CURSOR_COMPATIBILITY.md](./CURSOR_COMPATIBILITY.md).

**Shadow mode is observation only.** The adapter never modifies Cursor
context, never replaces compaction, never alters transcripts, never
injects messages, never blocks tools, never patches Cursor, and never
depends on undocumented internals.

```
Cursor session
      ↓
Cursor adapter
      ↓
Canonical Transcript
      ↓
Existing Context Engine
      ↓
Shadow analysis
```

`packages/core` stays unaware of Cursor types. Cursor-specific parsing
lives only in `packages/adapter-cursor`.

## Detected local Cursor

| Field | Value |
| --- | --- |
| App bundle | `/Applications/Cursor.app` |
| `CFBundleShortVersionString` | `3.21.16` |
| `app/package.json` version | `3.21.16` |
| CLI binary | `/usr/local/bin/cursor` → `Cursor.app/Contents/Resources/app/bin/code` |
| `cursor --version` | `3.21.16` / `8ae78e8eee1e63479c7e0504b664bc0a80c68000` / `arm64` |
| CLI personality | VS Code / `code` style (`cursor --help` is an editor CLI, not an agent session CLI) |
| User config dir | `~/.cursor/` |
| App data dir | `~/Library/Application Support/Cursor/` |
| Project dir (this repo) | `~/.cursor/projects/<workspace-slug>/` |
| Local `hooks.json` | **not present** (user or project) |

Discovery did **not** modify Cursor configuration, hooks, plugins, or
transcripts.

Do not assume Cursor behaves like Codex or Claude. Codex uses rollout
JSONL plus `SessionEnd` hooks; Cursor uses `hooks.json` v1 plus
`agent-transcripts` JSONL with a different event shape.

## Surface classification

### DOCUMENTED/STABLE

Official docs: [Hooks](https://cursor.com/docs/hooks),
[Third Party Hooks](https://cursor.com/docs/reference/third-party-hooks).

- `hooks.json` at `.cursor/hooks.json` (project) and `~/.cursor/hooks.json` (user)
- schema `version: 1`
- command hooks: JSON stdin / JSON stdout, exit `0` success, exit `2` deny, other exits fail-open
- `failClosed` default `false`
- `timeout` in **seconds**
- common hook input: `conversation_id`, `generation_id`, `model`, `model_id`, `hook_event_name`, `cursor_version`, `workspace_roots`, `user_email`, `transcript_path`
- env: `CURSOR_PROJECT_DIR`, `CURSOR_VERSION`, `CURSOR_USER_EMAIL`, `CURSOR_TRANSCRIPT_PATH`
- `sessionEnd` is fire-and-forget; response is logged and unused
- `preCompact` is observational and **cannot block or modify** compaction
- documented session transcripts via `transcript_path` / `CURSOR_TRANSCRIPT_PATH`

These are the only surfaces the adapter relies on.

### DOCUMENTED/EXPERIMENTAL

Treat as documented but unstable or easy to misuse:

- prompt-based hooks (`type: "prompt"`)
- `failClosed: true` (blocks tools / reads on hook failure)
- `preToolUse.updated_input` (mutates tool input)
- `postToolUse.additional_context` / MCP `updated_mcp_tool_output`
- `sessionStart.additional_context` and `env`
- `stop.followup_message` auto-submit
- `workspaceOpen.pluginPaths`
- cloud-agent hook subset (no `sessionStart` / `sessionEnd` in cloud)
- third-party Claude Code hook mapping
- plugin-distributed hooks from Customize
- Tab hooks (`beforeTabFileRead`, `afterTabFileEdit`)

This task does **not** use mutation, blocking, injection, or plugin
auto-install.

### OBSERVED LOCAL BEHAVIOR

Inspected read-only on this machine, Cursor `3.21.16`:

- Documented agent transcripts exist at:

  `~/.cursor/projects/<workspace-slug>/agent-transcripts/<conversation-id>/<conversation-id>.jsonl`

- This project: `…/agent-transcripts/b7e73489-ad02-45b2-94b8-8d4c0c471807/b7e73489-ad02-45b2-94b8-8d4c0c471807.jsonl`

- Observed JSONL lines are **not** Codex envelopes. Typical shapes:

  ```json
  { "role": "user"|"assistant", "message": { "content": [ { "type": "text"|"tool_use", ... } ] } }
  { "type": "turn_ended", "status": "...", "error": "..." }
  ```

- Observed `tool_use` parts have `name` + `input` and **no `id`**.
- Observed files contain **no `tool_result` parts** and no `role: "tool"` lines.
- Tools seen: `Read`, `Write`, `StrReplace`, `Glob`, `Grep`, `Shell`, `GetDynamicTools`, `CallDynamicTool`.
- First-line key shapes across local transcripts: `{message, role}` or `{error, status, type}`.
- `~/.cursor/cli-config.json` is a CLI/editor config (vim, sandbox, permissions). It is not a session transcript.
- Application Support looks like a VS Code user-data dir (`IndexedDB`, `Local Storage`, `User`, …).

The parser accepts the observed JSONL and, fail-open, also accepts
`tool_result` / `role: "tool"` / `id` if a future exporter includes them.

### UNDOCUMENTED/DO NOT DEPEND ON

Do **not** scrape or couple to:

- `~/Library/Application Support/Cursor` IndexedDB / Local Storage / Session Storage
- `state.vscdb` or other SQLite databases
- reconstructing transcript paths from workspace slugs when `transcript_path` is null
- Cursor internal compaction prompts or composer databases
- `cursor agent` installers or undocumented agent CLIs
- mutating `~/.cursor/hooks.json` automatically

If `transcript_path` is missing, the optional hook **skips** analysis.

## Session mapping

`CursorAdapter.parseTranscript` produces core `Transcript` /
`ContextMessage` values only.

| Cursor | Canonical |
| --- | --- |
| `role: user` text | `role: user`, origin `user` |
| `role: assistant` text | `role: assistant`, origin `agent` |
| `tool_use` | assistant message with `toolCalls[]` |
| `tool_result` or `role: tool` | `role: tool` + `toolCallId` |
| missing tool id | synthesized `tool_NNNN` |
| missing tool result | `unpaired_tool_call` (core already supports this) |
| `turn_ended` | ignored |
| unknown types | warning, parse continues |
| extra JSON fields | ignored |

Preserved in adapter metadata / shadow result when present:

- session / conversation id
- workspace cwd (`--cwd`, `session_meta.cwd`, or hook `workspace_roots[0]`)
- timestamps
- model
- Cursor version
- tool call ids
- original vendor path (`originalPath`)

Workspace slug → filesystem path is **not** guessed.

## Tool kind mapping

Cursor names go through the same core `classifyTool()` as Codex.
No Cursor-specific `ToolKind` values were added.

| Cursor | Codex analogue | `ToolKind` |
| --- | --- | --- |
| `Read` | `exec_command("cat …")` | `file_read` |
| `Write` / `StrReplace` | `apply_patch` | `file_write` |
| `Glob` | `ls` / `glob` | `directory_list` |
| `Shell` + `git status` | `exec_command("git status")` | `git_status` |
| `Shell` + `git diff` | `exec_command("git diff")` | `git_diff` |
| `Shell` + `npm test` | `exec_command("npm test")` | `test_run` |
| `Shell` + `npm run build` | `exec_command("npm run build")` | `build_run` |
| `Grep` / search | generic search | `command` |
| `Shell` + other | generic shell | `command` |
| `GetDynamicTools` / `CallDynamicTool` | n/a | `other` |

`glob_pattern` is a core path key so Cursor `Glob` resolves a directory.
Search tool names map to `command`, not a new kind.

## CLI

```bash
ctx cursor analyze ~/.cursor/projects/<slug>/agent-transcripts/<id>/<id>.jsonl
ctx cursor analyze session.jsonl --json
ctx cursor analyze session.jsonl --save --cwd /path/to/workspace
ctx cursor explain session.jsonl --no-report-previews
ctx cursor analyze session.jsonl --semantic-mode remote --semantic-provider jev
```

Default `--semantic-mode off`. Shadow mode only.

## Optional passive hook

`sessionEnd` is the only documented hook that is fire-and-forget, cannot
inject context, cannot block the agent, and may include `transcript_path`.

The sample config is `packages/adapter-cursor/hooks/hooks.json`.
**It is not installed automatically.**

To opt in, merge `sessionEnd` into `~/.cursor/hooks.json` or
`.cursor/hooks.json` with `failClosed: false` and a short `timeout`.
The hook process returns immediately and spawns detached analysis so a
hook timeout cannot stall Cursor.

Do not attach this engine to `preCompact`, `preToolUse`, `sessionStart`,
or `stop`. Those either mutate, block, inject, or cannot replace context.

## Semantic layer

Unchanged. After the adapter emits a canonical transcript:

```
Cursor → CursorAdapter → Transcript → compact()
  → semantic eligibility → existing SemanticProvider
```

`semanticMode=off` (default) and `semanticMode=remote` + Jev work
without Cursor-specific classifier logic. `SemanticProvider` was not
modified.

## Core changes

Small provider-independent classify tweaks only:

- `PATH_KEYS` includes `glob_pattern`
- named search tools (`Grep`, `rg`, …) classify as `command`

No SemanticProvider API changes.

## Privacy

Same guarantees as Codex: local default, no telemetry, no implicit HTTP.
Sensitive-content gate and redaction apply to Cursor sessions identically.
See [PRIVACY.md](./PRIVACY.md).
