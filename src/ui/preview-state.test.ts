import { describe, expect, it, vi } from "vitest";
import { createHistory } from "../engine/history";
import { reviewModelText } from "../engine/operations";
import { SAMPLE_EDIT } from "../engine/sample";
import { createWorkbook } from "../engine/types";
import {
  acceptPreviewState,
  canCommitDraft,
  canSave,
  canUndoRedo,
  completeModel,
  initialPreviewUi,
  isDirty,
  rejectPreviewState,
  showPreviewState,
} from "./preview-state";

describe("preview guards", () => {
  it("blocks commit, undo, and save while previewing", () => {
    expect(canCommitDraft(true)).toBe(false);
    expect(canUndoRedo(true)).toBe(false);
    expect(canSave(true)).toBe(false);
    expect(canCommitDraft(false)).toBe(true);
  });

  it("detects a dirty session", () => {
    expect(isDirty(0, 0)).toBe(false);
    expect(isDirty(1, 0)).toBe(true);
    expect(isDirty(0, 2)).toBe(true);
  });
});

describe("preview state transitions", () => {
  it("accept clears preview metadata and pushes history", () => {
    const history = createHistory(createWorkbook());
    const review = reviewModelText(SAMPLE_EDIT, history.present, null);
    expect(review.ok).toBe(true);
    if (!review.ok) return;
    const shown = showPreviewState(initialPreviewUi(history), review);
    expect(shown.previewBook).not.toBeNull();
    const accepted = acceptPreviewState(shown);
    expect(accepted.previewBook).toBeNull();
    expect(accepted.summaries).toEqual([]);
    expect(accepted.history.past).toHaveLength(1);
    expect(accepted.history.present.cells.A1?.value).toBe("Category");
  });

  it("reject drops the preview without changing history", () => {
    const history = createHistory(createWorkbook());
    history.present.cells.Z9 = { value: "stay" };
    const review = reviewModelText(SAMPLE_EDIT, history.present, null);
    if (!review.ok) throw new Error("fixture");
    const shown = showPreviewState(initialPreviewUi(history), review);
    const rejected = rejectPreviewState(shown);
    expect(rejected.previewBook).toBeNull();
    expect(rejected.history.present.cells.Z9?.value).toBe("stay");
    expect(rejected.history.past).toHaveLength(0);
  });
});

describe("completeModel", () => {
  it("maps fetch failures and empty content", async () => {
    const failFetch = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    const down = await completeModel({ messages: [], temperature: 0.1, max_tokens: 100 }, failFetch);
    expect(down.ok).toBe(false);
    if (!down.ok) expect(down.error).toMatch(/not running/);

    const emptyFetch = vi.fn(
      async () =>
        ({
          ok: true,
          json: async () => ({}),
        }) as Response,
    ) as unknown as typeof fetch;
    const empty = await completeModel({ messages: [], temperature: 0.1, max_tokens: 100 }, emptyFetch);
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error).toMatch(/empty reply/);
  });
});
