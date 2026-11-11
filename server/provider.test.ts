import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { pickDefaultModel } from "../src/shared/sheet-models";
import {
  applySettingsUpdate,
  chatBody,
  completeWithProvider,
  defaultSettings,
  httpFailure,
  listProviderModels,
  toPublic,
  type StoredSettings,
} from "./provider";
import { readSettings, updateSettings, writeSettings } from "./settings-store";

const secret = "gemini-live-key-ZX81";
const groqSecret = "groq-live-key-Q9P2";

function settings(patch: Partial<StoredSettings> & { provider?: StoredSettings["provider"] } = {}): StoredSettings {
  return {
    ...defaultSettings(),
    ...patch,
    keys: { gemini: "", groq: "", ...patch.keys },
  };
}

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });
}

const groqRateHeaders = {
  "x-ratelimit-remaining-requests": "100",
  "x-ratelimit-limit-requests": "14400",
  "x-ratelimit-reset-requests": "1h",
  "x-ratelimit-remaining-tokens": "8000",
  "x-ratelimit-limit-tokens": "18000",
  "x-ratelimit-reset-tokens": "10s",
};

function refused(code: "ECONNREFUSED" | "ENOTFOUND"): typeof fetch {
  return (async () => {
    const error = new TypeError("fetch failed");
    (error as TypeError & { cause?: unknown }).cause = { code, message: code };
    throw error;
  }) as typeof fetch;
}

const calls: { url: string; init?: RequestInit }[] = [];

afterEach(() => {
  calls.length = 0;
});

function recording(status: number, body: unknown, headers?: Record<string, string>): typeof fetch {
  return (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return jsonResponse(status, body, headers);
  }) as typeof fetch;
}

describe("provider settings", () => {
  it("hides the raw API key and keeps only a short hint", () => {
    const stored = applySettingsUpdate(defaultSettings(), { provider: "gemini", model: "gemini-3.8-flash", apiKey: secret });
    const pub = toPublic(stored);
    expect(JSON.stringify(pub)).not.toContain(secret);
    expect(JSON.stringify(pub)).not.toContain("gemini-live-key");
    expect(pub.keyHint).toBe("ZX81");
    expect(pub.keyConfigured).toBe(true);
    expect(pub.model).toBe("gemini-3.8-flash");
  });

  it("keeps a saved key when the new key is blank and clears the model when the provider changes", () => {
    const stored = applySettingsUpdate(defaultSettings(), { provider: "gemini", model: "gemini-3.8-flash", apiKey: secret });
    const kept = applySettingsUpdate(stored, { provider: "gemini", apiKey: "   " });
    expect(kept.keys.gemini).toBe(secret);
    const switched = applySettingsUpdate(stored, { provider: "groq" });
    expect(switched.provider).toBe("groq");
    expect(switched.model).toBe("");
    expect(switched.keys.gemini).toBe(secret);
    expect(switched.keys.groq).toBe("");
  });

  it("stores keys on disk and still omits them from the public settings", async () => {
    const file = path.join(process.cwd(), "server", ".test-tmp", `model-settings-${Date.now()}.json`);
    const stored = applySettingsUpdate(defaultSettings(), { provider: "groq", model: "llama-3.3-70b", apiKey: groqSecret });
    await writeSettings(stored, file);
    const read = await readSettings(file);
    expect(read.keys.groq).toBe(groqSecret);
    expect(JSON.stringify(toPublic(read))).not.toContain(groqSecret);
    const updated = await updateSettings({ provider: "groq", model: "llama-3.3-70b", apiKey: "" }, file);
    expect(updated.keys.groq).toBe(groqSecret);
  });
});

describe("provider requests", () => {
  it("does not call the network when Gemini or Groq has no key", async () => {
    const fetchImpl = (async () => {
      throw new Error("network was called");
    }) as typeof fetch;
    const gemini = await listProviderModels(settings({ provider: "gemini" }), fetchImpl);
    const groq = await completeWithProvider(settings({ provider: "groq", model: "llama-3.3-70b" }), { messages: [] }, fetchImpl);
    expect(gemini.status).toBe(400);
    expect(gemini.payload.error).toMatch(/Add a Gemini API key/);
    expect(groq.status).toBe(400);
    expect(groq.payload.error).toMatch(/Add a Groq API key/);
    expect(groq.payload.error).toMatch(/sheet was not changed/);
  });

  it("asks for a model instead of guessing the first id", async () => {
    const fetchImpl = (async () => {
      throw new Error("network was called");
    }) as typeof fetch;
    const result = await completeWithProvider(settings({ provider: "ollama" }), { messages: [] }, fetchImpl);
    expect(result.status).toBe(400);
    expect(result.payload.error).toMatch(/Choose an Ollama model/);
  });

  it.each([
    [401, "invalid api key", /invalid or expired/],
    [403, "permission denied", /access denied \(HTTP 403\)/],
    [404, "model missing", /model not found/],
    [429, "rate limit", /rate limit reached/],
  ])("reports HTTP %s from Gemini without changing the sheet", async (status, detail, pattern) => {
    const result = await completeWithProvider(
      settings({ provider: "gemini", model: "gemini-3.8-flash", keys: { gemini: secret, groq: "" } }),
      { messages: [{ role: "user", content: "Set A1" }], response_format: { type: "json_schema" } },
      recording(status, detail),
    );
    expect(result.status).toBe(status);
    expect(result.payload.schemaRejected).toBe(false);
    expect(result.payload.error).toMatch(pattern);
    if (status === 404) expect(result.payload.error).toContain(detail);
    expect(result.payload.error).toMatch(/sheet was not changed/);
  });

  it("posts the selected model id and omits reasoning effort for Groq", async () => {
    const result = await completeWithProvider(
      settings({ provider: "groq", model: "chosen-model", keys: { gemini: "", groq: groqSecret } }),
      { messages: [{ role: "user", content: "Hi" }], temperature: 0.1, max_tokens: 1200 },
      recording(200, { choices: [{ message: { content: "{\"message\":\"ok\",\"operations\":[]}" } }] }),
    );
    expect(result.status).toBe(200);
    expect(result.payload.content).toContain("ok");
    const sent = JSON.parse(String(calls[0].init?.body)) as Record<string, unknown>;
    expect(sent.model).toBe("chosen-model");
    expect(sent).not.toHaveProperty("reasoning_effort");
    expect(calls[0].url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(new Headers(calls[0].init?.headers).get("Authorization")).toBe(`Bearer ${groqSecret}`);
  });

  it("sends reasoning effort only to Ollama and does not send a cloud key", async () => {
    await completeWithProvider(
      settings({ provider: "ollama", model: "nemotron-3-nano:4b" }),
      { messages: [] },
      recording(200, { choices: [{ message: { content: "ok" } }] }),
    );
    const sent = JSON.parse(String(calls[0].init?.body)) as Record<string, unknown>;
    expect(sent.reasoning_effort).toBe("none");
    expect(sent.model).toBe("nemotron-3-nano:4b");
    expect(new Headers(calls[0].init?.headers).get("Authorization")).toBeNull();
    expect(chatBody("gemini", { model: "gemini-3.8-flash", messages: [] })).not.toHaveProperty("reasoning_effort");
  });

  it("marks a schema HTTP 400 so the editor can retry without the schema", async () => {
    const result = await completeWithProvider(
      settings({ provider: "gemini", model: "gemini-3.8-flash", keys: { gemini: secret, groq: "" } }),
      { messages: [], response_format: { type: "json_schema" } },
      recording(400, { error: "response_format is unsupported" }),
    );
    expect(result.status).toBe(400);
    expect(result.payload.schemaRejected).toBe(true);
    expect(result.payload.error).toMatch(/sheet was not changed/);
  });

  it("does not mark a generic HTTP 400 as schema rejection", async () => {
    const result = await completeWithProvider(
      settings({ provider: "groq", model: "llama-3.3-70b", keys: { gemini: "", groq: groqSecret } }),
      { messages: [], response_format: { type: "json_schema" } },
      recording(400, { error: { message: "model_terms_required", type: "invalid_request_error" } }),
    );
    expect(result.payload.schemaRejected).toBe(false);
  });

  it("succeeds after three 429 responses then gives up on a fourth", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      if (calls <= 3) {
        return jsonResponse(
          429,
          { error: { message: "Rate limit reached. Please try again in 0.01s.", code: "rate_limit_exceeded" } },
          groqRateHeaders,
        );
      }
      return jsonResponse(429, { error: { message: "Rate limit reached.", code: "rate_limit_exceeded" } }, groqRateHeaders);
    }) as typeof fetch;
    const result = await completeWithProvider(
      settings({ provider: "groq", model: "llama-3.3-70b", keys: { gemini: "", groq: groqSecret } }),
      { messages: [{ role: "user", content: "Hi" }] },
      fetchImpl,
      { sleep: async () => undefined },
    );
    expect(calls).toBe(4);
    expect(result.status).toBe(429);
    expect(result.payload.schemaRejected).toBe(false);
    expect(result.payload.error).toMatch(/rate limit/i);
  });

  it("names connection refused and DNS failures", async () => {
    const refusedResult = await listProviderModels(
      settings({ provider: "ollama", model: "nemotron-3-nano:4b" }),
      refused("ECONNREFUSED"),
    );
    expect(refusedResult.payload.error).toBe("Connection refused for Ollama at http://127.0.0.1:11434/v1.");
    const missing = await completeWithProvider(
      settings({ provider: "groq", model: "llama-3.3-70b", keys: { gemini: "", groq: groqSecret } }),
      { messages: [] },
      refused("ENOTFOUND"),
    );
    expect(missing.payload.error).toContain("Could not resolve Groq at https://api.groq.com/openai/v1.");
    expect(missing.payload.error).toMatch(/sheet was not changed/);
  });

  it("reports an empty model list, an empty reply, and invalid JSON", async () => {
    const emptyList = await listProviderModels(
      settings({ provider: "gemini", keys: { gemini: secret, groq: "" } }),
      recording(200, { data: [] }),
    );
    expect(emptyList.payload.models).toEqual([]);
    expect(emptyList.payload.error).toMatch(/Model not found/);
    const emptyReply = await completeWithProvider(
      settings({ provider: "gemini", model: "gemini-3.8-flash", keys: { gemini: secret, groq: "" } }),
      { messages: [] },
      recording(200, { choices: [{ message: { content: "  " } }] }),
    );
    expect(emptyReply.status).toBe(502);
    expect(emptyReply.payload.error).toMatch(/no message/);
    const badJson = await completeWithProvider(
      settings({ provider: "gemini", model: "gemini-3.8-flash", keys: { gemini: secret, groq: "" } }),
      { messages: [] },
      recording(200, "not-json"),
    );
    expect(badJson.status).toBe(502);
    expect(badJson.payload.error).toMatch(/not JSON/);
  });
});

describe("provider errors and model pick", () => {
  it("retries Groq 429 after the suggested wait", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      if (calls === 1) {
        return jsonResponse(
          429,
          {
            error: {
              message: "Rate limit reached. Please try again in 0.01s.",
              code: "rate_limit_exceeded",
            },
          },
          groqRateHeaders,
        );
      }
      return jsonResponse(
        200,
        { choices: [{ message: { content: "{\"message\":\"ok\",\"operations\":[]}" } }] },
        groqRateHeaders,
      );
    }) as typeof fetch;
    const result = await completeWithProvider(
      settings({ provider: "groq", model: "llama-3.3-70b", keys: { gemini: "", groq: groqSecret } }),
      { messages: [{ role: "user", content: "Hi" }] },
      fetchImpl,
      { sleep: async () => undefined },
    );
    expect(calls).toBe(2);
    expect(result.status).toBe(200);
    expect(result.payload.content).toContain("ok");
  });

  it("explains Groq model_terms_required in plain language", () => {
    const body = JSON.stringify({
      error: {
        message:
          "The model 'canopylabs/orpheus-v1-english' requires terms acceptance. Please have the org admin accept the terms at https://console.groq.com/playground?model=canopylabs%2Forpheus-v1-english",
        type: "invalid_request_error",
        code: "model_terms_required",
      },
    });
    const message = httpFailure("Groq", 400, "/v1/chat/completions", body, true);
    expect(message).toMatch(/terms accepted/);
    expect(message).toMatch(/canopylabs\/orpheus-v1-english/);
    expect(message).toMatch(/llama-3.3-70b-versatile/);
    expect(message).toMatch(/sheet was not changed/);
  });

  it("prefers chat models over orpheus and whisper for default pick", () => {
    expect(pickDefaultModel(["canopylabs/orpheus-v1-english", "llama-3.3-70b-versatile", "whisper-large-v3"], "groq")).toBe(
      "llama-3.3-70b-versatile",
    );
    expect(pickDefaultModel(["canopylabs/orpheus-v1-english", "whisper-large-v3"], "groq")).toBe("");
  });

  it("lists defaultModel from the provider model API", async () => {
    const result = await listProviderModels(
      settings({ provider: "groq", keys: { gemini: "", groq: groqSecret } }),
      recording(200, {
        data: [{ id: "canopylabs/orpheus-v1-english" }, { id: "llama-3.3-70b-versatile" }],
      }),
    );
    expect(result.payload.defaultModel).toBe("llama-3.3-70b-versatile");
  });

  it("returns usageNote from Groq rate-limit headers on chat and model list", async () => {
    const listed = await listProviderModels(
      settings({ provider: "groq", keys: { gemini: "", groq: groqSecret } }),
      recording(200, { data: [{ id: "llama-3.3-70b-versatile" }] }, groqRateHeaders),
    );
    expect(listed.payload.usageNote).toMatch(/100 requests left today/);
    expect(listed.payload.usageNote).toMatch(/8,000 tokens\/min left/);

    const chat = await completeWithProvider(
      settings({ provider: "groq", model: "llama-3.3-70b", keys: { gemini: "", groq: groqSecret } }),
      { messages: [{ role: "user", content: "Hi" }] },
      recording(200, { choices: [{ message: { content: "{\"message\":\"ok\",\"operations\":[]}" } }] }, groqRateHeaders),
    );
    expect(chat.payload.usageNote).toMatch(/requests left today/);
    expect(chat.payload.content).toContain("ok");
  });
});
