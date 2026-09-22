# Publishing rules (npm + GitHub)

This document defines **who can publish** `fast-jev-llm` and **what must happen**
before a version reaches the npm registry. It applies while the GitHub repository
is **public** and the package is listed on [npmjs.com/package/fast-jev-llm](https://www.npmjs.com/package/fast-jev-llm).

## Principles

1. **Public source ≠ public publish.** Anyone may read the repo and open PRs;
   only maintainers can merge, tag releases, approve CI publish, or use the npm
   account.
2. **Tags trigger automation; humans gate npm.** Pushing `v*` runs CI, but
   `npm publish` runs only in the protected **`npm`** GitHub Environment after
   explicit approval (when reviewers are configured).
3. **No long-lived npm tokens in GitHub.** Production publishes use **OIDC
   trusted publishing** from `.github/workflows/release.yml` only.
4. **One published artifact:** the compiled CLI in `cli/` (`fast-jev-llm` on
   npm). Workspace packages `@fast-jev/*` stay private to the monorepo.

## Who can publish to npm?

| Actor | Can publish? | How |
| --- | --- | --- |
| Random internet user | **No** | No npm login, no trusted OIDC match |
| Fork of this repo | **No** | OIDC identity is the fork repo, not `Non-Plus/fast-jev-llm` |
| Collaborator without tag + approval | **No** | Cannot complete trusted publish path alone if environment reviewers are set |
| Maintainer with `npm login` as **nonplusmy** | **Yes** | Manual emergency publish (discouraged once OIDC works) |
| **Release** workflow after **`npm` env approval** | **Yes** | Tag + green CI + reviewer approval → OIDC `npm publish --provenance` |

## GitHub controls (required)

Configure under **Non-Plus/fast-jev-llm → Settings**:

### Branch protection (`main`)

- Require pull request before merge
- Require at least one approval on PRs
- Do not allow bypass except org owners (your choice)
- Restrict who can push directly (prefer **nobody**)

### Tag and release discipline

- Only maintainers create version tags (`v*`)
- Tag **`vX.Y.Z`** must match `cli/package.json` **`version`** (enforced in CI)
- Do not re-push or move release tags after publish

### Environment **`npm`** (required for CI publish)

**Settings → Environments → `npm`**

- **Required reviewers:** at least one maintainer (you)
- **Deployment branches:** optional limit to tags matching `v*` if available
- No secrets required for OIDC publish

The **Release** workflow job that runs `npm publish` uses `environment: npm`.
Reviewers must approve that deployment in the Actions UI before publish runs.

### Repository roles

- **Write / Maintain / Admin:** trusted maintainers only
- **Read:** default for contributors; they contribute via fork + PR

## npmjs.com controls (required)

Under **Packages → fast-jev-llm → Settings**:

### Trusted publishing

Exactly one GitHub Actions trusted publisher (adjust only when intentional):

| Field | Value |
| --- | --- |
| Organization or user | `Non-Plus` |
| Repository | `fast-jev-llm` |
| Workflow filename | `release.yml` |
| Environment name | **`npm`** (must match GitHub Environment) |

Do not add trusted publishers for other repos, workflows, or forks.

### Account and access

- **2FA** enabled on the npm account that owns the package
- Prefer **disallow classic tokens** for publish once OIDC is verified
- **Maintainers:** only `nonplusmy` (and future trusted org admins if needed)
- Do not add npm collaborators you do not trust with publish rights

## Allowed publish paths

### Standard (preferred)

1. Bump version in `cli/package.json` and `packages/local/src/release-version.ts`
2. Update `CHANGELOG.md` and release notes
3. Merge to `main` via PR
4. Create and push tag: `git tag vX.Y.Z && git push origin vX.Y.Z`
5. **Release** workflow runs tests and build
6. Approve the **`npm`** environment deployment
7. Workflow publishes with **provenance**

Pushes to **`main` alone never publish.**

### Manual (break-glass only)

For registry emergencies when CI is broken:

```bash
pnpm install && pnpm build
cd cli && npm login && npm publish --access public --provenance
```

Document the manual publish in `CHANGELOG.md`. Restore CI/OIDC as soon as possible.

## What public visibility does **not** expose

- End-user shadow reports under `~/.context-engine/`
- Private API keys or `.env` files (must never be committed)
- Unpublished workspace packages under `packages/`

Run `pnpm --filter fast-jev-llm test` (includes secret scan) before each release.

## Checklist before approving the `npm` environment

- [ ] Tag matches `cli/package.json` version
- [ ] CI **verify** job green (lint, test, typecheck, build, pack inspect)
- [ ] `CHANGELOG.md` updated for this version
- [ ] No known secret or personal-data regression

## Related docs

- [NPM_PUBLISHING.md](NPM_PUBLISHING.md) — setup and troubleshooting
- [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) — version cut checklist
- [SECURITY.md](../SECURITY.md) — vulnerability reporting
