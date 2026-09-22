# Contributing

Thanks for considering a contribution to **fast-jev-llm**.

This is a shadow-mode context optimizer for Claude Code, Codex, and
Cursor. It does not currently modify agent context.

Please follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Development setup

Requirements: Node.js 22+, pnpm 10.

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm build
```

Useful commands:

```bash
pnpm ctx -- --help
pnpm ctx -- setup --dry-run
pnpm compact
```

Architecture overview: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md),
[docs/NAMING.md](docs/NAMING.md).

## Testing

- Unit and adapter tests live next to each package
- Setup/hook tests **must** use a temporary HOME / `CONTEXT_ENGINE_HOME`
- Never write to the real `~/.codex`, `~/.cursor`, or `~/.claude`
- Provider tests must mock the network; CI must not call Jev

## Adding an adapter

1. Parse only documented transcript formats
2. Normalize into canonical `@fast-jev/core` types
3. Call `compact()`; do not implement a second engine
4. Stay shadow-only: no transcript rewrite, no context injection
5. Add fixtures that are synthetic (no real user sessions)

## Adding a semantic provider

Implement `SemanticProvider` in an isolated package. Default mode remains
`off`. Remote calls require explicit `semanticMode=remote`. Fail open on
provider errors. Do not log credentials.

## Adding deterministic rules

Put rules in `packages/core`. Protected items must not DROP. Add tests
for safety-critical cases (user constraints, unresolved errors, recent
context).

## Fixture policy

**Real user transcripts must never be committed.**

Use synthetic session IDs, `/Users/alice/project` (or `/home/developer/project`)
paths, and fake secrets such as `sk-aaaaaaaa…`.

## Privacy

See [docs/PRIVACY.md](docs/PRIVACY.md). Do not add telemetry, analytics,
or automatic upload.

## Pull requests

- Keep the change scoped
- Include tests
- Do not paste proprietary transcripts into the PR
- Note if hooks, report schema, or CLI exit codes change (0.x may evolve)

Do not `npm publish` or push version tags from a pull request. Publishing
is a human release action (see [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md)
and [docs/NPM_PUBLISHING.md](docs/NPM_PUBLISHING.md)).

CI publishes **`fast-jev-llm`** to npm only when a **`v*`** tag is pushed;
the workflow is `.github/workflows/release.yml` (npm trusted publishing / OIDC).
