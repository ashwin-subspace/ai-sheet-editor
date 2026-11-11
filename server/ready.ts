import { listCuratedModels, type ModelProviderId } from "../src/shared/sheet-models";
import { listProviderModels, providerLabel, type StoredSettings } from "./provider";

export interface ReadinessIssue {
  code: string;
  title: string;
  fix: string;
}

export interface ReadyPayload {
  ok: boolean;
  issues: ReadinessIssue[];
  provider: ModelProviderId;
  model: string;
  curatedModels: string[];
}

function missingKey(settings: StoredSettings): string | null {
  if (settings.provider === "ollama") return null;
  if (settings.keys[settings.provider].trim()) return null;
  return settings.provider;
}

export async function buildReadyPayload(
  settings: StoredSettings,
  list = listProviderModels,
): Promise<ReadyPayload> {
  const issues: ReadinessIssue[] = [];
  const label = providerLabel(settings.provider);
  const missing = missingKey(settings);
  if (missing) {
    issues.push({
      code: "missing_api_key",
      title: `${label} needs an API key`,
      fix: "Open Advanced, paste your API key, save it, then click Retry setup.",
    });
  }
  if (!settings.model.trim()) {
    issues.push({
      code: "no_model",
      title: "No chat model selected",
      fix: `Choose a model in the toolbar, or pull a model into Ollama (e.g. llama3.1:8b).`,
    });
  }
  const listed = await list(settings);
  const models = listed.payload.models ?? [];
  const curated = listCuratedModels(models, settings.provider);
  if (listed.status >= 500 || /refused|Could not resolve/i.test(listed.payload.error ?? "")) {
    issues.push({
      code: "provider_unreachable",
      title: settings.provider === "ollama" ? "Ollama isn’t running" : `${label} is unreachable`,
      fix:
        settings.provider === "ollama"
          ? "Start Ollama, pull llama3.1:8b or similar, then Retry setup."
          : "Check internet and API key, then Retry setup.",
    });
  } else if (models.length === 0 && !missing) {
    issues.push({
      code: "no_models",
      title: `No models listed from ${label}`,
      fix: settings.provider === "ollama" ? "Run `ollama pull llama3.1:8b`." : "Pick another model in the provider console.",
    });
  } else if (settings.model && !models.includes(settings.model)) {
    issues.push({
      code: "model_missing",
      title: `“${settings.model}” is not available`,
      fix: "Choose a model from the short list in the toolbar.",
    });
  } else if (curated.length === 0 && models.length > 0) {
    issues.push({
      code: "no_curated",
      title: "No sheet-friendly models found",
      fix: "Pull or enable a chat model (Llama, Gemma, Qwen). Avoid embed/whisper models.",
    });
  }
  const ok = issues.length === 0;
  return {
    ok,
    issues,
    provider: settings.provider,
    model: settings.model,
    curatedModels: curated,
  };
}
