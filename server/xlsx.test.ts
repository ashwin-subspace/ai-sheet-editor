import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { backupIfExists } from "./backup";
import { bufferToWorkbook, workbookToBuffer } from "./xlsx";
import { createWorkbook } from "../src/engine/types";
import { cellView } from "../src/engine/workbook";
import { evaluationCache } from "../src/engine/formula";

describe("xlsx round trip", () => {
  it("keeps bold, fill, number format, column width, and SUM", async () => {
    const workbook = createWorkbook();
    workbook.cells.A1 = { value: "Budget", bold: true, fill: "#FFF2CC" };
    workbook.cells.B1 = { value: 1.5, numberFormat: "0.00", bold: true };
    workbook.cells.B2 = { value: 2 };
    workbook.cells.B3 = { value: 3 };
    workbook.cells.B4 = { formula: "=SUM(B2:B3)" };
    workbook.columnWidths.A = 18;

    const again = await bufferToWorkbook(await workbookToBuffer(workbook));
    expect(again.warnings).toEqual([]);
    expect(again.workbook.cells.A1?.bold).toBe(true);
    expect(again.workbook.cells.A1?.fill).toBe("#FFF2CC");
    expect(again.workbook.cells.B1?.numberFormat).toBe("0.00");
    expect(cellView(again.workbook, "B1", evaluationCache()).text).toBe("1.50");
    expect(again.workbook.cells.B4?.formula?.replace(/^=/, "")).toBe("SUM(B2:B3)");
    expect(cellView(again.workbook, "B4", evaluationCache()).text).toBe("5");
    expect(again.workbook.columnWidths.A).toBe(18);
  });

  it("warns about a second sheet and a merged cell without crashing", async () => {
    const book = new ExcelJS.Workbook();
    const first = book.addWorksheet("Main");
    const second = book.addWorksheet("Other");
    second.getCell("A1").value = "ignored";
    first.mergeCells("A1:B1");
    first.getCell("A1").value = "Top";
    first.getCell("A2").value = 1.5;
    first.getCell("A2").font = { bold: true, italic: true, name: "Arial", size: 20, color: { argb: "FFFF0000" } };
    first.getCell("A2").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } };
    first.getCell("A2").numFmt = "0.00";
    first.getCell("A2").border = { top: { style: "thin" } };
    first.getCell("C1").value = { formula: "SUM(C2:C3)", result: 3 };
    first.getCell("C2").value = 1;
    first.getCell("C3").value = 2;

    const loaded = await bufferToWorkbook(Buffer.from(await book.xlsx.writeBuffer()));
    expect(loaded.warnings.some((warning) => warning.includes("first worksheet"))).toBe(true);
    expect(loaded.warnings.some((warning) => /merge/i.test(warning))).toBe(true);
    expect(loaded.workbook.cells.A1?.value).toBe("Top");
    expect(loaded.workbook.cells.A2?.bold).toBe(true);
    expect(loaded.workbook.cells.A2?.fill).toBe("#FFF2CC");
    expect(loaded.workbook.cells.A2?.numberFormat).toBe("0.00");
    expect(cellView(loaded.workbook, "C1", evaluationCache()).text).toBe("3");
  });

  it("imports an empty workbook", async () => {
    const loaded = await bufferToWorkbook(await workbookToBuffer(createWorkbook()));
    expect(loaded.warnings).toEqual([]);
    expect(Object.keys(loaded.workbook.cells)).toHaveLength(0);
  });

  it("marks VLOOKUP as unsupported with a cached value", async () => {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet("Sheet1");
    sheet.getCell("A1").value = { formula: "VLOOKUP(A2,B1:C2,1)", result: 42 };
    const loaded = await bufferToWorkbook(Buffer.from(await book.xlsx.writeBuffer()));
    expect(loaded.workbook.cells.A1?.unsupported).toBe(true);
    expect(loaded.workbook.cells.A1?.cached).toBe(42);
  });

  it("warns when data is beyond row 200 and does not import it", async () => {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet("Sheet1");
    sheet.getCell("A201").value = "past cap";
    sheet.getCell("A1").value = "ok";
    const loaded = await bufferToWorkbook(Buffer.from(await book.xlsx.writeBuffer()));
    expect(loaded.warnings.some((w) => /beyond|200|sheet/i.test(w))).toBe(true);
    expect(loaded.workbook.cells.A201).toBeUndefined();
    expect(loaded.workbook.cells.A1?.value).toBe("ok");
  });
});

describe("backups", () => {
  it("keeps only the last five copies", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sheet-backup-"));
    const filePath = path.join(directory, "Budget.xlsx");
    await fs.writeFile(filePath, "one");
    for (let index = 0; index < 6; index += 1) {
      await fs.writeFile(filePath, `version ${index}`);
      await backupIfExists(filePath);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const backups = await fs.readdir(path.join(directory, "backups"));
    expect(backups.filter((name) => name.endsWith(".xlsx"))).toHaveLength(5);
  });
});
