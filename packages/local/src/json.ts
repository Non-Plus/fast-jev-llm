export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function countCommands(value: unknown): number {
  if (!value) {
    return 0;
  }
  if (Array.isArray(value)) {
    return value.reduce((sum: number, entry) => sum + countCommands(entry), 0);
  }
  if (isRecord(value)) {
    const self = typeof value.command === "string" ? 1 : 0;
    return self + Object.values(value).reduce<number>((sum, entry) => sum + countCommands(entry), 0);
  }
  return 0;
}
