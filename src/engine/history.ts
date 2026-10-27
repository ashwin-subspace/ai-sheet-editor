import { cloneWorkbook, UNDO_LIMIT, type Workbook } from "./types";
import { sameWorkbook } from "./workbook";

export interface HistoryState {
  past: Workbook[];
  present: Workbook;
  future: Workbook[];
}

export function createHistory(workbook: Workbook): HistoryState {
  return { past: [], present: workbook, future: [] };
}

export function pushHistory(history: HistoryState, next: Workbook): HistoryState {
  if (sameWorkbook(history.present, next)) return history;
  const past = [...history.past, cloneWorkbook(history.present)];
  while (past.length > UNDO_LIMIT) past.shift();
  return { past, present: next, future: [] };
}

export function undoHistory(history: HistoryState): HistoryState {
  const previous = history.past[history.past.length - 1];
  if (!previous) return history;
  return {
    past: history.past.slice(0, -1),
    present: cloneWorkbook(previous),
    future: [cloneWorkbook(history.present), ...history.future],
  };
}

export function redoHistory(history: HistoryState): HistoryState {
  const next = history.future[0];
  if (!next) return history;
  const past = [...history.past, cloneWorkbook(history.present)];
  while (past.length > UNDO_LIMIT) past.shift();
  return {
    past,
    present: cloneWorkbook(next),
    future: history.future.slice(1),
  };
}
