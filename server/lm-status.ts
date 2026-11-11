export class LmHttpError extends Error {
  readonly status: number;
  readonly path: string;

  constructor(status: number, path: string, label = "Ollama") {
    super(`${label} returned HTTP ${status} for ${path}.`);
    this.name = "LmHttpError";
    this.status = status;
    this.path = path;
  }
}

export class LmModelMissingError extends Error {
  constructor(base: string) {
    super(`Model not found at ${base}. GET /v1/models returned no model IDs.`);
    this.name = "LmModelMissingError";
  }
}

export function modelIdsFromList(json: { data?: { id?: string }[] } | null | undefined): string[] {
  return (json?.data ?? []).flatMap((item) => (item.id ? [item.id] : []));
}

export function describeLmFailure(error: unknown, base: string, label = "Ollama"): string {
  return `${lmFailureDetail(error, base, label)} The sheet was not changed.`;
}

export function lmFailureDetail(error: unknown, base: string, label = "Ollama"): string {
  if (error instanceof LmHttpError || error instanceof LmModelMissingError) return error.message;
  const code = nestedCode(error);
  const text = nestedText(error);
  if (code === "ECONNREFUSED" || /ECONNREFUSED/i.test(text)) {
    return `Connection refused for ${label} at ${base}.`;
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN" || /ENOTFOUND|getaddrinfo/i.test(text)) {
    return `Could not resolve ${label} at ${base}.`;
  }
  if (/cors/i.test(text)) return `CORS blocked the request to ${label} at ${base}.`;
  if (error instanceof Error && error.message && error.message !== "fetch failed") return error.message;
  if (text && text !== "fetch failed") return text;
  return `Could not reach ${label} at ${base}.`;
}

function nestedCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string") return code;
  return nestedCode((error as { cause?: unknown }).cause);
}

function nestedText(error: unknown): string {
  if (typeof error === "string") return error;
  if (!error || typeof error !== "object") return "";
  const message = error instanceof Error ? error.message : "";
  const cause = (error as { cause?: unknown }).cause;
  return `${message} ${nestedText(cause)}`.trim();
}
