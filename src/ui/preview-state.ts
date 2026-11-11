import { pushHistory, type HistoryState } from "../engine/history";
import type { Review } from "../engine/operations";
import type { Workbook } from "../engine/types";
import type { CompletionRequest, CompletionResult } from "../ai/propose";

export interface PreviewUiState {
  history: HistoryState;
  previewBook: Workbook | null;
  changed: string[];
  changedColumns: string[];
  summaries: string[];
  previewWarning?: string;
}

export function initialPreviewUi(history: HistoryState): PreviewUiState {
  return {
    history,
    previewBook: null,
    changed: [],
    changedColumns: [],
    summaries: [],
    previewWarning: undefined,
  };
}

export function showPreviewState(
  current: PreviewUiState,
  review: Extract<Review, { ok: true }>,
): PreviewUiState {
  return {
    ...current,
    previewBook: review.workbook,
    changed: review.changed,
    changedColumns: review.changedColumns,
    summaries: review.summaries,
    previewWarning: review.warning,
  };
}

export function acceptPreviewState(current: PreviewUiState): PreviewUiState {
  if (!current.previewBook) return current;
  const history = pushHistory(current.history, current.previewBook);
  return { ...initialPreviewUi(history), history };
}

export function rejectPreviewState(current: PreviewUiState): PreviewUiState {
  return initialPreviewUi(current.history);
}

export function canCommitDraft(previewing: boolean): boolean {
  return !previewing;
}

export function canUndoRedo(previewing: boolean): boolean {
  return !previewing;
}

export function canSave(previewing: boolean): boolean {
  return !previewing;
}

export function isDirty(historyPastLength: number, messageCount: number): boolean {
  return historyPastLength > 0 || messageCount > 0;
}

export function rejectAssistantText(): string {
  return "Rejected the preview. The sheet was not changed.";
}

export async function completeModel(
  request: CompletionRequest,
  fetchImpl: typeof fetch = fetch,
  onUsage?: (body: { usageNote?: string }) => void,
): Promise<CompletionResult> {
  try {
    const response = await fetchImpl("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    const body = (await response.json()) as {
      content?: string;
      error?: string;
      schemaRejected?: boolean;
      usageNote?: string;
    };
    onUsage?.(body);
    if (!response.ok || !body.content) {
      return {
        ok: false,
        status: response.status,
        error:
          body.error ??
          (response.ok
            ? "The model returned an empty reply. The sheet was not changed."
            : "The file helper could not reach the selected model. The sheet was not changed."),
        schemaRejected: Boolean(body.schemaRejected),
      };
    }
    return { ok: true, content: body.content };
  } catch {
    return {
      ok: false,
      status: 0,
      error: "The file helper is not running. Start it with npm run server. The sheet was not changed.",
    };
  }
}
