# Codex integration (shadow mode)

This document records what is actually available on the machine that
implemented Task 3, plus the only integration we will use.

Wire-format details and the fixture matrix live in
[CODEX_COMPATIBILITY.md](./CODEX_COMPATIBILITY.md).

**Shadow mode is observation only.** The adapter never modifies Codex
context, never replaces compaction, never alters transcripts, never
injects messages, never patches Codex, and never depends on undocumented
internals.

## Detected local Codex

| Field | Value |
| --- | --- |
| CLI binary | `codex` on `PATH` |
| `codex --version` | `codex-cli 0.151.0` |
| Feature `hooks` | **stable**, **enabled** (`true`) |
| Feature `plugin_hooks` | **removed**, `false` |
| Hook trust flag | `--dangerously-bypass-hook-trust` exists |
| Config | `~/.codex/config.toml` |
| Sessions | `~/.codex/sessions/YYYY/MM/DD/rollout-<timestamp>-<id>.jsonl` |

Desktop / app-server rollouts on this machine sometimes record
`cli_version` values such as `0.154.0-alpha.6.2` or `0.155.0-alpha.9.2`
inside `session_meta` even though the installed CLI reports `0.151.0`.
Treat the CLI `--version` as the local product version, and treat
`session_meta.cli_version` as the emitter of that particular rollout
file.

## Documented lifecycle hooks

Official docs: [Hooks](https://developers.openai.com/codex/hooks).

Events documented for current Codex:

| When | Events |
| --- | --- |
| During a turn | `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `UserPromptSubmit`, `SubagentStop`, `Stop` |
| Session / subagent start | `SessionStart`, `SubagentStart` |
| Main thread end | `SessionEnd` (does **not** run for subagents) |

Local `codex features list` agrees that `hooks` is a stable, enabled
feature. The local feature table marks `plugin_hooks` as **removed**.
Public docs still describe plugin-bundled `hooks/hooks.json`. This repo
does **not** assume plugin-bundled hooks work on 0.151.0.

### Common stdin payload

Every command hook receives one JSON object on stdin. Fields we rely on
only when the public docs name them:

| Field | Type | Meaning |
| --- | --- | --- |
| `session_id` | string | Codex session id |
| `transcript_path` | `string \| null` | Path to the session transcript, if any |
| `cwd` | string | Session working directory |
| `hook_event_name` | string | Event name |
| `model` | string | Active model slug (Codex-specific extension) |

Docs state explicitly: `transcript_path` is a convenience pointer, **not
a stable interface**. The on-disk JSONL shape may change.

### Event-specific notes

**SessionStart** — matcher is start source: `startup`, `resume`,
`clear`, `compact`. Plain text / `additionalContext` is injected as
developer context. **Not used** by this project (injection is forbidden
in shadow mode).

**SessionEnd** — matcher is end reason; currently only `other`. Payload
includes `transcript_path`, `cwd`, `session_id`, `reason`. Output is
**advisory**: it cannot steer Codex or keep the thread open. Default
timeout is **1 second**, capped at **3 seconds**. Failures are reported
as hook failures; Codex continues. **This is the only hook we optionally
use.**

**PreToolUse / PostToolUse** — can observe Bash/`exec_command`,
`apply_patch`, MCP tools, and other local function tools. `PreToolUse`
can deny or rewrite a call. `PostToolUse` `continue: false` can change
model-visible results. **Not used** (would affect Codex).

**PreCompact / PostCompact** — matcher is `manual` or `auto`. Both
include the common `transcript_path` field. `continue: false` **stops
Codex** before or after compaction. **Not used.** Using these hooks
would be an active integration, not shadow mode.

**UserPromptSubmit / Stop / Subagent\*** — can inject context or
continuation prompts. **Not used.**

## Transcript format observed on disk

Rollout files are JSONL. Each line is typically:

```json
{
  "timestamp": "2026-09-21T01:00:00.000Z",
  "ordinal": 0,
  "type": "session_meta",
  "payload": {}
}
```

Envelope `type` values seen on this machine:

| Envelope type | Role in shadow adapter |
| --- | --- |
| `session_meta` | Session id, cwd, timestamp, originator, cli_version |
| `turn_context` | cwd, model, turn id |
| `response_item` | Conversation and tool traffic |
| `event_msg` | Ignored (lifecycle noise: `task_started`, `token_count`, …) |
| `token_usage_record` | Ignored |
| `world_state` | Ignored |

`response_item.payload.type` values mapped:

| Payload type | Mapping |
| --- | --- |
| `message` | user / assistant / developer→system |
| `function_call` | assistant tool call |
| `function_call_output` | tool result |
| `custom_tool_call` | assistant tool call (`exec` JS wrappers) |
| `custom_tool_call_output` | tool result |
| `reasoning` | skipped (`encrypted_content` is not useful text) |
| `compaction` | skipped (Codex's own compaction record; we do not replace it) |

Current Desktop/code-mode sessions wrap shell work as:

```js
const r = await tools.exec_command({cmd:"git status", workdir:"..."});
text(r.output);
```

inside `custom_tool_call.input`. Older / MCP paths still use
`function_call` + JSON `arguments`.

The parser streams lines, skips malformed JSON, retains unknown event
*types* in parse warnings, and does not assume tool calls are paired or
that the file ends cleanly.

## Safe integration points

Safe today:

1. **Offline CLI**: `ctx codex analyze <rollout.jsonl>` and
   `ctx codex explain <rollout.jsonl>` against a copied or in-place
   rollout file. Read-only.
2. **Optional SessionEnd hook** that reads `transcript_path` from stdin,
   spawns detached analysis, writes `.context-engine/shadow/<id>.json`,
   prints nothing to stdout, and always exits `0`.

Not safe for shadow mode (documented, but unused):

- Any hook that returns `additionalContext`, `continue: false`,
  `permissionDecision`, or rewrite payloads
- `PreCompact` / `PostCompact` (can halt Codex)
- Patching Codex, rewriting rollouts, or scraping undocumented fields
  as required API

## Optional SessionEnd hook

Example (replace the `node` path with an absolute path to this repo's
built hook):

```json
{
  "description": "Context Engine shadow analysis. Observation only.",
  "hooks": {
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node /ABS/PATH/fast-jev-llm/packages/adapter-codex/dist/hook-cli.js",
            "timeout": 3
          }
        ]
      }
    ]
  }
}
```

Place that in `~/.codex/hooks.json` or a trusted project
`.codex/hooks.json`, then trust it via Codex `/hooks`.

Behavior:

- stdin JSON is parsed; if `transcript_path` is missing, the hook exits 0
- analysis runs in a detached child so the 1–3s SessionEnd budget is not
  used to compact a multi-megabyte transcript
- failures are swallowed (fail open)
- stdout is empty (no injection)
- only the analysis **report** is stored, never a copy of the transcript

Environment:

- `CONTEXT_ENGINE_SHADOW_DIR` — override report directory
- `CONTEXT_ENGINE_DEBUG=1` — hook diagnostics on stderr

Default report path: `<cwd>/.context-engine/shadow/<session-id>.json`

## Privacy

Shadow analysis is local:

- no telemetry
- no analytics
- no HTTP requests
- source code, transcripts, tool results, and commands are not
  transmitted anywhere

See [SHADOW_MODE.md](./SHADOW_MODE.md).
