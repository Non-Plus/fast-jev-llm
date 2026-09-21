# Claude Code compatibility matrix

Observed against **Claude Code 2.1.251** (npm `@anthropic-ai/claude-code`
on this machine) plus official hook docs. Parsing is fail-open: unknown
event types, unknown content parts, extra JSON fields, and malformed
lines are skipped or warned.

Shadow mode is observation only. It never rewrites transcripts, never
replaces Claude compaction, and never injects context.

Fixtures identify `version: "2.1.251"` and
`observed_wire_format: "claude-code-transcript-jsonl-v1"` when they
represent this format.

## Local product versions observed

| Source | Version | Notes |
| --- | --- | --- |
| `claude --version` / package | `2.1.251` | `claude` on `PATH` |
| Transcript `version` field | e.g. `2.1.177` / `2.1.181` in older files | Per-session |
| Hook docs | current public hooks reference | SessionEnd, PreCompact, PostCompact |

## Session format

Documented pointer: hook `transcript_path`.

Observed on-disk layout (this machine):

```
~/.claude/projects/<slug>/<session-uuid>.jsonl
```

Each line is a JSON object. Shapes accepted:

| Line | Handling |
| --- | --- |
| `{ "type": "user" \| "assistant", "message": { "content": [...] } }` | Conversation event (observed) |
| `{ "type": "system", "subtype": "compact_boundary" }` | Recorded as observed compaction marker; not conversation content |
| other `{ "type": "system" }` with content | Mapped as system origin when text is present |
| `queue-operation`, `attachment`, `custom-title`, `last-prompt`, `mode` | Ignored |
| `{ "type": "session_meta", ... }` | Fixture / optional metadata |
| unknown `type` | `unknown_event`, continue |
| invalid JSON | malformed line, continue |
| extra fields | ignored |

### Tool-call format

Observed `tool_use`:

```json
{ "type": "tool_use", "id": "toolu_…", "name": "Read", "input": { "file_path": "src/auth.ts" } }
```

`id` is present in observed files. The adapter uses documented
`id` / `tool_use_id` / `call_id`. It does **not** infer pairings from
adjacency when those ids exist. Missing ids synthesize `tool_NNNN` for
the call only.

Fail-open aliases: `tool_call`, `arguments`, `params`, `tool_name`.

### Tool-result format

Observed on subsequent `user` lines:

```json
{ "type": "tool_result", "tool_use_id": "toolu_…", "content": "…" }
```

`toolUseResult` on the event is used only when part content is empty.
`is_error` is preserved in metadata. Missing results become
`unpaired_tool_call`. Orphan results become `unpaired_tool_result`.
Neither crashes analysis.

Unlike locally observed Cursor transcripts, Claude sessions typically
include full tool results, so compression and supersession can run.

## Workspace handling

| Source | Used as cwd |
| --- | --- |
| event `cwd` | yes (observed) |
| `--cwd` CLI | override |
| hook `cwd` | optional hook |

`Read` / `Write` / `Edit` paths use `file_path`. Relative, dotted, and
absolute-in-workspace paths canonicalize to a project-relative POSIX
path. Paths that escape the repo are left unmapped (`pathOutsideRepo`).

## ToolKind mapping (same canonical values as Codex and Cursor)

| Claude | Canonical `ToolKind` |
| --- | --- |
| `Read` / `cat` | `file_read` |
| `Write` / `Edit` / `NotebookEdit` / `MultiEdit` | `file_write` |
| `Bash("git status")` | `git_status` |
| `Bash("git diff")` | `git_diff` |
| `Glob` / `ls` | `directory_list` |
| `Bash("npm test")` | `test_run` |
| `Bash("npm run build")` | `build_run` |
| `Bash("echo …")` / `Grep` | `command` |
| `Agent` / `Skill` / unknown | `other` |

## Compaction-related capabilities (documented)

| Capability | Shadow use |
| --- | --- |
| Auto-compact / `/compact` | not invoked |
| `PreCompact` can block | **not used** |
| `PostCompact` `compact_summary` | not used; if `compact_boundary` appears in JSONL it is reported separately as observed Claude compaction |
| Function hook `session.compact` | **not used** (experimental; used by fast-jev-compaction) |

## Fail-open policy

- unknown events warn and continue
- malformed lines increment `malformedLineCount` and continue
- unknown content parts warn
- thinking / redacted_thinking skipped
- analysis of a truncated file must not throw out of the hook
