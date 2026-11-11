export function parseProviderErrorBody(body: string): { message?: string; code?: string; status?: string } {
  try {
    let json: unknown = JSON.parse(body);
    if (Array.isArray(json) && json.length > 0) json = json[0];
    if (!json || typeof json !== "object") return {};
    const record = json as Record<string, unknown>;
    const err = record.error;
    if (typeof err === "string") return { message: err };
    if (err && typeof err === "object") {
      const obj = err as Record<string, unknown>;
      return {
        message: typeof obj.message === "string" ? obj.message : undefined,
        code: typeof obj.code === "string" ? obj.code : undefined,
        status: typeof obj.status === "string" ? obj.status : undefined,
      };
    }
  } catch {
    /* plain text body */
  }
  return {};
}

export function retryDelaySeconds(body: string, retryAfterHeader: string | null): number {
  if (retryAfterHeader) {
    const seconds = Number.parseFloat(retryAfterHeader);
    if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds + 0.25, 30);
  }
  const { message } = parseProviderErrorBody(body);
  const match = message?.match(/try again in ([\d.]+)s/i);
  if (match) {
    const seconds = Number.parseFloat(match[1]);
    if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds + 0.5, 30);
  }
  return 0;
}

export function shouldReduceMaxTokens(status: number, body: string): boolean {
  const { message, code } = parseProviderErrorBody(body);
  if (code === "rate_limit_exceeded" && /Request too large|output tokens per minute|OTPM|reduce max_tokens/i.test(message ?? "")) {
    return true;
  }
  return status === 400 && /max_tokens|output tokens|too large/i.test(message ?? body);
}

export function friendlyProviderError(label: string, status: number, body: string): string {
  const { message, code, status: errStatus } = parseProviderErrorBody(body);
  const text = message ?? body;

  if (code === "model_terms_required" || /terms acceptance/i.test(text)) {
    const modelMatch = text.match(/'([^']+)'/);
    const model = modelMatch?.[1] ?? "This model";
    const url = text.match(/https:\/\/[^\s"]+/)?.[0];
    const link = url ? ` Open: ${url}` : "";
    return `${label}: ${model} needs terms accepted in the ${label} console before API use. Pick a chat model such as llama-3.3-70b-versatile instead.${link}`;
  }

  if (
    errStatus === "NOT_FOUND"
    || /no longer available to new users/i.test(text)
    || /models\/gemini-2\.5/i.test(text)
  ) {
    const model = text.match(/models\/([\w.-]+)/i)?.[1] ?? text.match(/model `([^`]+)`/i)?.[1];
    const name = model ? ` (${model})` : "";
    return `${label}: that model${name} is not available on your API key. Choose gemini-3.8-flash or another model from the Model dropdown.`;
  }
  if (status === 404) {
    const plain = !message && body.trim() && !body.trim().startsWith("{") && !body.trim().startsWith("[")
      ? body.trim().slice(0, 200)
      : "";
    const detail = message?.slice(0, 200) || plain;
    return detail
      ? `${label}: model not found — ${detail}`
      : `${label}: model not found (HTTP 404). Pick a model from the Model dropdown.`;
  }

  if (status === 401 || code === "invalid_api_key" || /invalid.*api.*key/i.test(text)) {
    return `${label}: API key is invalid or expired. Save a new key in the toolbar.`;
  }

  if (status === 403) {
    return message ? `${label}: ${message}` : `${label}: access denied (HTTP 403). Check your API key and model access.`;
  }

  if (status === 429 || code === "rate_limit_exceeded" || /rate limit reached/i.test(text)) {
    const wait = text.match(/try again in ([\d.]+)s/i)?.[1];
    const waitPart = wait ? ` Wait about ${wait}s, then retry.` : " Wait a moment, then retry.";
    if (/Request too large|output tokens per minute|OTPM|reduce max_tokens/i.test(text)) {
      return `${label}: this model’s output cap is too low for the reply.${waitPart} Use llama-3.3-70b-versatile (Groq) or a larger Gemini model—not gpt-oss-safeguard or allam-2-7b.`;
    }
    if (/tokens per minute \(TPM\)/i.test(text)) {
      return `${label}: token-per-minute limit hit for this model.${waitPart} Switch to llama-3.3-70b-versatile or pause between prompts.`;
    }
    return `${label}: rate limit reached.${waitPart} Switch models or check the usage line in the toolbar.`;
  }

  if (message && message.length <= 400) return `${label}: ${message}`;
  if (message) return `${label}: ${message.slice(0, 400)}…`;
  return "";
}
