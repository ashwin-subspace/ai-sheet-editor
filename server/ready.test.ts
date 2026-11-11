import { describe, expect, it } from "vitest";
import { buildReadyPayload } from "./ready";
import { defaultSettings, type StoredSettings } from "./provider";

describe("buildReadyPayload", () => {
  it("flags missing API key for groq", async () => {
    const settings: StoredSettings = { ...defaultSettings(), provider: "groq", model: "llama-3.3-70b-versatile", keys: { groq: "", gemini: "" } };
    const payload = await buildReadyPayload(settings, async () => ({
      status: 200,
      payload: { models: ["llama-3.3-70b-versatile"] },
    }));
    expect(payload.ok).toBe(false);
    expect(payload.issues.some((i) => i.code === "missing_api_key")).toBe(true);
  });

  it("is ok for ollama with model in list", async () => {
    const settings: StoredSettings = { ...defaultSettings(), provider: "ollama", model: "llama3.1:8b" };
    const payload = await buildReadyPayload(settings, async () => ({
      status: 200,
      payload: { models: ["llama3.1:8b", "nomic-embed-text"] },
    }));
    expect(payload.ok).toBe(true);
    expect(payload.curatedModels.length).toBeGreaterThan(0);
  });
});
