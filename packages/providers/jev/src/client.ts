import type {
  SemanticClassificationRequest,
  SemanticClassificationResult,
  SemanticProvider,
} from "@fast-jev/core";
import { toJevRequest, toSemanticResults, type JevSystemOneResponse } from "./map.js";

export interface JevSemanticProviderOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  retries?: number;
  fetchImpl?: typeof fetch;
  inputUsdPerMillion?: number;
}

const DEFAULT_BASE_URL = "https://api.typesafe.ai/v1/systemone";
const DEFAULT_MODEL = "jev-1.13.0";

export class JevSemanticProvider implements SemanticProvider {
  readonly name = "jev";
  readonly remote = true;
  readonly version: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly fetchImpl: typeof fetch;
  private readonly inputUsdPerMillion: number;

  constructor(options: JevSemanticProviderOptions) {
    if (!options.apiKey) {
      throw new Error("JevSemanticProvider requires an API key");
    }
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.version = options.model ?? DEFAULT_MODEL;
    this.timeoutMs = options.timeoutMs ?? 8000;
    this.retries = options.retries ?? 1;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.inputUsdPerMillion = options.inputUsdPerMillion ?? 0.042;
  }

  async classify(request: SemanticClassificationRequest): Promise<SemanticClassificationResult> {
    if (request.candidates.length === 0) {
      return { provider: this.name, providerVersion: this.version, decisions: [] };
    }
    const started = Date.now();
    const payload = toJevRequest(request, this.version);
    const response = await this.postWithRetry(payload);
    const latencyMs = Date.now() - started;
    const inputTokens = response.usage?.input_tokens;
    const outputTokens = response.usage?.output_tokens;
    const estimatedCost =
      inputTokens === undefined ? undefined : (inputTokens / 1_000_000) * this.inputUsdPerMillion;
    return {
      provider: this.name,
      providerVersion: response.model ?? this.version,
      decisions: toSemanticResults(request, response),
      usage: {
        requests: 1,
        latencyMs,
        ...(inputTokens !== undefined ? { inputTokens } : {}),
        ...(outputTokens !== undefined ? { outputTokens } : {}),
        ...(estimatedCost !== undefined ? { estimatedCost } : { estimatedCostUnavailable: true }),
      },
    };
  }

  private async postWithRetry(body: unknown): Promise<JevSystemOneResponse> {
    let lastError: unknown;
    const attempts = this.retries + 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await this.post(body);
      } catch (error) {
        lastError = error;
        if (!shouldRetry(error) || attempt === attempts - 1) {
          throw error;
        }
        await delay(200);
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Jev request failed");
  }

  private async post(body: unknown): Promise<JevSystemOneResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.baseUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        const error = new Error(`Jev HTTP ${response.status}`);
        (error as Error & { status?: number }).status = response.status;
        throw error;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        throw new Error("Jev invalid JSON");
      }
      if (!parsed || typeof parsed !== "object") {
        throw new Error("Jev invalid JSON");
      }
      return parsed as JevSystemOneResponse;
    } finally {
      clearTimeout(timer);
    }
  }
}

export function jevProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  overrides: Omit<JevSemanticProviderOptions, "apiKey"> = {},
): JevSemanticProvider | undefined {
  const apiKey = env.TYPESAFE_API_KEY ?? env.JEV_API_KEY;
  if (!apiKey) {
    return undefined;
  }
  return new JevSemanticProvider({
    apiKey,
    ...(env.JEV_BASE_URL ? { baseUrl: env.JEV_BASE_URL } : {}),
    ...(env.JEV_MODEL ? { model: env.JEV_MODEL } : {}),
    ...(env.JEV_TIMEOUT_MS && Number.isFinite(Number(env.JEV_TIMEOUT_MS))
      ? { timeoutMs: Number(env.JEV_TIMEOUT_MS) }
      : {}),
    ...overrides,
  });
}

function shouldRetry(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return true;
  }
  const status = (error as { status?: number }).status;
  if (status !== undefined && status < 500) {
    return false;
  }
  if (error instanceof Error && error.name === "AbortError") {
    return false;
  }
  if (error instanceof Error && error.message === "Jev invalid JSON") {
    return false;
  }
  return true;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
