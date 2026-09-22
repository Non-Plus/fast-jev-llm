# Release checklist (v0.1.0)

Human release actions. Do not `npm publish`, push tags, or create a
GitHub Release until this list is complete.

- [ ] repository public-data audit
- [ ] secret scan
- [ ] license audit
- [ ] lint
- [ ] typecheck
- [ ] tests
- [ ] build
- [ ] npm pack inspection
- [ ] packed-artifact install test
- [ ] macOS CI
- [ ] Linux CI
- [ ] README verified
- [ ] version verified (`0.1.0`)
- [ ] changelog verified
- [ ] npm name verified (`fast-jev-llm`)
- [ ] GitHub release notes prepared
- [ ] npm trusted publishing configured (OIDC) or an automation token is available
- [ ] no real transcripts
- [ ] no personal paths
- [ ] no credentials
- [ ] no active context modification

## npm trusted publishing (one-time)

Follow [docs/NPM_PUBLISHING.md](NPM_PUBLISHING.md):

- npm: Trusted publisher → GitHub Actions → `Non-Plus` / `fast-jev-llm` / **`release.yml`**
- GitHub: optional **`npm`** environment with reviewers
- Confirm tag `v0.1.0` matches `cli/package.json` version `0.1.0`

## After the list is checked (human)

```bash
git tag v0.1.0
git push origin v0.1.0
# Watch .github/workflows/release.yml on GitHub Actions
# Create GitHub Release from docs/RELEASE_NOTES_v0.1.0.md
```

Do not run those commands as part of ordinary CI on `main`.
