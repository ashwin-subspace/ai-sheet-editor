export interface ProviderRateLimits {
  remainingRequests?: number;
  limitRequests?: number;
  resetRequests?: string;
  remainingTokens?: number;
  limitTokens?: number;
  resetTokens?: string;
}

type HeaderSource = { get(name: string): string | null };

function readInt(headers: HeaderSource, name: string): number | undefined {
  const raw = headers.get(name);
  if (raw == null || raw === "") return undefined;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : undefined;
}

function readText(headers: HeaderSource, name: string): string | undefined {
  const raw = headers.get(name)?.trim();
  return raw || undefined;
}

/** Groq (and some OpenAI-compatible hosts) expose x-ratelimit-* on API responses. */
export function parseRateLimitHeaders(headers: HeaderSource): ProviderRateLimits {
  return {
    remainingRequests: readInt(headers, "x-ratelimit-remaining-requests"),
    limitRequests: readInt(headers, "x-ratelimit-limit-requests"),
    resetRequests: readText(headers, "x-ratelimit-reset-requests"),
    remainingTokens: readInt(headers, "x-ratelimit-remaining-tokens"),
    limitTokens: readInt(headers, "x-ratelimit-limit-tokens"),
    resetTokens: readText(headers, "x-ratelimit-reset-tokens"),
  };
}

export function hasRateLimitData(limits: ProviderRateLimits): boolean {
  return (
    limits.remainingRequests != null
    || limits.remainingTokens != null
    || limits.limitRequests != null
    || limits.limitTokens != null
  );
}

function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

function requestLine(limits: ProviderRateLimits): string | undefined {
  if (limits.remainingRequests == null) return undefined;
  const cap = limits.limitRequests != null ? ` / ${formatCount(limits.limitRequests)}` : "";
  const reset = limits.resetRequests ? ` (resets ${limits.resetRequests})` : "";
  return `~${formatCount(limits.remainingRequests)} requests left today${cap}${reset}`;
}

function tokenLine(limits: ProviderRateLimits): string | undefined {
  if (limits.remainingTokens == null) return undefined;
  const cap = limits.limitTokens != null ? ` / ${formatCount(limits.limitTokens)}` : "";
  const reset = limits.resetTokens ? ` (resets ${limits.resetTokens})` : "";
  return `~${formatCount(limits.remainingTokens)} tokens/min left${cap}${reset}`;
}

/** One-line summary for the toolbar; empty when the provider sent no rate-limit headers. */
export function formatRateLimitSummary(limits: ProviderRateLimits): string {
  if (!hasRateLimitData(limits)) return "";
  const parts = [requestLine(limits), tokenLine(limits)].filter(Boolean);
  return parts.join(" · ");
}

export function usageNoteFromResponse(response: { headers: HeaderSource }): string {
  return formatRateLimitSummary(parseRateLimitHeaders(response.headers));
}
