import { chmod, copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(root, "..");
const outfile = join(root, "dist", "ctx.js");

await mkdir(join(root, "dist"), { recursive: true });

await esbuild.build({
  absWorkingDir: root,
  entryPoints: [join(root, "src", "index.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile,
  banner: {
    js: "#!/usr/bin/env node",
  },
  packages: "bundle",
  alias: {
    "@fast-jev/core": join(repo, "packages/core/src/index.ts"),
    "@fast-jev/adapter-codex": join(repo, "packages/adapter-codex/src/index.ts"),
    "@fast-jev/adapter-cursor": join(repo, "packages/adapter-cursor/src/index.ts"),
    "@fast-jev/adapter-claude": join(repo, "packages/adapter-claude/src/index.ts"),
    "@fast-jev/provider-jev": join(repo, "packages/providers/jev/src/index.ts"),
    "@fast-jev/local": join(repo, "packages/local/src/index.ts"),
  },
  logLevel: "info",
});

await chmod(outfile, 0o755);
for (const name of ["README.md", "LICENSE", "CHANGELOG.md"]) {
  await copyFile(join(repo, name), join(root, name));
}
