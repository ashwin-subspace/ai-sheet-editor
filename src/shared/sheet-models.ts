export type ModelProviderId = "ollama" | "gemini" | "groq";

const DEPRIORITIZED =
  /orpheus|whisper|embed|tts|distil-whisper|canopylabs\/orpheus|prompt-guard|safeguard|allam-2|gemini-2\.5/i;

const HARD_EXCLUDE = /embed|vision|whisper|tts|distil-whisper|rerank|bge-|clip|nomic-embed/i;

const CHAT_PREFERRED = /llama|gemma|mixtral|qwen|nemotron|gpt-oss|gemini|deepseek|mistral|compound|phi/i;

const OLLAMA_CURATED = /llama3|llama-3|llama3\.|gemma|qwen|mistral|mixtral|phi|nemotron/i;
const GROQ_CURATED = /llama-3\.|llama3|gemma|mixtral|qwen|deepseek|compound/i;
const GEMINI_CURATED = /gemini-3\.|gemini-2\.0|gemini-2\.5-flash|gemma/i;

const DEFAULT_MODEL_RANK = [
  /llama-3\.3-70b/i,
  /llama-3\.3/i,
  /llama-3\.1-8b/i,
  /llama-3\.2/i,
  /llama3\.1/i,
  /gemini-3\.8-flash/i,
  /llama-3\.1-70b-versatile/i,
  /gemma2-9b/i,
  /qwen/i,
  /mistral/i,
];

export const CURATED_DROPDOWN_MAX = 3;

function defaultModelRank(id: string): number {
  const index = DEFAULT_MODEL_RANK.findIndex((pattern) => pattern.test(id));
  return index >= 0 ? index : DEFAULT_MODEL_RANK.length;
}

function curatedPattern(provider: ModelProviderId): RegExp {
  if (provider === "groq") return GROQ_CURATED;
  if (provider === "gemini") return GEMINI_CURATED;
  return OLLAMA_CURATED;
}

export function isDeprioritizedSheetModel(id: string): boolean {
  return DEPRIORITIZED.test(id) || HARD_EXCLUDE.test(id);
}

export function isCuratedSheetModel(id: string, provider: ModelProviderId): boolean {
  if (!id.trim()) return false;
  if (isDeprioritizedSheetModel(id)) return false;
  if (/nano|1b-instruct|smoll/i.test(id) && provider === "ollama") return false;
  return curatedPattern(provider).test(id) && CHAT_PREFERRED.test(id);
}

export function isPreferredChatModel(id: string): boolean {
  return CHAT_PREFERRED.test(id) && !isDeprioritizedSheetModel(id);
}

export function listCuratedModels(
  ids: string[],
  provider: ModelProviderId,
  options?: { showAll?: boolean; max?: number },
): string[] {
  const max = options?.max ?? CURATED_DROPDOWN_MAX;
  if (options?.showAll) {
    const filtered = ids.filter((id) => !isDeprioritizedSheetModel(id));
    return filtered.length > 0 ? filtered : ids;
  }
  const curated = ids
    .filter((id) => isCuratedSheetModel(id, provider))
    .sort((a, b) => defaultModelRank(a) - defaultModelRank(b));
  if (curated.length === 0) return [];
  return curated.slice(0, max);
}

export function pickDefaultModel(ids: string[], provider: ModelProviderId = "ollama"): string {
  const curated = ids
    .filter((id) => isCuratedSheetModel(id, provider))
    .sort((a, b) => defaultModelRank(a) - defaultModelRank(b));
  if (curated.length > 0) return curated[0];
  const preferred = ids.filter(isPreferredChatModel).sort((a, b) => defaultModelRank(a) - defaultModelRank(b));
  if (preferred.length > 0) return preferred[0];
  const neutral = ids.filter((id) => !isDeprioritizedSheetModel(id));
  if (neutral.length > 0) return neutral[0];
  return "";
}

/** @deprecated Use listCuratedModels */
export function filterSheetModels(ids: string[], showAll: boolean): string[] {
  return listCuratedModels(ids, "ollama", { showAll, max: ids.length });
}

export function modelOptionLabel(id: string): string {
  if (/gemini-2\.5/i.test(id)) return `${id} (deprecated — use gemini-3.8-flash)`;
  if (/safeguard|allam-2|prompt-guard/i.test(id)) return `${id} (low limits — not for sheets)`;
  if (isDeprioritizedSheetModel(id)) return `${id} (not for sheets)`;
  return id;
}

export function shouldAutoSwitchModel(id: string, provider: ModelProviderId): boolean {
  if (!id) return true;
  return isDeprioritizedSheetModel(id) || !isCuratedSheetModel(id, provider);
}
