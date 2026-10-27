import { parseModelJson } from "../src/engine/operations";

export function modelReplyText(message: { content?: unknown; reasoning_content?: unknown } | undefined): string | null {
  const content = textOf(message?.content);
  const reasoning = textOf(message?.reasoning_content);
  if (content && reasoning && hasEdits(reasoning) && !hasEdits(content)) return reasoning;
  if (content) return content;
  return reasoning || null;
}

function hasEdits(text: string): boolean {
  const parsed = parseModelJson(text);
  if (!parsed.ok || !parsed.value || typeof parsed.value !== "object") return false;
  const operations = (parsed.value as { operations?: unknown }).operations;
  return Array.isArray(operations) && operations.length > 0;
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
