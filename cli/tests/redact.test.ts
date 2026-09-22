import { describe, expect, it } from "vitest";
import { sanitizeDebug, sanitizeErrorMessage } from "../src/redact.ts";

describe("sanitizeErrorMessage", () => {
  it("redacts credential-shaped values without echoing them", () => {
    const message = sanitizeErrorMessage(new Error("failed Bearer secret-token-value"));
    expect(message).toContain("[redacted]");
    expect(message).not.toContain("secret-token-value");
  });

  it("replaces HOME with ~", () => {
    const home = process.env.HOME;
    if (!home) {
      return;
    }
    const message = sanitizeErrorMessage(new Error(`read ${home}/project`));
    expect(message).toContain("~/project");
    expect(message).not.toContain(home);
  });
});

describe("sanitizeDebug", () => {
  it("redacts credentials in stack traces", () => {
    const text = sanitizeDebug(new Error("Authorization Bearer secret-token-value"));
    expect(text).not.toContain("secret-token-value");
  });
});
