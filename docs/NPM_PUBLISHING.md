# npm publishing (CI/CD)

The **`fast-jev-llm`** package is published from GitHub Actions when you push a
version tag. Ordinary pushes to `main` do **not** publish.

**Governance:** see [PUBLISHING_RULES.md](PUBLISHING_RULES.md) for who may publish,
GitHub/npm settings, and the required **`npm`** environment approval.

## One-time setup on npmjs.com

1. Sign in at [npmjs.com](https://www.npmjs.com/) as **`nonplusmy`** (or the
   account that owns **`fast-jev-llm`**).

2. Open **Packages → fast-jev-llm → Settings → Trusted publishing**.

3. Add a **GitHub Actions** trusted publisher with **exact** values:

   | Field | Value |
   | --- | --- |
   | Organization or user | `Non-Plus` |
   | Repository | `fast-jev-llm` |
   | Workflow filename | `release.yml` |
   | Environment name | **`npm`** |

   Allow **`npm publish`**.

4. **Recommended:** require **2FA** and **disallow classic publish tokens** once
   OIDC publish is verified.

5. No **`NPM_TOKEN`** secret is required when trusted publishing is configured.

## One-time setup on GitHub

1. Create environment **`npm`**:

   **Settings → Environments → New environment → `npm`**

   - Add **Required reviewers** (maintainers who must approve each publish).
   - Optionally restrict deployment branches to tags `v*`.

2. The repository is **public** so npm **provenance** can link to source on
   GitHub. See [PUBLISHING_RULES.md](PUBLISHING_RULES.md).

## Release flow

1. Bump `cli/package.json` `version` and `packages/local/src/release-version.ts`.
2. Update `CHANGELOG.md`.
3. Merge to `main` via PR.
4. Tag and push:

   ```bash
   git tag v0.1.1
   git push origin v0.1.1
   ```

5. **Release** workflow runs lint, test, build, and pack inspection.
6. Approve the **`npm`** environment in the Actions run (if reviewers are set).
7. Workflow runs `npm publish --provenance`.
8. Create a GitHub Release from release notes in `docs/`.

## First publish

**`fast-jev-llm@0.1.0`** was created on npm with a manual `npm publish` (same
pattern as [llmstatus](https://www.npmjs.com/package/llmstatus)). Later versions
should use tags + OIDC only.

## Troubleshooting

| Error | Check |
| --- | --- |
| `ENEEDAUTH` / `401` | Trusted publisher repo/workflow/env must match **`Non-Plus` / `fast-jev-llm` / `release.yml` / `npm`**. |
| `404` on publish | Package must exist on npm under your account, or first publish was manual. |
| Tag/version mismatch | `vX.Y.Z` must match `cli/package.json`. |
| Waiting for approval | Approve **Environment `npm`** on the workflow run. |
| Version already exists | Bump version; npm rejects duplicate versions. |
| Provenance failed | Repo must be **public**; workflow needs `id-token: write`. |

## Manual fallback

Break-glass only — see [PUBLISHING_RULES.md](PUBLISHING_RULES.md).

```bash
pnpm install && pnpm build
cd cli && npm login && npm publish --access public --provenance
```
