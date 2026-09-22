export interface NpmPackEntry {
  filename: string;
  files?: Array<{ path: string }>;
}

/** npm pack --json may prefix lifecycle logs or suffix notices on stdout (CI). */
export function parseNpmPackJson(stdout: string): NpmPackEntry[] {
  const start = stdout.indexOf("[");
  if (start < 0) {
    throw new Error("npm pack --json output did not contain a JSON array");
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
        return JSON.parse(stdout.slice(start, i + 1)) as NpmPackEntry[];
      }
    }
  }
  throw new Error("npm pack --json output contained an incomplete JSON array");
}
