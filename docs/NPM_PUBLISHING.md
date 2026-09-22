# npm publishing (CI/CD)

The **`fast-jev-llm`** package is published from GitHub Actions when you push a
version tag. Ordinary pushes to `main` do **not** publish.

## One-time setup on npmjs.com

1. Sign in at [npmjs.com](https://www.npmjs.com/) as an account that can publish
   **`fast-jev-llm`**.

2. Open **Packages → fast-jev-llm → Settings → Trusted publishing** (after the
   package exists on npm).

3. Add a **GitHub Actions** trusted publisher with **exact** values:

   | Field | Value |
   | --- | --- |
   | Organization or user | `Non-Plus` |
   | Repository | `fast-jev-llm` |
   | Workflow filename | `release.yml` |
   | Environment name (optional) | `npm` |

   Allow **`npm publish`**.

4. **Recommended:** **Settings → Publishing access** → require 2FA and
   **disallow tokens** once OIDC publish works.

5. No **`NPM_TOKEN`** secret is required when trusted publishing is configured.

## One-time setup on GitHub

1. Create environment **`npm`**:

   **Settings → Environments → New environment → `npm`**

   Optional: required reviewers before publish.

2. **Provenance** on npm requires a **public** GitHub repository. While this
   repo is private, publish may succeed without provenance attestations.

## Release flow

1. Bump `cli/package.json` `version` and `packages/local/src/release-version.ts`.
2. Update `CHANGELOG.md`.
3. Merge to `main`.
4. Tag and push:

   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```

5. **Release** workflow runs lint, test, build, and `npm publish`.

6. Create a GitHub Release from `docs/RELEASE_NOTES_v0.1.0.md`.

## First publish

If the package name is not on npm yet, either:

- publish **`0.1.0`** once manually with `npm login` and 2FA, then add trusted
  publishing for later tags, or

- use npm’s trusted-publisher flow for a new package if your account supports it.

See [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md).

## Troubleshooting

| Error | Check |
| --- | --- |
| `ENEEDAUTH` | Workflow filename on npm must be **`release.yml`**. |
| Tag/version mismatch | `vX.Y.Z` must match `cli/package.json`. |
| Environment missing | Create GitHub environment **`npm`** or remove `environment: npm` from the workflow. |
| Provenance failed | GitHub repo may be **private**. |

## Manual fallback

```bash
pnpm install && pnpm build
cd cli && npm login && npm publish --access public
```
