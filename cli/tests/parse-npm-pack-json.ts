export interface NpmPackEntry {
  filename: string;
  files?: Array<{ path: string }>;
}

function extractBalancedJsonArray(stdout: string, start: number): string | null {
  if (stdout[start] !== "[") {
    return null;
  }
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < stdout.length; i++) {
    const ch = stdout[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "[") {
      depth++;
      continue;
    }
    if (ch === "]") {
      depth--;
      if (depth === 0) {
        return stdout.slice(start, i + 1);
      }
    }
  }
  return null;
}

function isNpmPackEntry(value: unknown): value is NpmPackEntry {
  if (!value || typeof value !== "object") {
    return false;
  }
  const filename = (value as NpmPackEntry).filename;
  return typeof filename === "string" && filename.endsWith(".tgz");
}

/** npm pack --json may prefix lifecycle logs, stray `[]`, or suffix notices on stdout (CI). */
export function parseNpmPackJson(stdout: string): NpmPackEntry[] {
  let searchFrom = 0;
  while (searchFrom < stdout.length) {
    const start = stdout.indexOf("[", searchFrom);
    if (start < 0) {
      break;
    }
    const slice = extractBalancedJsonArray(stdout, start);
    if (!slice) {
      searchFrom = start + 1;
      continue;
    }
    try {
      const parsed = JSON.parse(slice) as unknown;
      if (Array.isArray(parsed) && parsed.length > 0 && isNpmPackEntry(parsed[0])) {
        return parsed as NpmPackEntry[];
      }
    } catch {
      // try next `[`
    }
    searchFrom = start + 1;
  }
  throw new Error("npm pack --json output did not contain a tarball manifest array");
}
