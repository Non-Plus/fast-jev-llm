import { describe, expect, it } from "vitest";
import { parseNpmPackJson } from "./parse-npm-pack-json.ts";

describe("parseNpmPackJson", () => {
  it("parses the pack array when npm appends notices after the closing bracket", () => {
    const stdout = [
      "npm info lifecycle fast-jev-llm@0.1.0~prepack",
      "[",
      '  { "filename": "fast-jev-llm-0.1.0.tgz", "files": [] }',
      "]",
      "npm notice package size: 76.1 kB",
    ].join("\n");
    const parsed = parseNpmPackJson(stdout);
    expect(parsed[0]?.filename).toBe("fast-jev-llm-0.1.0.tgz");
  });

  it("skips a stray empty array before the pack manifest (Linux CI npm)", () => {
    const stdout = [
      "npm info ok",
      "[]",
      "[",
      '  { "filename": "fast-jev-llm-0.1.0.tgz", "files": [{ "path": "package.json" }] }',
      "]",
    ].join("\n");
    const parsed = parseNpmPackJson(stdout);
    expect(parsed[0]?.filename).toBe("fast-jev-llm-0.1.0.tgz");
    expect(parsed[0]?.files?.[0]?.path).toBe("package.json");
  });

  it("parses npm 12 object output keyed by package name", () => {
    const stdout = JSON.stringify({
      "fast-jev-llm": {
        filename: "fast-jev-llm-0.1.0.tgz",
        files: [{ path: "package.json" }],
      },
    });
    const parsed = parseNpmPackJson(stdout);
    expect(parsed[0]?.filename).toBe("fast-jev-llm-0.1.0.tgz");
  });

  it("reads manifest from stderr when lifecycle banners use stderr", () => {
    const stderr = [
      "> fast-jev-llm@0.1.0 prepack",
      "> node scripts/build.mjs",
      "",
      JSON.stringify({
        "fast-jev-llm": {
          filename: "fast-jev-llm-0.1.0.tgz",
          files: [{ path: "dist/ctx.js" }],
        },
      }),
    ].join("\n");
    const parsed = parseNpmPackJson("", stderr);
    expect(parsed[0]?.files?.[0]?.path).toBe("dist/ctx.js");
  });
});
