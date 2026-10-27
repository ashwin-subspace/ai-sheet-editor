import {
  addressInRange,
  cellsInRange,
  colToIndex,
  formatAddress,
  formatRange,
  indexToCol,
  parseAddress,
  parseAddressLoose,
  parseRange,
  parseRangeLoose,
  type NormRange,
} from "./address";
import { checkFormula, colShift, hasCycle, rowShift, shiftFormula } from "./formula";
import { isKnownNumberFormat } from "./format";
import {
  cloneWorkbook,
  COL_COUNT,
  MAX_OPS,
  MAX_WRITE_COLS,
  MAX_WRITE_ROWS,
  ROW_COUNT,
  type Cell,
  type CellScalar,
  type Workbook,
} from "./types";
import { cellHasContent, numericAt } from "./workbook";
import { evaluationCache } from "./formula";

export type Operation =
  | { op: "write_range"; start: string; rows: CellScalar[][] }
  | { op: "set_formula"; cell: string; formula: string }
  | { op: "format_range"; range: string; bold?: boolean; fill?: string; numberFormat?: string }
  | { op: "insert_rows"; at: number; count: number }
  | { op: "insert_columns"; at: string; count: number }
  | { op: "clear_range"; range: string }
  | { op: "set_column_width"; column: string; width: number }
  | { op: "highlight_greater"; leftRange: string; rightRange: string; fill: string };

export type Review =
  | {
      ok: true;
      message: string;
      operations: Operation[];
      summaries: string[];
      warning?: string;
      workbook: Workbook;
      changed: string[];
      changedColumns: string[];
    }
  | { ok: false; error: string };

const ROOT_KEYS = new Set(["message", "operations"]);
const FILL = /^#[0-9A-Fa-f]{6}$/;

export function parseModelJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  let trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  if (fenced) trimmed = fenced[1].trim();
  const direct = jsonObject(trimmed);
  if (direct) return { ok: true, value: direct };
  const replies = extractJsonObjects(trimmed).filter(isReply);
  if (replies.length === 1) return { ok: true, value: replies[0] };
  const withEdits = replies.filter((reply) => reply.operations.length > 0);
  if (withEdits.length === 1) return { ok: true, value: withEdits[0] };
  return { ok: false, error: "Reply is not one JSON object." };
}

function jsonObject(text: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isReply(value: unknown): value is { operations: unknown[] } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const operations = (value as { operations?: unknown }).operations;
  return Array.isArray(operations);
}

function extractJsonObjects(text: string): unknown[] {
  const found: unknown[] = [];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "{") continue;
    const end = matchingBrace(text, index);
    if (end < 0) continue;
    const value = jsonObject(text.slice(index, end + 1));
    if (!value) continue;
    found.push(value);
    index = end;
  }
  return found;
}

function matchingBrace(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

export function reviewModelText(text: string, workbook: Workbook, selection: NormRange | null): Review {
  const parsed = parseModelJson(text);
  if (!parsed.ok) return { ok: false, error: `Rejected: ${parsed.error}` };
  return reviewValue(parsed.value, workbook, selection);
}

export function reviewValue(value: unknown, workbook: Workbook, selection: NormRange | null): Review {
  const read = readReply(value);
  if (!read.ok) return read;
  const original = workbook;
  const next = cloneWorkbook(workbook);
  const touched: string[] = [];
  for (let index = 0; index < read.operations.length; index += 1) {
    const applied = applyOperation(next, read.operations[index]);
    if (!applied.ok) {
      return { ok: false, error: `Rejected: operation ${index + 1} ${applied.error}` };
    }
    touched.push(...applied.touched);
  }
  if (hasCycle(next)) {
    return { ok: false, error: "Rejected: a formula creates a circular reference." };
  }
  const diff = diffWorkbook(original, next);
  let warning: string | undefined;
  if (selection && touched.some((address) => !addressInRange(address, selection))) {
    warning = "Some edits are outside the selection.";
  }
  return {
    ok: true,
    message: read.message,
    operations: read.operations,
    summaries: read.operations.map(summarize),
    warning,
    workbook: next,
    changed: diff.cells,
    changedColumns: diff.columns,
  };
}

function readReply(value: unknown): { ok: true; message: string; operations: Operation[] } | { ok: false; error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "Rejected: Reply is not one JSON object." };
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!ROOT_KEYS.has(key)) return { ok: false, error: `Rejected: unknown field ${key}.` };
  }
  if (!("operations" in record) || !Array.isArray(record.operations)) {
    return { ok: false, error: "Rejected: operations must be an array." };
  }
  if (record.operations.length > MAX_OPS) {
    return { ok: false, error: `Rejected: more than ${MAX_OPS} operations.` };
  }
  const message = record.message === undefined ? "" : record.message;
  if (typeof message !== "string") return { ok: false, error: "Rejected: message must be a string." };
  if (record.operations.length === 0 && message.trim() === "") {
    return { ok: false, error: "Rejected: empty operations and empty message." };
  }
  const operations: Operation[] = [];
  for (let index = 0; index < record.operations.length; index += 1) {
    const operation = readOperation(record.operations[index]);
    if (!operation.ok) return { ok: false, error: `Rejected: operation ${index + 1} ${operation.error}` };
    operations.push(operation.operation);
  }
  return { ok: true, message, operations };
}

function readOperation(value: unknown): { ok: true; operation: Operation } | { ok: false; error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "is not an object." };
  }
  const record = value as Record<string, unknown>;
  const op = record.op;
  if (typeof op !== "string") return { ok: false, error: "is missing op." };
  switch (op) {
    case "write_range":
      return readWrite(record);
    case "set_formula":
      return readFormula(record);
    case "format_range":
      return readFormat(record);
    case "insert_rows":
      return readInsertRows(record);
    case "insert_columns":
      return readInsertColumns(record);
    case "clear_range":
      return readClear(record);
    case "set_column_width":
      return readWidth(record);
    case "highlight_greater":
      return readHighlight(record);
    default:
      return { ok: false, error: `uses unknown operation ${op}.` };
  }
}

function extra(record: Record<string, unknown>, allowed: string[]): string | null {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) return `has unknown field ${key}.`;
  }
  return null;
}

function readWrite(record: Record<string, unknown>): { ok: true; operation: Operation } | { ok: false; error: string } {
  const unknown = extra(record, ["op", "start", "rows"]);
  if (unknown) return { ok: false, error: unknown };
  if (typeof record.start !== "string" || !parseRangeLoose(record.start) || record.start.includes(":")) {
    return { ok: false, error: "start must be a cell like A1." };
  }
  const start = parseAddressLoose(record.start);
  if (!start) return { ok: false, error: "start must be a cell like A1." };
  if (!parseAddress(record.start)) return { ok: false, error: "refers to a cell outside the sheet." };
  if (!Array.isArray(record.rows)) return { ok: false, error: "rows must be an array." };
  if (record.rows.length > MAX_WRITE_ROWS) return { ok: false, error: `write_range is bigger than ${MAX_WRITE_ROWS} rows.` };
  const rows: CellScalar[][] = [];
  let width = 0;
  for (const row of record.rows) {
    if (!Array.isArray(row)) return { ok: false, error: "rows must be arrays of values." };
    if (row.length > MAX_WRITE_COLS) return { ok: false, error: `write_range is bigger than ${MAX_WRITE_COLS} columns.` };
    width = Math.max(width, row.length);
    const values: CellScalar[] = [];
    for (const item of row) {
      const coerced = coerceCell(item);
      if (!coerced.ok) return coerced;
      values.push(coerced.value);
    }
    rows.push(values);
  }
  if (start.col + width - 1 > COL_COUNT || start.row + rows.length - 1 > ROW_COUNT) {
    return { ok: false, error: "refers to a cell outside the sheet." };
  }
  for (const row of rows) {
    for (const value of row) {
      if (typeof value === "string" && value.trim().startsWith("=")) {
        const check = checkFormula(value.trim());
        if (!check.ok) return { ok: false, error: check.error };
      }
    }
  }
  return { ok: true, operation: { op: "write_range", start: formatAddress(start.col, start.row), rows } };
}

function readFormula(record: Record<string, unknown>): { ok: true; operation: Operation } | { ok: false; error: string } {
  const unknown = extra(record, ["op", "cell", "formula"]);
  if (unknown) return { ok: false, error: unknown };
  if (typeof record.cell !== "string" || !parseAddress(record.cell)) {
    return { ok: false, error: "refers to a cell outside the sheet." };
  }
  if (typeof record.formula !== "string") return { ok: false, error: "formula must be a string." };
  const check = checkFormula(record.formula.trim());
  if (!check.ok) return { ok: false, error: check.error };
  return {
    ok: true,
    operation: { op: "set_formula", cell: record.cell.toUpperCase(), formula: record.formula.trim() },
  };
}

function readFormat(record: Record<string, unknown>): { ok: true; operation: Operation } | { ok: false; error: string } {
  const unknown = extra(record, ["op", "range", "bold", "fill", "numberFormat"]);
  if (unknown) return { ok: false, error: unknown };
  if (typeof record.range !== "string" || !parseRange(record.range)) {
    return { ok: false, error: "refers to a cell outside the sheet." };
  }
  if (record.bold === undefined && record.fill === undefined && record.numberFormat === undefined) {
    return { ok: false, error: "format_range needs bold, fill, or numberFormat." };
  }
  const operation: Operation = { op: "format_range", range: canonicalRange(record.range) };
  if (record.bold !== undefined) {
    if (typeof record.bold !== "boolean") return { ok: false, error: "bold must be true or false." };
    operation.bold = record.bold;
  }
  if (record.fill !== undefined) {
    if (typeof record.fill !== "string" || !FILL.test(record.fill)) {
      return { ok: false, error: "fill must be a color like #FFF2CC." };
    }
    operation.fill = record.fill.toUpperCase();
  }
  if (record.numberFormat !== undefined) {
    if (typeof record.numberFormat !== "string" || !isKnownNumberFormat(record.numberFormat)) {
      return { ok: false, error: "numberFormat is not in the allowed list." };
    }
    operation.numberFormat = record.numberFormat;
  }
  return { ok: true, operation };
}

function readInsertRows(record: Record<string, unknown>): { ok: true; operation: Operation } | { ok: false; error: string } {
  const unknown = extra(record, ["op", "at", "count"]);
  if (unknown) return { ok: false, error: unknown };
  const at = asInt(record.at);
  const count = asInt(record.count);
  if (at === null || at < 1 || at > ROW_COUNT) return { ok: false, error: "refers to a cell outside the sheet." };
  if (count === null || count < 1 || count > ROW_COUNT) return { ok: false, error: "count must be a positive number." };
  return { ok: true, operation: { op: "insert_rows", at, count } };
}

function readInsertColumns(record: Record<string, unknown>): { ok: true; operation: Operation } | { ok: false; error: string } {
  const unknown = extra(record, ["op", "at", "count"]);
  if (unknown) return { ok: false, error: unknown };
  if (typeof record.at !== "string") return { ok: false, error: "at must be a column letter." };
  const col = colToIndex(record.at);
  if (col < 1 || col > COL_COUNT || !/^[A-Za-z]+$/.test(record.at)) {
    return { ok: false, error: "refers to a cell outside the sheet." };
  }
  const count = asInt(record.count);
  if (count === null || count < 1 || count > COL_COUNT) return { ok: false, error: "count must be a positive number." };
  return { ok: true, operation: { op: "insert_columns", at: indexToCol(col), count } };
}

function readClear(record: Record<string, unknown>): { ok: true; operation: Operation } | { ok: false; error: string } {
  const unknown = extra(record, ["op", "range"]);
  if (unknown) return { ok: false, error: unknown };
  if (typeof record.range !== "string" || !parseRange(record.range)) {
    return { ok: false, error: "refers to a cell outside the sheet." };
  }
  return { ok: true, operation: { op: "clear_range", range: canonicalRange(record.range) } };
}

function readWidth(record: Record<string, unknown>): { ok: true; operation: Operation } | { ok: false; error: string } {
  const unknown = extra(record, ["op", "column", "width"]);
  if (unknown) return { ok: false, error: unknown };
  if (typeof record.column !== "string") return { ok: false, error: "column must be a letter." };
  const col = colToIndex(record.column);
  if (col < 1 || col > COL_COUNT || !/^[A-Za-z]+$/.test(record.column)) {
    return { ok: false, error: "refers to a cell outside the sheet." };
  }
  const width = asNumber(record.width);
  if (width === null || width < 0 || width > 255) return { ok: false, error: "width must be between 0 and 255." };
  return { ok: true, operation: { op: "set_column_width", column: indexToCol(col), width } };
}

function readHighlight(record: Record<string, unknown>): { ok: true; operation: Operation } | { ok: false; error: string } {
  const unknown = extra(record, ["op", "leftRange", "rightRange", "fill"]);
  if (unknown) return { ok: false, error: unknown };
  if (typeof record.leftRange !== "string" || typeof record.rightRange !== "string") {
    return { ok: false, error: "highlight_greater needs two ranges." };
  }
  const left = parseRange(record.leftRange);
  const right = parseRange(record.rightRange);
  if (!left || !right) return { ok: false, error: "refers to a cell outside the sheet." };
  if (left.c2 - left.c1 !== right.c2 - right.c1 || left.r2 - left.r1 !== right.r2 - right.r1) {
    return { ok: false, error: "highlight_greater ranges must be the same size." };
  }
  if (left.r2 - left.r1 + 1 > MAX_WRITE_ROWS || left.c2 - left.c1 + 1 > MAX_WRITE_COLS) {
    return { ok: false, error: "highlight_greater range is too big." };
  }
  if (typeof record.fill !== "string" || !FILL.test(record.fill)) {
    return { ok: false, error: "fill must be a color like #F4C7C3." };
  }
  return {
    ok: true,
    operation: {
      op: "highlight_greater",
      leftRange: formatRange(left),
      rightRange: formatRange(right),
      fill: record.fill.toUpperCase(),
    },
  };
}

function applyOperation(workbook: Workbook, operation: Operation): { ok: true; touched: string[] } | { ok: false; error: string } {
  switch (operation.op) {
    case "write_range":
      return applyWrite(workbook, operation);
    case "set_formula":
      return applySetFormula(workbook, operation);
    case "format_range":
      return applyFormat(workbook, operation);
    case "insert_rows":
      return applyInsertRows(workbook, operation.at, operation.count);
    case "insert_columns":
      return applyInsertColumns(workbook, colToIndex(operation.at), operation.count);
    case "clear_range":
      return applyClear(workbook, operation.range);
    case "set_column_width":
      workbook.columnWidths[operation.column] = operation.width;
      return { ok: true, touched: [`${operation.column}1`] };
    case "highlight_greater":
      return applyHighlight(workbook, operation);
    default:
      return { ok: false, error: "uses an unknown operation." };
  }
}

function applyWrite(
  workbook: Workbook,
  operation: Extract<Operation, { op: "write_range" }>,
): { ok: true; touched: string[] } | { ok: false; error: string } {
  const start = parseAddress(operation.start);
  if (!start) return { ok: false, error: "refers to a cell outside the sheet." };
  const touched: string[] = [];
  operation.rows.forEach((row, r) => {
    row.forEach((value, c) => {
      const address = formatAddress(start.col + c, start.row + r);
      touched.push(address);
      writeScalar(workbook, address, value);
    });
  });
  return { ok: true, touched };
}

function writeScalar(workbook: Workbook, address: string, value: CellScalar): void {
  const style = styleOf(workbook.cells[address]);
  if (typeof value === "string" && value.trim() === "") {
    if (!hasStyle(style)) delete workbook.cells[address];
    else workbook.cells[address] = style;
    return;
  }
  if (typeof value === "string" && value.trim().startsWith("=")) {
    workbook.cells[address] = { ...style, formula: value.trim() };
    return;
  }
  const stored = typeof value === "string" ? coerceLoose(value) : value;
  if (stored === "") {
    if (!hasStyle(style)) delete workbook.cells[address];
    else workbook.cells[address] = style;
    return;
  }
  workbook.cells[address] = { ...style, value: stored };
}

function applySetFormula(
  workbook: Workbook,
  operation: Extract<Operation, { op: "set_formula" }>,
): { ok: true; touched: string[] } {
  const style = styleOf(workbook.cells[operation.cell]);
  workbook.cells[operation.cell] = { ...style, formula: operation.formula };
  return { ok: true, touched: [operation.cell] };
}

function applyFormat(
  workbook: Workbook,
  operation: Extract<Operation, { op: "format_range" }>,
): { ok: true; touched: string[] } {
  const range = parseRange(operation.range);
  if (!range) return { ok: true, touched: [] };
  const touched = cellsInRange(range);
  for (const address of touched) {
    const cell = { ...(workbook.cells[address] ?? {}) };
    if (operation.bold !== undefined) {
      if (operation.bold) cell.bold = true;
      else delete cell.bold;
    }
    if (operation.fill !== undefined) cell.fill = operation.fill;
    if (operation.numberFormat !== undefined) cell.numberFormat = operation.numberFormat;
    if (isEmptyCell(cell)) delete workbook.cells[address];
    else workbook.cells[address] = cell;
  }
  return { ok: true, touched };
}

function applyClear(workbook: Workbook, rangeText: string): { ok: true; touched: string[] } {
  const range = parseRange(rangeText);
  if (!range) return { ok: true, touched: [] };
  const touched = cellsInRange(range);
  for (const address of touched) {
    const style = styleOf(workbook.cells[address]);
    if (!hasStyle(style)) delete workbook.cells[address];
    else workbook.cells[address] = style;
  }
  return { ok: true, touched };
}

function applyInsertRows(
  workbook: Workbook,
  at: number,
  count: number,
): { ok: true; touched: string[] } | { ok: false; error: string } {
  const moved = moveCells(workbook, (ref) => rowShift(ref, at, count), (col, row) => {
    const nextRow = row >= at ? row + count : row;
    if (nextRow > ROW_COUNT) return null;
    return formatAddress(col, nextRow);
  });
  if (typeof moved === "string") return { ok: false, error: moved };
  workbook.cells = moved;
  const touched = Object.keys(moved).filter((address) => {
    const pos = parseAddress(address);
    return pos ? pos.row >= at : false;
  });
  return { ok: true, touched };
}

function applyInsertColumns(
  workbook: Workbook,
  at: number,
  count: number,
): { ok: true; touched: string[] } | { ok: false; error: string } {
  const moved = moveCells(workbook, (ref) => colShift(ref, at, count), (col, row) => {
    const nextCol = col >= at ? col + count : col;
    if (nextCol > COL_COUNT) return null;
    return formatAddress(nextCol, row);
  });
  if (typeof moved === "string") return { ok: false, error: moved };
  workbook.cells = moved;
  const widths: Record<string, number> = {};
  for (const [letter, width] of Object.entries(workbook.columnWidths)) {
    const col = colToIndex(letter);
    const next = col >= at ? col + count : col;
    if (next > COL_COUNT) return { ok: false, error: "would push a column off the sheet." };
    widths[indexToCol(next)] = width;
  }
  workbook.columnWidths = widths;
  const touched = Object.keys(moved).filter((address) => {
    const pos = parseAddress(address);
    return pos ? pos.col >= at : false;
  });
  if (touched.length === 0) touched.push(formatAddress(at, 1));
  return { ok: true, touched };
}

function moveCells(
  workbook: Workbook,
  shiftRef: Parameters<typeof shiftFormula>[1],
  moveAddress: (col: number, row: number) => string | null,
): Record<string, Cell> | string {
  const next: Record<string, Cell> = {};
  for (const [address, cell] of Object.entries(workbook.cells)) {
    const pos = parseAddressLoose(address);
    if (!pos) continue;
    let formula = cell.formula;
    if (formula) {
      const shifted = shiftFormula(formula, shiftRef);
      if (shifted.overflow) return "would push a formula reference off the sheet.";
      formula = shifted.formula;
    }
    const target = moveAddress(pos.col, pos.row);
    if (!target) return "would push cells off the sheet.";
    next[target] = formula === cell.formula ? { ...cell } : { ...cell, formula };
  }
  return next;
}

function applyHighlight(
  workbook: Workbook,
  operation: Extract<Operation, { op: "highlight_greater" }>,
): { ok: true; touched: string[] } {
  const left = parseRange(operation.leftRange);
  const right = parseRange(operation.rightRange);
  if (!left || !right) return { ok: true, touched: [] };
  const cache = evaluationCache();
  const touched: string[] = [];
  const rows = left.r2 - left.r1;
  const cols = left.c2 - left.c1;
  for (let r = 0; r <= rows; r += 1) {
    for (let c = 0; c <= cols; c += 1) {
      const leftAddr = formatAddress(left.c1 + c, left.r1 + r);
      const rightAddr = formatAddress(right.c1 + c, right.r1 + r);
      const leftValue = numericAt(workbook, leftAddr, cache);
      const rightValue = numericAt(workbook, rightAddr, cache);
      touched.push(leftAddr);
      if (leftValue === null || rightValue === null || !(leftValue > rightValue)) continue;
      const cell = { ...(workbook.cells[leftAddr] ?? {}) };
      cell.fill = operation.fill;
      workbook.cells[leftAddr] = cell;
    }
  }
  return { ok: true, touched };
}

export function summarize(operation: Operation): string {
  switch (operation.op) {
    case "write_range": {
      const start = parseAddress(operation.start);
      const rows = operation.rows.length;
      const cols = operation.rows.reduce((max, row) => Math.max(max, row.length), 0);
      const end = start ? formatAddress(start.col + Math.max(cols - 1, 0), start.row + Math.max(rows - 1, 0)) : operation.start;
      return `Write ${operation.start}${end !== operation.start ? `:${end}` : ""}.`;
    }
    case "set_formula":
      return `Set ${operation.cell} to ${operation.formula}.`;
    case "format_range": {
      const parts: string[] = [];
      if (operation.bold !== undefined) parts.push(operation.bold ? `Bold ${operation.range}` : `Remove bold ${operation.range}`);
      if (operation.fill) parts.push(`Fill ${operation.range} with ${operation.fill}`);
      if (operation.numberFormat) parts.push(`Number format ${operation.range} as ${operation.numberFormat}`);
      return `${parts.join(", ")}.`;
    }
    case "insert_rows":
      return `Insert ${operation.count} row${operation.count === 1 ? "" : "s"} at row ${operation.at}.`;
    case "insert_columns":
      return `Insert ${operation.count} column${operation.count === 1 ? "" : "s"} at ${operation.at}.`;
    case "clear_range":
      return `Clear ${operation.range}.`;
    case "set_column_width":
      return `Set column ${operation.column} width to ${operation.width}.`;
    case "highlight_greater":
      return `Highlight cells in ${operation.leftRange} that are greater than ${operation.rightRange}.`;
    default:
      return "Edit.";
  }
}

export function diffWorkbook(before: Workbook, after: Workbook): { cells: string[]; columns: string[] } {
  const addresses = new Set([...Object.keys(before.cells), ...Object.keys(after.cells)]);
  const cells: string[] = [];
  for (const address of addresses) {
    if (JSON.stringify(before.cells[address] ?? null) !== JSON.stringify(after.cells[address] ?? null)) {
      cells.push(address);
    }
  }
  cells.sort();
  const letters = new Set([...Object.keys(before.columnWidths), ...Object.keys(after.columnWidths)]);
  const columns: string[] = [];
  for (const letter of letters) {
    if (before.columnWidths[letter] !== after.columnWidths[letter]) columns.push(letter);
  }
  columns.sort();
  return { cells, columns };
}

function coerceCell(value: unknown): { ok: true; value: CellScalar } | { ok: false; error: string } {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return { ok: false, error: "has a value that is not a string, number, or boolean." };
    return { ok: true, value };
  }
  if (typeof value === "boolean") return { ok: true, value };
  if (typeof value === "string") return { ok: true, value: coerceLoose(value) === "" ? "" : coerceLoose(value) };
  return { ok: false, error: "has a value that is not a string, number, or boolean." };
}

function coerceLoose(text: string): CellScalar {
  const trimmed = text.trim();
  if (trimmed === "") return "";
  if (/^(true|false)$/i.test(trimmed)) return trimmed.toLowerCase() === "true";
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}

function asInt(value: unknown): number | null {
  const number = asNumber(value);
  if (number === null || !Number.isInteger(number)) return null;
  return number;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim())) return Number(value.trim());
  return null;
}

function canonicalRange(input: string): string {
  const range = parseRange(input);
  return range ? formatRange(range) : input.toUpperCase();
}

function styleOf(cell: Cell | undefined): Cell {
  if (!cell) return {};
  const style: Cell = {};
  if (cell.bold) style.bold = true;
  if (cell.fill) style.fill = cell.fill;
  if (cell.numberFormat) style.numberFormat = cell.numberFormat;
  return style;
}

function hasStyle(cell: Cell): boolean {
  return Boolean(cell.bold || cell.fill || cell.numberFormat);
}

function isEmptyCell(cell: Cell): boolean {
  return !cellHasContent(cell) && !hasStyle(cell);
}
