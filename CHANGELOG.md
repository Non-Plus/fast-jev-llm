# Changelog

## 0.1.1

- Document optional remote Jev setup in the README
- Publishing governance docs and Release workflow `npm` environment gate
- npm pack JSON parsing fixes for npm 12 CI
- Normalize CLI `bin` path for npm 12

## 0.1.0

First public shadow-mode release.

- Codex, Cursor, and Claude Code shadow adapters
- Deterministic protect / keep / compress / drop engine
- Optional Jev semantic provider (off by default)
- Passive SessionEnd hooks via `ctx setup`
- Local privacy-preserving reports (`ctx status`, `ctx sessions`, `ctx stats`, `ctx doctor`)
- No telemetry

**No active context modification.** This release only observes transcripts
and writes local estimates. It does not replace vendor compaction.
