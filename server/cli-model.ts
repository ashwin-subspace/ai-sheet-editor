import type { CompletionRequest, CompletionResult } from "../src/ai/propose";
import { pickDefaultModel } from "../src/shared/sheet-models";
import { completeWithProvider, listProviderModels, providerLabel, type StoredSettings } from "./provider";
import { readSettings, updateSettings } from "./settings-store";

export async function prepareCliModel(): Promise<{ settings: StoredSettings; label: string }> {
  let settings = await readSettings();
  if (!settings.model.trim()) {
    const listed = await listProviderModels(settings);
    const id = listed.payload.defaultModel || pickDefaultModel(listed.payload.models, settings.provider);
    if (!id) {
      throw new Error(
        listed.payload.error
          ?? `No ${providerLabel(settings.provider)} chat model is available. Choose a model like llama-3.3-70b-versatile in the app toolbar.`,
      );
    }
    settings = await updateSettings({ provider: settings.provider, model: id });
  }
  return {
    settings,
    label: `${providerLabel(settings.provider)}: ${settings.model}`,
  };
}

export async function completionFromSettings(request: CompletionRequest): Promise<CompletionResult> {
  const settings = await readSettings();
  const result = await completeWithProvider(settings, request);
  if (result.status === 200 && result.payload.content) {
    return { ok: true, content: result.payload.content };
  }
  return {
    ok: false,
    status: result.status,
    error: result.payload.error ?? "The model request failed.",
    schemaRejected: Boolean(result.payload.schemaRejected),
  };
}
