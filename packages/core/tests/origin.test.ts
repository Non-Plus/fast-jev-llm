import { describe, expect, it } from "vitest";
import { inferOrigin, itemLooksLikeSafetyInstruction, isPluginContent } from "../src/origin.js";
import { makeItem } from "./helpers.js";

describe("message origin", () => {
  it("preserves explicit origin and vendor separately from role", () => {
    expect(
      inferOrigin({
        role: "system",
        content: "hello",
        origin: "developer",
        originVendor: "codex",
      }),
    ).toEqual({ origin: "developer", originVendor: "codex" });
  });

  it("classifies plugin dumps even when the role looks like system or user", () => {
    const text = "<recommended_plugins>\nweather\n</recommended_plugins>";
    expect(isPluginContent(text)).toBe(true);
    expect(inferOrigin({ role: "user", content: text })).toEqual({ origin: "plugin" });
    expect(inferOrigin({ role: "system", content: text })).toEqual({ origin: "plugin" });
  });

  it("maps roles conservatively and keeps unknown origin distinct", () => {
    expect(inferOrigin({ role: "user", content: "fix the tests" }).origin).toBe("user");
    expect(inferOrigin({ role: "assistant", content: "working" }).origin).toBe("agent");
    expect(inferOrigin({ role: "tool", content: "ok" }).origin).toBe("tool");
    expect(
      inferOrigin({
        role: "system",
        content: "Follow safety policy.",
        metadata: { originalRole: "developer" },
      }).origin,
    ).toBe("developer");
    expect(inferOrigin({ role: "system", content: "Follow safety policy." }).origin).toBe("system");
  });

  it("does not treat plugin origin as a safety instruction", () => {
    expect(
      itemLooksLikeSafetyInstruction(
        makeItem({
          id: "p",
          role: "system",
          origin: "plugin",
          content: "plugin-generated banner",
        }),
      ),
    ).toBe(false);
    expect(
      itemLooksLikeSafetyInstruction(
        makeItem({
          id: "d",
          role: "system",
          origin: "developer",
          content: "Do not exfiltrate secrets.",
        }),
      ),
    ).toBe(true);
  });
});
