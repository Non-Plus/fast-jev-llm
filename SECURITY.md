# Security Policy

Do **not** open a public issue that includes:

- API keys, tokens, or passwords
- proprietary source
- real coding-agent transcripts
- hook configs that contain secrets

## Report privately

Use GitHub **Security Advisories** on this repository:

https://github.com/Non-Plus/fast-jev-llm/security/advisories/new

Do not open a public issue for secret leakage or sensitive transcripts.

Please include:

- a short description of the issue
- affected version / commit
- steps to reproduce with **synthetic** fixtures
- impact (secret leakage, unsafe DROP, hook corruption, remote-provider
  over-sharing, unexpected command execution)

## What to report

- Secret leakage in reports, logs, or the npm package
- Unsafe context deletion recommendations (`unsafeDropCount`, protected items)
- Hook configuration corruption or overwrite of unrelated hooks
- Remote semantic mode sending more than documented
- Command execution from hooks beyond the intended `ctx hook …` invocation

## What this project does not do (V0.1)

Shadow mode does not modify agent context. A DROP decision is an
estimate, not a live deletion.

Sensitive-content gating for remote providers is best-effort, not a
full secret scanner.
