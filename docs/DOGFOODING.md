# Dogfooding

Goal: run Context Engine every day in **shadow mode** and collect local
evidence across real Codex, Cursor, and Claude Code sessions.

No daemon. No cloud account. No telemetry.

## Flow

```bash
pnpm install
pnpm ctx -- setup
# use coding agents normally
pnpm ctx -- stats
```

Or, with `ctx` on `PATH`:

```bash
ctx setup
ctx dogfood status
ctx stats --days 7
```

`ctx dogfood status` shows whether detected agents have passive
SessionEnd hooks and how many local reports exist.

## What you should look at

- `ctx stats` — potential reduction, compression vs drop, unsafe drops
- `ctx stats --agent cursor` vs `--agent codex` — **not equivalent inputs**
  when Cursor completeness is `tool_calls_only`
- `unsafeDropCount` — primary safety signal; keep it at 0
- reason-code totals after engine/ruleset version changes (stamped on
  every report)

## Export

```bash
ctx stats --json
ctx stats --export stats.json
```

Exports are aggregate statistics only. They do not include raw
transcripts or source previews.

## Privacy while dogfooding

Reports are safe to keep locally for weeks: statistics, hashes, token
counts, reason codes, and short workspace display names (repository
basename). Absolute project paths are hashed. See
[PRIVACY.md](PRIVACY.md).
