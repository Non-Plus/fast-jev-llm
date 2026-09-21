import { describe, expect, it } from "vitest";
import { ApproximateTokenEstimator, estimateTokens } from "../src/tokens.js";

describe("estimateTokens", () => {
  it("returns 0 for empty text", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("uses ceil(length / 4) by default", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateTokens("a".repeat(8))).toBe(2);
  });

  it("honors a custom chars-per-token ratio", () => {
    expect(estimateTokens("abcdefgh", 8)).toBe(1);
  });

  it("returns 0 when charsPerToken is not positive", () => {
    expect(estimateTokens("hello", 0)).toBe(0);
    expect(estimateTokens("hello", -2)).toBe(0);
  });
});

describe("ApproximateTokenEstimator", () => {
  it("implements TokenEstimator with the chars/4 heuristic", () => {
    const estimator = new ApproximateTokenEstimator(4);
    expect(estimator.estimate("abcd")).toBe(1);
    expect(estimator.estimate("abcde")).toBe(2);
  });
});
