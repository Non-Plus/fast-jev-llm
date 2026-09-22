# Naming

This document records **current** names and the **public V0.1** structure.
Internal workspace packages are not renamed in this release.

## Positioning

**fast-jev-llm** is context optimization for Claude Code, Codex, and Cursor.

It is an independent open-source project. It is **not** an official fork,
successor, or affiliate of fast-jev-compaction, TypeSafe, Anthropic,
OpenAI, Cursor, or Jev.

Jev is an **optional** semantic relevance provider. The deterministic
engine works with semantic mode off (the default).

## Current names (repository)

| Surface | Name |
| --- | --- |
| GitHub repository | `Non-Plus/fast-jev-llm` |
| Workspace root (private) | `fast-jev-llm-workspace` |
| Public npm package | `fast-jev-llm` |
| CLI binary | `ctx` |
| Internal packages | `@fast-jev/core`, `@fast-jev/adapter-*`, `@fast-jev/local`, `@fast-jev/provider-jev`, `@fast-jev/providers`, `@fast-jev/benchmarks` |
| Product phrasing | Context Engine (CLI/status copy) |
| Local data dir | `~/.context-engine/` |
| Hook marker | `--context-engine-shadow` |

`ctx` is the user-facing command. It does **not** imply a vendor.

## Public V0.1 structure

Publish **one** package:

- npm: `fast-jev-llm`
- binary: `ctx`
- GitHub: `fast-jev-llm`

Users install:

```bash
npm install -g fast-jev-llm
ctx setup
```

or:

```bash
npx fast-jev-llm setup
```

Internal `@fast-jev/*` packages stay private workspace packages and are
**not** published. They are bundled into the CLI. They are not a supported
library API in 0.x.

## npm availability (checked, not reserved)

| Name | Registry |
| --- | --- |
| `fast-jev-llm` | available (HTTP 404) |
| `fast-jev` | available (HTTP 404) |
| `@fast-jev/llm` | available (HTTP 404) |
| `fast-jev-compaction` | **taken** (unrelated project) |

If `fast-jev-llm` becomes unavailable before publish, stop and choose
explicitly. Do not auto-pick a substitute.

## GitHub

This repository is already `fast-jev-llm`. Nearby names:

- [tamaratran/fast-jev-compaction](https://github.com/tamaratran/fast-jev-compaction) — inspiration, different product
- ServiceNow/Fast-LLM — unrelated training library
- sljeff/jev-llm — unrelated

## Trademark / naming ambiguity

**fast-jev-compaction** is a Claude-oriented library/plugin that uses
TypeSafe Jev to prune tool activity. Sharing the substring `fast-jev`
can look like affiliation.

This project must say, in README and release notes:

- independent open-source project
- inspired in part by fast-jev-compaction
- not an official fork, successor, or affiliated product
- Jev is optional; deterministic shadow analysis is the default

Do not imply Anthropic, OpenAI, Cursor, or TypeSafe endorsement.

## What we did not rename in V0.1

- Internal npm scope `@fast-jev/*` (unpublished)
- `~/.context-engine/` paths and `--context-engine-shadow`
- CLI command `ctx`

Renaming those later would be a breaking change for hooks and local data.
