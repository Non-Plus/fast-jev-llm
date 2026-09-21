export interface SensitiveMatch {
  kind: string;
  /** Never includes the secret value. */
  field: string;
}

const PATTERNS: Array<{ kind: string; re: RegExp }> = [
  { kind: "private_key", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { kind: "aws_access_key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { kind: "github_token", re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/ },
  { kind: "github_pat", re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/ },
  { kind: "slack_token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { kind: "openai_key", re: /\bsk-[A-Za-z0-9]{20,}\b/ },
  { kind: "jwt", re: /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { kind: "authorization_header", re: /\bAuthorization:\s*(?:Bearer|Basic)\s+\S+/i },
  { kind: "password_assignment", re: /\b(?:password|passwd|pwd)\s*[=:]\s*['"]?[^\s'"]{6,}/i },
  { kind: "api_key_assignment", re: /\b(?:api[_-]?key|access[_-]?token|secret[_-]?key)\s*[=:]\s*['"]?[^\s'"]{8,}/i },
  { kind: "connection_string", re: /\b(?:postgres|postgresql|mysql|mongodb|redis|mssql):\/\/[^\s]+:[^\s]+@/i },
];

const ENV_LINE_RE = /^(?:export\s+)?[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASS|CREDENTIAL)[A-Z0-9_]*\s*=\s*\S+/im;

export function detectSensitiveContent(text: string, path?: string): SensitiveMatch[] {
  const matches: SensitiveMatch[] = [];
  if (path && /(^|[\\/])\.env(?:\..+)?$/.test(path)) {
    matches.push({ kind: "dotenv_file", field: "path" });
  }
  for (const pattern of PATTERNS) {
    if (pattern.re.test(text)) {
      matches.push({ kind: pattern.kind, field: "content" });
    }
  }
  if (ENV_LINE_RE.test(text)) {
    matches.push({ kind: "env_assignment", field: "content" });
  }
  return matches;
}

export function looksSensitive(text: string, path?: string): boolean {
  return detectSensitiveContent(text, path).length > 0;
}
