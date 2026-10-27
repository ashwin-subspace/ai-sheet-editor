export const COL_COUNT = 26;
export const ROW_COUNT = 200;
export const MAX_OPS = 40;
export const MAX_WRITE_ROWS = 40;
export const MAX_WRITE_COLS = 8;
export const UNDO_LIMIT = 20;
export const SNAPSHOT_LINE_CAP = 100;

export const NUMBER_FORMATS = ["General", "0", "0.00", "#,##0", "#,##0.00", "0%"] as const;
export type NumberFormat = (typeof NUMBER_FORMATS)[number];

export const ALLOWED_FUNCTIONS = ["SUM", "AVERAGE", "COUNT", "IF"] as const;

export type CellScalar = string | number | boolean;

export interface Cell {
  value?: CellScalar;
  formula?: string;
  bold?: boolean;
  fill?: string;
  numberFormat?: string;
  /** Formula is stored for Excel and is not calculated in this app. */
  unsupported?: boolean;
  cached?: CellScalar;
}

export interface Workbook {
  cells: Record<string, Cell>;
  columnWidths: Record<string, number>;
}

export interface Selection {
  anchor: string;
  end: string;
}

export interface CellPos {
  col: number;
  row: number;
}

export type FormulaErrorCode = "#DIV/0!" | "#VALUE!" | "#CYCLE!" | "#REF!" | "#NAME?";

export type CellRuntime =
  | { kind: "blank" }
  | { kind: "num"; value: number }
  | { kind: "str"; value: string }
  | { kind: "bool"; value: boolean }
  | { kind: "err"; value: FormulaErrorCode };

export function createWorkbook(): Workbook {
  return { cells: {}, columnWidths: {} };
}

export function cloneWorkbook(workbook: Workbook): Workbook {
  return structuredClone(workbook);
}
