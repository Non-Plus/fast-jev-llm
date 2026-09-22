# Safety

Shadow decisions are **estimates**.

**DROP means:** the engine believes this item could be removed.

**DROP does not mean:** the coding agent actually removed it.

V0.1 does not enable active context modification.

## Why some items are protected

- **User constraints** — dropping “don’t change the public API” silently
  is worse than extra tokens
- **Unresolved errors** — the current failure is still the task
- **Recent context** — the latest turns are usually still live
- **System / developer instructions** — treated as protected

Protected items cannot be DROPped. They may still be compressed when
compression is allowed.

## Fail-safe behavior

- Semantic classification defaults to **off**
- Provider failures fail open: keep the deterministic decision; never
  DROP because Jev timed out
- Hooks fail open (exit 0) so a broken analyzer cannot stop the agent
- Setup never overwrites an entire hooks file or removes unrelated hooks

## `unsafeDropCount`

Primary safety metric. A high reduction percentage with unsafe drops is
a failure, not a win.

## Remote semantic mode

Off unless the user explicitly opts in. Selected context may leave the
machine. The sensitive-content gate is conservative and **not** a
complete secret scanner.
