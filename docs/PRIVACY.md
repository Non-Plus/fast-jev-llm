# Privacy

The context engine is local-first. Semantic classification is optional
and **off by default** so the tool cannot silently send source or
session context to a remote provider.

## What never leaves the machine (default)

With `semanticMode=off` (the default):

- Codex, Cursor, and Claude JSONL transcripts
- source files and tool dumps
- commands, secrets, and prompts
- shadow reports (written under `.context-engine/` and gitignored)

No telemetry. The Codex, Cursor, and Claude adapters do not open sockets.

## Remote semantic mode

Remote classification happens only when **all** of these are true:

1. `semanticMode` is explicitly `remote`
2. a remote provider is supplied (`--semantic-provider jev`)
3. `TYPESafe` / `JEV` credentials are present in the environment

CLI examples:

```bash
ctx codex analyze session.jsonl \
  --semantic-mode remote \
  --semantic-provider jev

ctx cursor analyze session.jsonl \
  --semantic-mode remote \
  --semantic-provider jev

ctx claude analyze session.jsonl \
  --semantic-mode remote \
  --semantic-provider jev
```

`--semantic-provider jev` without `--semantic-mode remote` is refused.

## What is sent to a remote provider

A **packed copy**, never the canonical transcript:

- current task text
- user constraint summaries
- current error labels
- modified file paths
- recent activity labels
- architectural facts already in session state
- per candidate: id, type, tool kind, command/path, age/order, token
  size, relationship summaries, and a short content preview

Forbidden items are not included. Huge outputs are not duplicated.

## What is never sent

- items with `semanticEligibility=forbidden`
- explicit user constraints, current task, system/developer instructions
- recent user messages
- unresolved current errors
- items already DROPped with structural confidence
- recognized secret material (see gate + redaction)
- API credentials (except the provider’s own request `Authorization`
  header, which is never logged)
- Codex, Cursor, or Claude JSONL, compaction prompts, or original unredacted payloads

## Sensitive-content gate

Before remote classify, obvious patterns mark an item `forbidden`
with `SENSITIVE_CONTENT_REMOTE_BLOCK`:

- `.env` files
- private keys
- access/API tokens
- password-like assignments
- `Authorization` headers
- connection strings

This is a conservative outbound gate, not a security scanner.
Detected secret **values are not logged**.

## Redaction

Remote requests run a deterministic redaction pass on the **provider
copy only**. The local canonical transcript is never mutated.

`redactionsApplied` is counted on the semantic audit. Original secret
values are not written to logs or reports.

## Provider failure

Timeouts, network errors, invalid JSON, and partial/invalid decisions
fail open: keep or use the deterministic decision. Never DROP because
classification failed. `compact()` still succeeds.

## Cache

Optional, local, gitignored: `.context-engine/cache/`.

Keys include provider, provider/model version, candidate content hash,
semantic state hash, and policy version. Raw outbound payloads and
credentials are not stored.

## Reports

JSON shadow reports record provider name/version, policy, candidate
and batch counts, latency, failures, redaction counts, tokens and
characters sent externally, semantic decisions, and merged decisions.

They do not record credentials or unredacted provider payloads.
Use `--no-previews` to omit even local content previews.
