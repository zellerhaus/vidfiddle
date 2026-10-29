import Anthropic from "@anthropic-ai/sdk";

type LLMProvider = "anthropic" | "openai";

interface CompleteParams {
  system: string;
  prompt: string;
  maxTokens: number;
}

interface OpenAIResponseContentPart {
  type?: string;
  text?: string;
}

interface OpenAIResponseOutputItem {
  type?: string;
  content?: OpenAIResponseContentPart[];
}

interface OpenAIResponsesBody {
  output?: OpenAIResponseOutputItem[];
}

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5-5";
const DEFAULT_OPENAI_MODEL = "gpt-6.1-terra";
const MAX_OPENAI_ATTEMPTS = 5;
const OPENAI_BASE_BACKOFF_MS = 500;

function normalizeProvider(value: string | undefined): LLMProvider | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "anthropic" || normalized === "openai") {
    return normalized;
  }

  return null;
}

function resolveProvider(): LLMProvider | null {
  const explicitProvider = normalizeProvider(process.env.LLM_PROVIDER);
  if (explicitProvider) {
    return explicitProvider;
  }

  if (process.env.LLM_PROVIDER?.trim()) {
    return null;
  }

  if (process.env.ANTHROPIC_API_KEY) {
    return "anthropic";
  }

  if (process.env.OPENAI_API_KEY) {
    return "openai";
  }

  return null;
}

function getProviderForRequest(): LLMProvider {
  if (process.env.LLM_PROVIDER?.trim() && !normalizeProvider(process.env.LLM_PROVIDER)) {
    throw new Error(
      `Invalid LLM_PROVIDER value "${process.env.LLM_PROVIDER}". Expected "anthropic" or "openai".`
    );
  }

  const provider = resolveProvider();
  if (!provider) {
    throw new Error(
      "No LLM provider configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY, or set LLM_PROVIDER explicitly."
    );
  }

  return provider;
}

function getAnthropicModel(): string {
  return process.env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL;
}

function getOpenAIModel(): string {
  return process.env.OPENAI_TEXT_MODEL || DEFAULT_OPENAI_MODEL;
}

function parseRetryAfterMs(retryAfterHeader: string | null): number | null {
  if (!retryAfterHeader) {
    return null;
  }

  const retryAfterSeconds = Number(retryAfterHeader);
  if (Number.isFinite(retryAfterSeconds)) {
    return Math.max(0, Math.round(retryAfterSeconds * 1000));
  }

  const retryAfterDateMs = Date.parse(retryAfterHeader);
  if (Number.isNaN(retryAfterDateMs)) {
    return null;
  }

  return Math.max(0, retryAfterDateMs - Date.now());
}

function getResponseSnippet(text: string): string {
  return text.slice(0, 300);
}

function getOpenAIErrorCode(responseBody: string): string | null {
  try {
    const parsed = JSON.parse(responseBody) as {
      error?: { code?: unknown; type?: unknown };
    };

    if (typeof parsed.error?.code === "string") {
      return parsed.error.code;
    }

    if (typeof parsed.error?.type === "string") {
      return parsed.error.type;
    }
  } catch {
    return null;
  }

  return null;
}

function shouldRetryOpenAI(status: number, responseBody: string): boolean {
  if (status === 429) {
    return getOpenAIErrorCode(responseBody) !== "insufficient_quota";
  }

  return status >= 500 && status < 600;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function completeWithAnthropic({
  system,
  prompt,
  maxTokens,
}: CompleteParams): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is required when using the Anthropic provider.");
  }

  const message = await anthropic.messages.create({
    model: getAnthropicModel(),
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = message.content.find((item) => item.type === "text");
  if (!textBlock) {
    throw new Error("Anthropic response did not include text content.");
  }

  return textBlock.text;
}

function extractOpenAIOutputText(responseBody: OpenAIResponsesBody): string | null {
  if (!Array.isArray(responseBody.output)) {
    return null;
  }

  for (const item of responseBody.output) {
    if (item.type !== "message" || !Array.isArray(item.content)) {
      continue;
    }

    for (const part of item.content) {
      if (part.type === "output_text" && typeof part.text === "string") {
        return part.text;
      }
    }
  }

  return null;
}

async function completeWithOpenAI({
  system,
  prompt,
  maxTokens,
}: CompleteParams): Promise<string> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required when using the OpenAI provider.");
  }

  for (let attempt = 1; attempt <= MAX_OPENAI_ATTEMPTS; attempt++) {
    const response = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: getOpenAIModel(),
        instructions: system,
        input: prompt,
        max_output_tokens: maxTokens,
      }),
      signal: AbortSignal.timeout(120_000),
    });

    const responseText = await response.text();

    if (response.ok) {
      let parsed: OpenAIResponsesBody;
      try {
        parsed = JSON.parse(responseText) as OpenAIResponsesBody;
      } catch {
        throw new Error(
          `OpenAI responses API error (${response.status}): ${getResponseSnippet(responseText)}`
        );
      }

      const outputText = extractOpenAIOutputText(parsed);
      if (!outputText) {
        throw new Error(
          `OpenAI responses API error (${response.status}): ${getResponseSnippet(responseText)}`
        );
      }

      return outputText;
    }

    const shouldRetry = shouldRetryOpenAI(response.status, responseText);
    if (!shouldRetry || attempt >= MAX_OPENAI_ATTEMPTS) {
      throw new Error(
        `OpenAI responses API error (${response.status}): ${getResponseSnippet(responseText)}`
      );
    }

    const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
    const fallbackBackoffMs = OPENAI_BASE_BACKOFF_MS * 2 ** (attempt - 1);
    await sleep(retryAfterMs ?? fallbackBackoffMs);
  }

  throw new Error("OpenAI request failed after retry attempts.");
}

export async function complete(params: CompleteParams): Promise<string> {
  const provider = getProviderForRequest();

  if (provider === "anthropic") {
    return completeWithAnthropic(params);
  }

  return completeWithOpenAI(params);
}

export function isLLMConfigured(): boolean {
  const provider = resolveProvider();
  if (!provider) {
    return false;
  }

  return provider === "anthropic"
    ? Boolean(process.env.ANTHROPIC_API_KEY)
    : Boolean(process.env.OPENAI_API_KEY);
}

export function llmProviderName(): LLMProvider | null {
  return resolveProvider();
}
