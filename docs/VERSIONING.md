# Versioning

Public releases follow [Semantic Versioning](https://semver.org/).

The first public release is **0.1.0**.

## 0.x

While the major version is 0:

- the CLI surface, config file, and hook command may evolve
- treat undocumented exports as unsupported

The **report schema** is versioned independently (`schemaVersion` in each
local report, currently `1`). A new report schema does not always bump the
npm package major version, but a package major version may still ship a new
report schema.

## Public API (V0.1)

CLI only. Internal workspace packages (`@fast-jev/*`) are private and are
not a supported library API.
