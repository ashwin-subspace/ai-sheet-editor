import { describe, expect, it } from "vitest";
import { UNDO_LIMIT, createWorkbook, type Workbook } from "./types";
import {
  createHistory,
  pushHistory,
  redoHistory,
  undoHistory,
  type HistoryState,
} from "./history";
import { applyUserInput } from "./workbook";

function bookWithMarker(n: number): Workbook {
  const book = createWorkbook();
  book.cells.A1 = { value: n };
  return book;
}

describe("history", () => {
  it("does not push when the workbook is unchanged", () => {
    const present = bookWithMarker(1);
    const history = createHistory(present);
    const next = pushHistory(history, present);
    expect(next.past).toHaveLength(0);
    expect(next.future).toHaveLength(0);
  });

  it("undo and redo at the ends are no-ops", () => {
    const history = createHistory(bookWithMarker(1));
    expect(undoHistory(history)).toBe(history);
    expect(redoHistory(history)).toBe(history);
  });

  it("drops the oldest snapshot after UNDO_LIMIT edits", () => {
    let state: HistoryState = createHistory(bookWithMarker(0));
    for (let i = 1; i <= UNDO_LIMIT + 1; i += 1) {
      const previous = state.present;
      state = pushHistory(state, applyUserInput(previous, "A1", String(i)));
    }
    expect(state.past).toHaveLength(UNDO_LIMIT);
    const undone = undoHistory(state);
    let steps = 0;
    let current = undone;
    while (current.past.length > 0 && steps < UNDO_LIMIT + 2) {
      current = undoHistory(current);
      steps += 1;
    }
    expect(current.present.cells.A1?.value).toBe(1);
  });

  it("clears redo on a new edit", () => {
    let state = createHistory(bookWithMarker(1));
    state = pushHistory(state, bookWithMarker(2));
    state = undoHistory(state);
    expect(state.future).toHaveLength(1);
    state = pushHistory(state, bookWithMarker(3));
    expect(state.future).toHaveLength(0);
    expect(state.present.cells.A1?.value).toBe(3);
  });
});
