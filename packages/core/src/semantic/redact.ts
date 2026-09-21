const REPLACERS: Array<{ kind: string; re: RegExp }> = [
  { kind: "private_key_block", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { kind: "aws_access_key", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { kind: "github_token", re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/g },
  { kind: "github_pat", re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  { kind: "slack_token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { kind: "openai_key", re: /\bsk-[A-Za-z0-9]{20,}\b/g },
  { kind: "jwt", re: /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { kind: "authorization_header", re: /(\bAuthorization:\s*(?:Bearer|Basic)\s+)\S+/gi },
  { kind: "password_assignment", re: /(\b(?:password|passwd|pwd)\s*[=:]\s*['"]?)[^\s'"]{6,}/gi },
  { kind: "api_key_assignment", re: /(\b(?:api[_-]?key|access[_-]?token|secret[_-]?key)\s*[=:]\s*['"]?)[^\s'"]{8,}/gi },
  {
    kind: "connection_string",
    re: /\b((?:postgres|postgresql|mysql|mongodb|redis|mssql):\/\/[^:\s]+:)[^@\s]+(@)/gi,
  },
];

export function redactForRemote(text: string): { text: string; redactionsApplied: number } {
  let output = text;
  let redactionsApplied = 0;
  for (const replacer of REPLACERS) {
    output = output.replace(replacer.re, (...args) => {
      redactionsApplied += 1;
      if (replacer.kind === "authorization_header" || replacer.kind === "password_assignment" || replacer.kind === "api_key_assignment") {
        return `${args[1]}***`;
      }
      if (replacer.kind === "connection_string") {
        return `${args[1]}***${args[2]}`;
      }
      return "***";
    });
  }
  return { text: output, redactionsApplied };
}
