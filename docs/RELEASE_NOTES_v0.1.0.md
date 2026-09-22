# fast-jev-llm v0.1.0

Shadow-mode context optimization for Claude Code, Codex, and Cursor.

## What it does

Install `ctx`, run `ctx setup`, keep using your coding agents, then
`ctx stats`. The engine writes **local** estimates of what could be
protected, kept, compressed, or dropped.

It does **not** modify agent context. It does **not** replace vendor
compaction. There are **no observed live context savings** in this
release — only shadow reports.

## Privacy

Local analysis, no telemetry, no raw transcript copies in the report
store. Remote Jev classification is opt-in.

## Install

```bash
npm install -g fast-jev-llm
ctx setup
```

Node.js 22+.

## Known limitations

- Shadow mode only
- Cursor transcripts may omit tool results
- 0.x CLI/config/report schema may evolve
- Windows is not claimed
- Jev is optional and not invoked in CI
