import { describe, expect, it } from "vitest";
import { createWorkbook } from "./types";
import { evaluationCache } from "./formula";
import { applyUserInput, cellView, formulaBarText, sameWorkbook } from "./workbook";

describe("applyUserInput", () => {
  it("does not mutate the input workbook", () => {
    const original = createWorkbook();
    original.cells.A1 = { value: "Keep" };
    const next = applyUserInput(original, "B1", "New");
    expect(original.cells.B1).toBeUndefined();
    expect(next.cells.B1?.value).toBe("New");
  });

  it("clears value but keeps bold and fill", () => {
    let book = createWorkbook();
    book = applyUserInput(book, "A1", "x");
    book.cells.A1 = { ...book.cells.A1, bold: true, fill: "#FFF2CC" };
    book = applyUserInput(book, "A1", "");
    expect(book.cells.A1).toEqual({ bold: true, fill: "#FFF2CC" });
    expect(formulaBarText(book.cells.A1)).toBe("");
  });

  it("coerces booleans and numbers", () => {
    expect(applyUserInput(createWorkbook(), "A1", "TRUE").cells.A1?.value).toBe(true);
    expect(applyUserInput(createWorkbook(), "A1", "false").cells.A1?.value).toBe(false);
    expect(applyUserInput(createWorkbook(), "A1", "42").cells.A1?.value).toBe(42);
    expect(applyUserInput(createWorkbook(), "A1", "3.5").cells.A1?.value).toBe(3.5);
  });

  it("stores unsupported formulas without throwing and shows cached when set", () => {
    let book = applyUserInput(createWorkbook(), "A1", "=VLOOKUP(A2,A1:B2,1)");
    expect(book.cells.A1?.unsupported).toBe(true);
    expect(cellView(book, "A1", evaluationCache()).unsupported).toBe(true);
    book.cells.A1 = { ...book.cells.A1!, cached: 9 };
    expect(cellView(book, "A1", evaluationCache()).text).toBe("9");
  });

  it("renders syntax-error formulas in the bar without crashing cellView", () => {
    const book = applyUserInput(createWorkbook(), "A1", "=SUM(");
    expect(formulaBarText(book.cells.A1)).toBe("=SUM(");
    expect(() => cellView(book, "A1", evaluationCache())).not.toThrow();
    expect(cellView(book, "A1", evaluationCache()).text).toBe("#VALUE!");
  });
});

describe("sameWorkbook", () => {
  it("compares cells and column widths", () => {
    const a = createWorkbook();
    const b = createWorkbook();
    expect(sameWorkbook(a, b)).toBe(true);
    a.cells.A1 = { value: 1 };
    expect(sameWorkbook(a, b)).toBe(false);
  });
});
