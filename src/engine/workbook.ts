import { formatAddress, parseAddress } from "./address";
import { checkFormula, evaluateCell, evaluationCache, type EvalCache } from "./formula";
import { formatRuntimeText } from "./format";
import { cloneWorkbook, type Cell, type CellRuntime, type CellScalar, type Workbook } from "./types";

export interface CellView {
  text: string;
  bar: string;
  bold: boolean;
  fill?: string;
  numberFormat?: string;
  unsupported: boolean;
  error: boolean;
}

export function cellView(workbook: Workbook, address: string, cache: EvalCache): CellView {
  const cell = workbook.cells[address.toUpperCase()];
  const bar = formulaBarText(cell);
  if (!cell) {
    return { text: "", bar: "", bold: false, unsupported: false, error: false };
  }
  if (cell.formula && !cell.unsupported) {
    const runtime = evaluateCell(workbook, address, cache);
    return {
      text: runtimeText(runtime, cell.numberFormat),
      bar,
      bold: Boolean(cell.bold),
      fill: cell.fill,
      numberFormat: cell.numberFormat,
      unsupported: false,
      error: runtime.kind === "err",
    };
  }
  if (cell.unsupported) {
    const shown = cell.cached !== undefined ? formatRuntimeText(cell.cached, cell.numberFormat) : "";
    return {
      text: shown,
      bar,
      bold: Boolean(cell.bold),
      fill: cell.fill,
      numberFormat: cell.numberFormat,
      unsupported: true,
      error: false,
    };
  }
  const runtime = scalarRuntime(cell.value);
  return {
    text: runtimeText(runtime, cell.numberFormat),
    bar,
    bold: Boolean(cell.bold),
    fill: cell.fill,
    numberFormat: cell.numberFormat,
    unsupported: false,
    error: false,
  };
}

export function formulaBarText(cell: Cell | undefined): string {
  if (!cell) return "";
  if (cell.formula) return cell.formula.startsWith("=") ? cell.formula : `=${cell.formula}`;
  if (typeof cell.value === "boolean") return cell.value ? "TRUE" : "FALSE";
  if (cell.value === undefined) return "";
  return String(cell.value);
}

function scalarRuntime(value: CellScalar | undefined): CellRuntime {
  if (value === undefined) return { kind: "blank" };
  if (typeof value === "number") return { kind: "num", value };
  if (typeof value === "boolean") return { kind: "bool", value };
  return { kind: "str", value };
}

function runtimeText(runtime: CellRuntime, numberFormat: string | undefined): string {
  if (runtime.kind === "blank") return "";
  if (runtime.kind === "err") return runtime.value;
  if (runtime.kind === "num") return formatRuntimeText(runtime.value, numberFormat);
  if (runtime.kind === "bool") return runtime.value ? "TRUE" : "FALSE";
  return runtime.value;
}

export function applyUserInput(workbook: Workbook, address: string, text: string): Workbook {
  const key = address.toUpperCase();
  const next = cloneWorkbook(workbook);
  const existing = next.cells[key] ?? {};
  const style = pickStyle(existing);
  const trimmed = text.trim();
  if (!trimmed) {
    if (!hasStyle(style)) delete next.cells[key];
    else next.cells[key] = style;
    return next;
  }
  if (trimmed.startsWith("=")) {
    const check = checkFormula(trimmed);
    const cell: Cell = { ...style, formula: trimmed };
    if (!check.ok && (check.kind === "unsupported" || check.kind === "sheet" || check.kind === "bounds")) {
      cell.unsupported = true;
    }
    next.cells[key] = cell;
    return next;
  }
  const cell: Cell = { ...style, value: coerceEntry(trimmed) };
  next.cells[key] = cell;
  return next;
}

function coerceEntry(text: string): CellScalar {
  if (/^(true|false)$/i.test(text)) return text.toLowerCase() === "true";
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  return text;
}

function pickStyle(cell: Cell): Cell {
  const style: Cell = {};
  if (cell.bold) style.bold = true;
  if (cell.fill) style.fill = cell.fill;
  if (cell.numberFormat) style.numberFormat = cell.numberFormat;
  return style;
}

function hasStyle(cell: Cell): boolean {
  return Boolean(cell.bold || cell.fill || cell.numberFormat);
}

export function sameWorkbook(a: Workbook, b: Workbook): boolean {
  return stable(a) === stable(b);
}

function stable(workbook: Workbook): string {
  const cells = Object.keys(workbook.cells)
    .sort()
    .map((key) => [key, workbook.cells[key]]);
  const widths = Object.keys(workbook.columnWidths)
    .sort()
    .map((key) => [key, workbook.columnWidths[key]]);
  return JSON.stringify({ cells, widths });
}

export function numericAt(workbook: Workbook, address: string, cache: EvalCache): number | null {
  const cell = workbook.cells[address];
  if (cell?.unsupported) {
    return typeof cell.cached === "number" ? cell.cached : null;
  }
  const runtime = cell?.formula || cell?.value !== undefined ? evaluateCell(workbook, address, cache) : { kind: "blank" as const };
  if (runtime.kind === "num") return runtime.value;
  if (runtime.kind === "bool") return runtime.value ? 1 : 0;
  return null;
}

export function usedAddresses(workbook: Workbook): string[] {
  return Object.keys(workbook.cells).filter((address) => parseAddress(address));
}

export function ensureCache(workbook: Workbook): EvalCache {
  void workbook;
  return evaluationCache();
}

export function cellHasContent(cell: Cell | undefined): boolean {
  if (!cell) return false;
  return cell.value !== undefined || Boolean(cell.formula);
}

export { formatAddress };
