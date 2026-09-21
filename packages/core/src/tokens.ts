export function estimateTokens(text: string, charsPerToken = 4): number {
  if (text.length === 0 || charsPerToken <= 0) {
    return 0;
  }
  return Math.ceil(text.length / charsPerToken);
}
