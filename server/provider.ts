import {
  friendlyProviderError,
  retryDelaySeconds,
  shouldReduceMaxTokens,
} from "../src/shared/provider-errors";
import { usageNoteFromResponse } from "../src/shared/rate-limits";
import { listCuratedModels, pickDefaultModel, type ModelProviderId } from "../src/shared/sheet-models";
import { describeLmFailure, lmFailureDetail, modelIdsFromList } from "./lm-status";
import { modelReplyText } from "./model-reply";

function listCuratedModelsForPayload(models: string[], provider: ModelProviderId): string[] {
  return listCuratedModels(models, provider);
}

export type ProviderModelsPayload = {
  models: string[];
  defaultModel?: string;
  curatedModels?: string[];
  error?: string;
  usageNote?: string;
};

export {
  filterSheetModels,
  isCuratedSheetModel,
  isDeprioritizedSheetModel,
  listCuratedModels,
  modelOptionLabel,
  pickDefaultModel,
  shouldAutoSwitchModel,
} from "../src/shared/sheet-models";

export type ProviderId = "ollama" | "gemini" | "groq";

export interface StoredSettings {
  provider: ProviderId;
  model: string;
  keys: { gemini: string; groq: string };
}

export interface PublicSettings {
  provider: ProviderId;
  providerLabel: string;
  model: string;
  keyConfigured: boolean;
  keyHint: string;
}

export interface ChatInput {
  messages?: unknown;
  temperature?: number;
  max_tokens?: number;
  response_format?: unknown;
}

const PROVIDERS: Record<ProviderId, { label: string; base: () => string }> = {
  ollama: { label: "Ollama", base: () => process.env.OLLAMA_URL ?? "http://127.0.0.1:11434/v1" },
  gemini: { label: "Gemini", base: () => "https://generativelanguage.googleapis.com/v1beta/openai" },
  groq: { label: "Groq", base: () => "https://api.groq.com/openai/v1" },
};

export function isProviderId(value: unknown): value is ProviderId {
  return value === "ollama" || value === "gemini" || value === "groq";
}

export function providerLabel(provider: ProviderId): string {
  return PROVIDERS[provider].label;
}

export function providerBase(provider: ProviderId): string {
  return PROVIDERS[provider].base().replace(/\/$/, "");
}

export function defaultSettings(): StoredSettings {
  return { provider: "ollama", model: "", keys: { gemini: "", groq: "" } };
}

export function normalizeStored(value: unknown): StoredSettings {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const keys = raw.keys && typeof raw.keys === "object" ? raw.keys as Record<string, unknown> : {};
  return {
    provider: isProviderId(raw.provider) ? raw.provider : "ollama",
    model: typeof raw.model === "string" ? raw.model.trim() : "",
    keys: {
      gemini: typeof keys.gemini === "string" ? keys.gemini : "",
      groq: typeof keys.groq === "string" ? keys.groq : "",
    },
  };
}

export function applySettingsUpdate(current: StoredSettings, update: { provider?: unknown; model?: unknown; apiKey?: unknown }): StoredSettings {
  const provider = isProviderId(update.provider) ? update.provider : current.provider;
  const providerChanged = provider !== current.provider;
  let model = current.model;
  if (typeof update.model === "string") model = update.model.trim();
  else if (providerChanged) model = "";
  const keys = { ...current.keys };
  if ((provider === "gemini" || provider === "groq") && typeof update.apiKey === "string" && update.apiKey.trim()) {
    keys[provider] = update.apiKey.trim();
  }
  return { provider, model, keys };
}

export function toPublic(settings: StoredSettings): PublicSettings {
  const key = settings.provider === "ollama" ? "" : settings.keys[settings.provider];
  return {
    provider: settings.provider,
    providerLabel: providerLabel(settings.provider),
    model: settings.model,
    keyConfigured: key.length > 0,
    keyHint: key.length >= 4 ? key.slice(-4) : "",
  };
}

export function chatBody(provider: ProviderId, input: ChatInput & { model: string }): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: input.model,
    messages: input.messages,
    temperature: input.temperature ?? 0.1,
    max_tokens: input.max_tokens ?? 1200,
    stream: false,
  };
  if (input.response_format !== undefined) body.response_format = input.response_format;
  if (provider === "ollama") body.reasoning_effort = "none";
  if (provider === "groq" || provider === "gemini") {
    const cap = provider === "groq" ? 900 : 1024;
    body.max_tokens = Math.min(Number(body.max_tokens) || cap, cap);
  }
  return body;
}

export async function listProviderModels(
  settings: StoredSettings,
  fetchImpl: typeof fetch = fetch,
): Promise<{ status: number; payload: ProviderModelsPayload }> {
  const label = providerLabel(settings.provider);
  const missing = missingKey(settings);
  if (missing) return { status: 400, payload: { models: [], error: missing } };
  const base = providerBase(settings.provider);
  try {
    const response = await fetchImpl(`${base}/models`, { headers: requestHeaders(settings) });
    const text = await response.text();
    const usageNote = usageNoteFromResponse(response);
    if (!response.ok) {
      return {
        status: response.status,
        payload: { models: [], error: httpFailure(label, response.status, "/v1/models", text, false), ...(usageNote ? { usageNote } : {}) },
      };
    }
    const models = modelIdsFromList(parseJson(text) as { data?: { id?: string }[] });
    if (models.length === 0) {
      return {
        status: 200,
        payload: {
          models,
          error: `Model not found at ${base}. GET /v1/models returned no model IDs.`,
          ...(usageNote ? { usageNote } : {}),
        },
      };
    }
    return {
      status: 200,
      payload: {
        models,
        defaultModel: pickDefaultModel(models, settings.provider) || undefined,
        curatedModels: listCuratedModelsForPayload(models, settings.provider),
        ...(usageNote ? { usageNote } : {}),
      },
    };
  } catch (error) {
    return { status: 503, payload: { models: [], error: lmFailureDetail(error, base, label) } };
  }
}

export async function completeWithProvider(
  settings: StoredSettings,
  input: ChatInput,
  fetchImpl: typeof fetch = fetch,
  options?: { sleep?: (ms: number) => Promise<void> },
): Promise<{ status: number; payload: { content?: string; error?: string; schemaRejected?: boolean; usageNote?: string } }> {
  const label = providerLabel(settings.provider);
  const base = providerBase(settings.provider);
  const missing = missingKey(settings);
  if (missing) return { status: 400, payload: { error: `${missing} The sheet was not changed.` } };
  if (!settings.model.trim()) {
    return { status: 400, payload: { error: `Choose ${article(label)} ${label} model. The sheet was not changed.` } };
  }
  const sleepFn = options?.sleep ?? sleep;
  let maxTokens = input.max_tokens;
  let lastUsage: { usageNote?: string } = {};
  try {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const body = chatBody(settings.provider, { ...input, model: settings.model, max_tokens: maxTokens });
      const response = await fetchImpl(`${base}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...requestHeaders(settings) },
        body: JSON.stringify(body),
      });
      const text = await response.text();
      const usageNote = usageNoteFromResponse(response);
      lastUsage = usageNote ? { usageNote } : {};
      if (!response.ok) {
        const schemaRejected = Boolean(input.response_format) && isSchemaRejection(response.status, text);
        if (schemaRejected) {
          return {
            status: 400,
            payload: {
              error: httpFailure(label, response.status, "/v1/chat/completions", text, true),
              schemaRejected: true,
              ...lastUsage,
            },
          };
        }
        if (shouldReduceMaxTokens(response.status, text) && Number(body.max_tokens) > 256) {
          maxTokens = Math.max(256, Math.floor(Number(body.max_tokens) * 0.5));
          continue;
        }
        const delay = response.status === 429 ? retryDelaySeconds(text, response.headers.get("retry-after")) : 0;
        if (delay > 0 && attempt < 3) {
          await sleepFn(delay * 1000);
          continue;
        }
        return {
          status: response.status,
          payload: {
            error: httpFailure(label, response.status, "/v1/chat/completions", text, true),
            schemaRejected: false,
            ...lastUsage,
          },
        };
      }
      let json: { choices?: { message?: { content?: unknown; reasoning_content?: unknown; reasoning?: unknown; thinking?: unknown } }[] };
      try {
        json = parseJson(text) as typeof json;
      } catch {
        return { status: 502, payload: { error: `${label} returned a response that was not JSON. The sheet was not changed.` } };
      }
      const content = modelReplyText(json.choices?.[0]?.message);
      if (!content) return { status: 502, payload: { error: `${label} returned no message. The sheet was not changed.`, ...lastUsage } };
      return { status: 200, payload: { content, ...lastUsage } };
    }
    return { status: 429, payload: { error: `${label}: rate limit persisted after retries. The sheet was not changed.`, ...lastUsage } };
  } catch (error) {
    return { status: 503, payload: { error: describeLmFailure(error, base, label) } };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function article(label: string): string {
  return /^[aeiou]/i.test(label) ? "an" : "a";
}

function missingKey(settings: StoredSettings): string | null {
  if (settings.provider === "ollama") return null;
  if (settings.keys[settings.provider].trim()) return null;
  return `Add a ${providerLabel(settings.provider)} API key.`;
}

function requestHeaders(settings: StoredSettings): Record<string, string> {
  if (settings.provider === "ollama") return {};
  return { Authorization: `Bearer ${settings.keys[settings.provider]}` };
}

export function httpFailure(label: string, status: number, path: string, body: string, sheet: boolean): string {
  const friendly = friendlyProviderError(label, status, body);
  if (friendly) return sheet ? `${friendly} The sheet was not changed.` : friendly;
  const detail = body.trim().slice(0, 500);
  const statusText = `${label} returned HTTP ${status} for ${path}.`;
  const head = detail ? `${statusText} ${detail}` : statusText;
  return sheet ? `${head} The sheet was not changed.` : head;
}

function isSchemaRejection(status: number, body: string): boolean {
  if (status === 422) return true;
  if (status === 400) return /schema|grammar|response_format|structured/i.test(body);
  return false;
}

function parseJson(text: string): unknown {
  return JSON.parse(text) as unknown;
}
