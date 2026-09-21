export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Object.isFrozen(value)) {
    return value;
  }

  Object.freeze(value);

  for (const key of Object.getOwnPropertyNames(value)) {
    const child = (value as Record<string, unknown>)[key];
    if (child && typeof child === "object") {
      deepFreeze(child);
    }
  }

  return value;
}

export function snapshot(value: unknown): string {
  return JSON.stringify(value);
}
