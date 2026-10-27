import ExcelJS from "exceljs";
import { colToIndex, formatAddress, indexToCol, parseAddress } from "../src/engine/address";
import { checkFormula, evaluateCell, evaluationCache, type EvalCache } from "../src/engine/formula";
import {
  COL_COUNT,
  ROW_COUNT,
  type Cell,
  type CellScalar,
  type Workbook,
  createWorkbook,
} from "../src/engine/types";

export interface ImportResult {
  workbook: Workbook;
  warnings: string[];
}

export async function workbookToBuffer(workbook: Workbook): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Sheet1");
  const cache = evaluationCache();
  for (const [address, cell] of Object.entries(workbook.cells)) {
    if (!parseAddress(address)) continue;
    writeCell(sheet.getCell(address), cell, address, workbook, cache);
  }
  for (const [letter, width] of Object.entries(workbook.columnWidths)) {
    const index = colToIndex(letter);
    if (index >= 1 && index <= COL_COUNT) sheet.getColumn(index).width = width;
  }
  const raw = await book.xlsx.writeBuffer();
  return Buffer.from(raw);
}

export async function bufferToWorkbook(data: Buffer): Promise<ImportResult> {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(data as unknown as Parameters<ExcelJS.Xlsx["load"]>[0]);
  const warnings: string[] = [];
  const workbook = createWorkbook();
  if (book.worksheets.length > 1) {
    warnings.push("Only the first worksheet was imported. Other sheets were dropped.");
  }
  const sheet = book.worksheets[0];
  if (!sheet) return { workbook, warnings };

  const merges = sheet.model?.merges ?? [];
  if (merges.length > 0) {
    warnings.push("Merged cells were dropped. Only the top-left value of each merge was kept.");
  }

  let droppedStyle = false;
  let droppedExtra = false;
  let dates = false;
  let beyond = false;

  const withRules = sheet as ExcelJS.Worksheet & { conditionalFormattings?: unknown[] };
  if ((withRules.conditionalFormattings ?? []).length > 0) droppedExtra = true;
  if (sheet.autoFilter && (sheet.autoFilter as { ref?: string }).ref) droppedExtra = true;
  if ((sheet.views ?? []).some((view) => view.state === "frozen")) droppedExtra = true;
  try {
    if (sheet.getImages().length > 0) droppedExtra = true;
  } catch {
    // Some workbooks have no drawing part. That is not a warning.
  }

  sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    if (rowNumber > ROW_COUNT) {
      beyond = true;
      return;
    }
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      if (colNumber > COL_COUNT) {
        beyond = true;
        return;
      }
      if (cell.isMerged && cell.master?.address && cell.address !== cell.master.address) return;
      const imported = readCell(cell);
      if (imported.droppedStyle) droppedStyle = true;
      if (imported.date) dates = true;
      if (imported.note || imported.extra) droppedExtra = true;
      if (!imported.cell) return;
      workbook.cells[formatAddress(colNumber, rowNumber)] = imported.cell;
    });
  });

  for (let column = 1; column <= COL_COUNT; column += 1) {
    const width = sheet.getColumn(column).width;
    if (typeof width === "number" && Number.isFinite(width)) {
      workbook.columnWidths[indexToCol(column)] = width;
    }
  }

  if (droppedStyle) {
    warnings.push("Some formatting was dropped (borders, italic, font name, size, and font color).");
  }
  if (dates) warnings.push("Date values were converted to text.");
  if (beyond) warnings.push("Cells beyond column Z or row 200 were dropped.");
  if (droppedExtra) {
    warnings.push("Conditional formatting, charts, images, comments, filters, freeze panes, or other Excel features were dropped.");
  }
  return { workbook, warnings };
}

function writeCell(
  target: ExcelJS.Cell,
  cell: Cell,
  address: string,
  workbook: Workbook,
  cache: EvalCache,
): void {
  if (cell.formula) {
    const formula = cell.formula.replace(/^=/, "");
    const result = formulaResult(cell, address, workbook, cache);
    target.value = result === undefined ? { formula } : { formula, result };
  } else if (cell.value !== undefined) {
    target.value = cell.value;
  }
  if (cell.bold) target.font = { bold: true };
  if (cell.fill) {
    target.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: `FF${cell.fill.replace("#", "")}` },
    };
  }
  if (cell.numberFormat) target.numFmt = cell.numberFormat;
}

function formulaResult(
  cell: Cell,
  address: string,
  workbook: Workbook,
  cache: EvalCache,
): string | number | boolean | undefined {
  if (cell.unsupported) return cell.cached;
  const runtime = evaluateCell(workbook, address, cache);
  if (runtime.kind === "num" || runtime.kind === "str" || runtime.kind === "bool" || runtime.kind === "err") {
    return runtime.value;
  }
  return undefined;
}

function readCell(cell: ExcelJS.Cell): {
  cell?: Cell;
  droppedStyle: boolean;
  date: boolean;
  note: boolean;
  extra: boolean;
} {
  const stored: Cell = {};
  let droppedStyle = false;
  let date = false;
  let note = Boolean(cell.note);
  const font = cell.font;
  if (font?.italic || font?.color || font?.underline || font?.strike) droppedStyle = true;
  if (font?.name && font.name !== "Calibri") droppedStyle = true;
  if (typeof font?.size === "number" && font.size !== 11) droppedStyle = true;
  if (cell.border && Object.values(cell.border).some(Boolean)) droppedStyle = true;
  if (font?.bold) stored.bold = true;

  const fill = cell.fill;
  if (fill && fill.type === "pattern" && fill.pattern === "solid") {
    const argb = fill.fgColor?.argb;
    const hex = argbToHex(argb);
    if (hex) stored.fill = hex;
    else if (fill.fgColor) droppedStyle = true;
  } else if (fill && fill.type !== "pattern") {
    droppedStyle = true;
  }

  if (cell.numFmt && cell.numFmt !== "General") stored.numberFormat = cell.numFmt;

  if (cell.formula) {
    const formula = cell.formula.startsWith("=") ? cell.formula : `=${cell.formula}`;
    stored.formula = formula;
    const check = checkFormula(formula);
    const cached = asScalar(cell.result);
    if (!check.ok) {
      stored.unsupported = true;
      if (cached !== undefined) stored.cached = cached;
    }
  } else if (cell.value instanceof Date) {
    stored.value = cell.value.toISOString();
    date = true;
  } else if (isRichText(cell.value)) {
    stored.value = cell.text;
    droppedStyle = true;
  } else if (isHyperlink(cell.value)) {
    stored.value = cell.value.text || cell.value.hyperlink;
    note = true;
  } else if (isErrorValue(cell.value)) {
    stored.value = String(cell.value.error ?? cell.value);
  } else if (typeof cell.value === "number" || typeof cell.value === "string" || typeof cell.value === "boolean") {
    stored.value = cell.value;
  }

  if (!stored.formula && stored.value === undefined && !stored.bold && !stored.fill && !stored.numberFormat) {
    return { droppedStyle, date, note, extra: false };
  }
  return { cell: stored, droppedStyle, date, note, extra: false };
}

function argbToHex(argb: string | undefined): string | undefined {
  if (!argb) return undefined;
  const hex = argb.length >= 6 ? argb.slice(-6) : argb;
  if (!/^[0-9A-Fa-f]{6}$/.test(hex)) return undefined;
  return `#${hex.toUpperCase()}`;
}

function asScalar(value: unknown): CellScalar | undefined {
  if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  return undefined;
}

function isRichText(value: ExcelJS.CellValue): value is ExcelJS.CellRichTextValue {
  return Boolean(value && typeof value === "object" && "richText" in value);
}

function isHyperlink(value: ExcelJS.CellValue): value is ExcelJS.CellHyperlinkValue {
  return Boolean(value && typeof value === "object" && "hyperlink" in value);
}

function isErrorValue(value: ExcelJS.CellValue): value is ExcelJS.CellErrorValue {
  return Boolean(value && typeof value === "object" && "error" in value);
}
