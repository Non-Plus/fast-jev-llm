export interface NpmPackEntry {
  filename: string;
  files?: Array<{ path: string }>;
}

type PackRecord = {
  filename?: string;
  name?: string;
  version?: string;
  files?: Array<{ path: string }>;
};

function extractBalancedJson(stdout: string, start: number, open: "[" | "{", close: "]" | "}"): string | null {
  if (stdout[start] !== open) {
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
    if (ch === open) {
      depth++;
      continue;
    }
    if (ch === close) {
      depth--;
      if (depth === 0) {
        return stdout.slice(start, i + 1);
      }
    }
  }
  return null;
}

function isPackRecord(value: unknown): value is PackRecord {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as PackRecord;
  if (typeof record.filename === "string" && record.filename.endsWith(".tgz")) {
    return true;
  }
  return typeof record.name === "string" && Array.isArray(record.files);
}

function normalizePackRecord(record: PackRecord): NpmPackEntry {
  const filename =
    record.filename ??
    (record.name && record.version ? `${record.name}-${record.version}.tgz` : undefined);
  if (!filename) {
    throw new Error("npm pack entry is missing filename");
  }
  return { filename, files: record.files };
}

function entriesFromParsed(parsed: unknown): NpmPackEntry[] | null {
  if (Array.isArray(parsed)) {
    if (parsed.length === 0 || !isPackRecord(parsed[0])) {
      return null;
    }
    return parsed.map((entry) => normalizePackRecord(entry as PackRecord));
  }
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  if (isPackRecord(parsed)) {
    return [normalizePackRecord(parsed as PackRecord)];
  }
  const values = Object.values(parsed as Record<string, unknown>);
  if (values.length > 0 && values.every(isPackRecord)) {
    return values.map((entry) => normalizePackRecord(entry as PackRecord));
  }
  return null;
}

function tryParsePackJsonSlice(slice: string): NpmPackEntry[] | null {
  try {
    return entriesFromParsed(JSON.parse(slice) as unknown);
  } catch {
    return null;
  }
}

/** npm pack --json output (array in npm ≤11, object keyed by name in npm ≥12). */
export function parseNpmPackJson(stdout: string, stderr = ""): NpmPackEntry[] {
  const combined = `${stdout}\n${stderr}`;
  const starts: Array<{ index: number; open: "[" | "{"; close: "]" | "}" }> = [];
  for (let i = 0; i < combined.length; i++) {
    const ch = combined[i];
    if (ch === "[") {
      starts.push({ index: i, open: "[", close: "]" });
    } else if (ch === "{") {
      starts.push({ index: i, open: "{", close: "}" });
    }
  }
  for (const { index, open, close } of starts) {
    const slice = extractBalancedJson(combined, index, open, close);
    if (!slice) {
      continue;
    }
    const entries = tryParsePackJsonSlice(slice);
    if (entries && entries.length > 0) {
      return entries;
    }
  }
  throw new Error("npm pack --json output did not contain a tarball manifest");
}
