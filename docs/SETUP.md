# Setup

Context Engine is **shadow mode only**. `ctx setup` installs passive
SessionEnd hooks so coding agents can be used normally while the engine
writes **local** analysis reports. It does not modify session context.

## Install

```bash
pnpm install
pnpm ctx -- setup
```

Installed usage (once the `ctx` binary is on `PATH`):

```bash
ctx setup
```

Default analysis mode is **local deterministic only**. Remote semantic
classification is never enabled unless you choose it and confirm.

## What setup does

1. Detects Codex, Cursor, and Claude Code.
2. Shows the exact config files and hook entries it would add.
3. Asks before writing.
4. Backs up user-owned files it modifies.
5. Installs only passive SessionEnd / sessionEnd hooks.

Hooks invoked:

| Agent | Event | Command |
| --- | --- | --- |
| Codex | `SessionEnd` | `ctx hook codex --context-engine-shadow` |
| Cursor | `sessionEnd` | `ctx hook cursor --context-engine-shadow` |
| Claude Code | `SessionEnd` | `ctx hook claude --context-engine-shadow` |

Unrelated hooks are preserved. Installation is idempotent.

```bash
ctx setup --dry-run
```

Dry-run performs **zero writes**.

Non-interactive:

```bash
ctx setup --yes
ctx setup --yes --agents codex,cursor,claude
```

Remote semantic mode (explicit only):

```bash
ctx setup --yes --semantic-mode remote --confirm-remote
```

That prints a warning that selected context may be sent to an external
provider. API keys stay in the environment (`TYPESAFE_API_KEY` or
`JEV_API_KEY`); they are not copied into `~/.context-engine/config.json`.

## After setup

Use coding agents as usual. Then:

```bash
ctx status
ctx doctor
ctx sessions
ctx stats
```

## Uninstall

```bash
ctx uninstall
ctx uninstall codex
ctx uninstall cursor
ctx uninstall claude
```

Only Context Engine hook entries are removed. If a config file was
changed externally in a way that cannot be edited safely, uninstall
leaves it untouched and reports that.

## Tests and your real configs

Automated tests use a temporary `HOME`. They never write to the real
`~/.codex`, `~/.cursor`, or `~/.claude` directories.
