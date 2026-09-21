import { posix } from "node:path";

export interface NormalizedPath {
  original: string;
  canonical?: string;
  outsideRepo: boolean;
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function toPosix(path: string): string {
  return path.replace(/\\/g, "/").trim();
}

/**
 * Resolve a path against the session cwd. Returns a project-relative POSIX
 * path only when the target stays inside the working directory.
 * Paths that escape the repo are left unmapped.
 */
export function normalizeProjectPath(
  rawPath: string | undefined,
  cwd: string | undefined,
): NormalizedPath | undefined {
  if (typeof rawPath !== "string" || rawPath.trim().length === 0) {
    return undefined;
  }
  const original = stripQuotes(toPosix(rawPath));
  if (original.length === 0) {
    return undefined;
  }
  if (!cwd || cwd.trim().length === 0) {
    const canonical = posix.normalize(original).replace(/^\.\//, "");
    return {
      original,
      canonical: canonical.startsWith("../") ? undefined : canonical,
      outsideRepo: canonical.startsWith("../") || posix.isAbsolute(canonical),
    };
  }

  const cwdPosix = posix.normalize(toPosix(cwd));
  const absolute = posix.isAbsolute(original)
    ? posix.normalize(original)
    : posix.normalize(posix.join(cwdPosix, original));
  const relative = posix.relative(cwdPosix, absolute);

  if (relative === "") {
    return { original, canonical: ".", outsideRepo: false };
  }
  if (relative.startsWith("..") || posix.isAbsolute(relative)) {
    return { original, outsideRepo: true };
  }
  return { original, canonical: relative, outsideRepo: false };
}

export function preferCanonicalPath(normalized: NormalizedPath | undefined): string | undefined {
  if (!normalized) {
    return undefined;
  }
  if (normalized.outsideRepo) {
    return normalized.original;
  }
  return normalized.canonical ?? normalized.original;
}
