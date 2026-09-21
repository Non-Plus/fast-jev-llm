# Claude Code integration (shadow mode)

This document records the Claude Code installation and surfaces
inspected for Task 7, plus the only integration this repo uses.

Wire-format details live in
[CLAUDE_COMPATIBILITY.md](./CLAUDE_COMPATIBILITY.md).

**Shadow mode is observation only.** The adapter never modifies Claude
context, never replaces compaction, never alters transcripts, never
injects messages, never blocks tools, never patches Claude, and never
depends on undocumented internals.

```
Claude session / transcript
      ↓
Claude adapter
      ↓
Canonical Transcript
      ↓
Existing Context Engine
      ↓
Shadow analysis
```

`packages/core` stays unaware of Claude types. Claude-specific parsing
lives only in `packages/adapter-claude`. Semantic classification reuses
the existing `SemanticProvider` API unchanged (Jev included).

## Detected local Claude Code

| Field | Value |
| --- | --- |
| CLI | `claude` on PATH |
| Binary | `claude` on `PATH` |
| Package | `@anthropic-ai/claude-code` |
| Version | `2.1.251` |
| User settings | `~/.claude/settings.json` |
| User config dir | `~/.claude/` |
| Project transcripts | `~/.claude/projects/<path-slug>/<session-uuid>.jsonl` |
| Local hooks in settings | `hooks.PreToolUse` only (not modified by this repo) |

Discovery did **not** modify Claude configuration, hooks, plugins, or
transcripts.

## Surface classification

### DOCUMENTED/STABLE

Official docs: [Hooks](https://code.claude.com/docs/en/hooks) (Claude
Code hooks reference).

Common hook input includes `session_id`, `transcript_path`, `cwd`,
`permission_mode`, `hook_event_name`.

Documented lifecycle (command hooks, JSON stdin):

| Event | Decision control | Notes |
| --- | --- | --- |
| `SessionStart` | can add context | not used |
| `UserPromptSubmit` | can block | not used |
| `PreToolUse` / `PostToolUse` | Pre can deny | not used |
| `PostToolUseFailure` | none | not used |
| `PermissionRequest` | can allow/deny | not used |
| `Stop` / `StopFailure` / `Notification` | Stop can block | not used |
| `PreCompact` | **can block compaction** (`exit 2` or `decision: block`) | **must not be used for shadow analysis** |
| `PostCompact` | none | observational after compact; still not used here |
| `SessionEnd` | **none** | fire-and-forget cleanup; default timeout **1.5s** |

`transcript_path` is a common field. SessionEnd input:

```json
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../<uuid>.jsonl",
  "cwd": "/Users/...",
  "hook_event_name": "SessionEnd",
  "reason": "other"
}
```

SessionEnd cannot block termination. JSON output fields such as
`systemMessage` are discarded. Raise timeout via per-hook `timeout`
(budget up to 60s) or `CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS`.

These documented SessionEnd + JSONL transcript surfaces are the only
ones the optional hook relies on.

### EXPERIMENTAL

Treat as documented but unstable or easy to misuse:

- function-hook plugin API (`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS`) used
  by fast-jev-compaction (`session.compact`, `turn.complete`)
- `PreCompact` / `PostCompact` as a compaction replacement
- prompt-based hooks
- `failClosed` matcher behavior on tool/permission hooks
- `PreModelSwitch` (requires v2.1.251+; can block model changes)
- Agent SDK / Remote Control `set_model` paths

**This repo does not use function hooks or PreCompact.**

### OBSERVED LOCALLY

On this machine, Claude Code `2.1.251` writes JSONL transcripts under
`~/.claude/projects/<slug>/`. Observed line `type` values include:

`user`, `assistant`, `system`, `attachment`, `queue-operation`,
`custom-title`, `last-prompt`, `mode`

Observed fields on conversation lines: `sessionId`, `cwd`, `timestamp`,
`uuid`, `parentUuid`, `message`, `toolUseResult`, `version`, `gitBranch`.

Assistant `message.content` includes `text`, `tool_use`
(`{id,name,input}` with ids like `toolu_…`), and `thinking`.

User follow-ups commonly carry `tool_result` parts with `tool_use_id`.
In a sampled session every `tool_use` had a matching `tool_result`
(230/230).

Tools observed: `Read` (`file_path`), `Write`, `Edit`, `Bash`
(`command`), `Glob`, `Grep`, `Agent`, `Skill`.

Subagent transcripts may be named `agent-*.jsonl`. Parent sessions are
`<uuid>.jsonl`. Some files on disk exceed 100MB; the adapter streams
and must not be pointed at huge files casually. Discovery does not
rewrite any of them.

### UNDOCUMENTED / DO NOT DEPEND ON

- internal SQLite / debug logs under `~/.claude`
- scraping Claude.app UI state
- undocumented transcript databases
- rewriting JSONL in place
- assuming `transcript_path` is always present at SessionEnd (docs
  warn it may lag or the file may already be gone)
- adjacency-only pairing when `tool_use_id` exists
- function-hook internals copied from third-party plugins

## What this repo implements

- `packages/adapter-claude` parses JSONL → canonical `Transcript`
- `analyzeClaudeSession()` runs `compact()` in memory
- CLI: `ctx claude analyze|explain`
- optional SessionEnd hook in `packages/adapter-claude/hooks/hooks.json`
  that is **not auto-installed**, fail-open, detached, analysis-only

## What this repo does not implement

- active Claude compaction or context replacement
- `PreCompact` blocking or summary injection
- transcript rewriting
- function hooks
- copying fast-jev-compaction source
