import { normalizeSelection } from "../engine/address";
import { buildChatMessages, type ChatTurn } from "../engine/context";
import { reviewModelText, type Review } from "../engine/operations";
import type { Selection, Workbook } from "../engine/types";
import { replySchema } from "./schema";

export interface CompletionRequest {
  messages: { role: string; content: string }[];
  temperature: number;
  max_tokens: number;
  response_format?: unknown;
}

export type CompletionResult =
  | { ok: true; content: string }
  | { ok: false; status: number; error: string; schemaRejected?: boolean };

export type ProposeResult =
  | { kind: "preview"; review: Extract<Review, { ok: true }> }
  | { kind: "message"; message: string }
  | { kind: "error"; message: string };

const TEMPERATURE = 0.1;
const MAX_TOKENS = 1200;

export async function proposeEdits(input: {
  workbook: Workbook;
  selection: Selection | null;
  history: ChatTurn[];
  prompt: string;
  complete: (request: CompletionRequest) => Promise<CompletionResult>;
}): Promise<ProposeResult> {
  const messages = buildChatMessages(input);
  let useSchema = true;
  let first = await input.complete(request(messages, true));
  if (!first.ok && first.schemaRejected) {
    useSchema = false;
    first = await input.complete(request(messages, false));
  }
  if (!first.ok) return { kind: "error", message: first.error };

  let content = first.content;
  let repairs = 0;
  while (true) {
    const review = reviewModelText(content, input.workbook, selectionRange(input.selection));
    const empty = review.ok && review.operations.length === 0;
    const flatTable = review.ok && !empty && asksForTable(input.prompt) && !spansColumns(review);
    if (review.ok && !empty && !flatTable) return { kind: "preview", review };
    if (empty && repairs === 0 && !asksForEdit(input.prompt)) {
      return { kind: "message", message: review.message || "No edits." };
    }
    if (repairs >= 2) {
      if (flatTable) return { kind: "error", message: "Rejected: a table needs separate columns. The sheet was not changed." };
      return review.ok ? { kind: "message", message: review.message || "No edits." } : { kind: "error", message: review.error };
    }
    repairs += 1;
    const reason = flatTable
      ? "Rejected: that is one cell, not a table. Use one write_range. The first inner list is the headers, one name per cell, then one sample row. Example: rows:[[\"Left\",\"Spent\",\"Item\",\"Result\"],[900,0,\"opening\",\"\"]]. Do not put the user's sentence in one cell."
      : review.ok
        ? "Rejected: operations is empty. Send one JSON object that includes the edits."
        : clip(review.error);
    const repaired = await input.complete(
      request([...messages, { role: "user", content: reason }], useSchema),
    );
    if (!repaired.ok) return { kind: "error", message: repaired.error };
    content = repaired.content;
  }
}

function request(
  messages: { role: string; content: string }[],
  useSchema: boolean,
): CompletionRequest {
  return {
    messages,
    temperature: TEMPERATURE,
    max_tokens: MAX_TOKENS,
    response_format: useSchema ? replySchema : undefined,
  };
}

function selectionRange(selection: Selection | null) {
  if (!selection) return null;
  return normalizeSelection(selection.anchor, selection.end);
}

function asksForEdit(prompt: string): boolean {
  return !/^(what|why|how|explain|which|who|when|describe|tell)\b/i.test(prompt.trim());
}

function asksForTable(prompt: string): boolean {
  return /\b(table|tracker|columns)\b/i.test(prompt);
}

function spansColumns(review: Extract<Review, { ok: true }>): boolean {
  for (const operation of review.operations) {
    if (operation.op === "write_range" && operation.rows.some((row) => row.length >= 2)) return true;
  }
  const columns = new Set(review.changed.map((address) => address.replace(/[0-9]/g, "")));
  return columns.size >= 2;
}

function clip(error: string): string {
  const text = error.startsWith("Rejected:") ? error : `Rejected: ${error}`;
  return text.slice(0, 500);
}
