import { describe, expect, it } from "vitest";
import { createWorkbook } from "./types";
import { applyUserInput, cellView } from "./workbook";
import { evaluateFormula, evaluationCache } from "./formula";
import { formatNumber } from "./format";

function view(text: string, setup?: (book: ReturnType<typeof createWorkbook>) => void): string {
  let book = createWorkbook();
  setup?.(book);
  if (text.startsWith("=") && !setup) {
    book = applyUserInput(book, "B1", text);
    return cellView(book, "B1", evaluationCache()).text;
  }
  book = applyUserInput(book, "B1", text);
  return cellView(book, "B1", evaluationCache()).text;
}

describe("formulas", () => {
  it("follows arithmetic precedence and parentheses", () => {
    expect(view("=1+2*3")).toBe("7");
    expect(view("=(1+2)*3")).toBe("9");
  });

  it("sums a range and updates when an input changes", () => {
    let book = createWorkbook();
    book = applyUserInput(book, "A1", "1");
    book = applyUserInput(book, "A2", "2");
    book = applyUserInput(book, "A3", "3");
    book = applyUserInput(book, "B1", "=SUM(A1:A3)");
    expect(cellView(book, "B1", evaluationCache()).text).toBe("6");
    book = applyUserInput(book, "A1", "10");
    expect(cellView(book, "B1", evaluationCache()).text).toBe("15");
  });

  it("ignores blanks in AVERAGE and text in COUNT", () => {
    let book = createWorkbook();
    book = applyUserInput(book, "A1", "1");
    book = applyUserInput(book, "A3", "3");
    book = applyUserInput(book, "B1", "=AVERAGE(A1:A3)");
    expect(cellView(book, "B1", evaluationCache()).text).toBe("2");
    book = applyUserInput(book, "A2", "hello");
    book = applyUserInput(book, "C1", "=COUNT(A1:A3)");
    expect(cellView(book, "C1", evaluationCache()).text).toBe("2");
  });

  it("returns the chosen IF branch", () => {
    expect(view('=IF(1>2,"no","yes")')).toBe("yes");
    expect(view('=IF(2>1,"Over","Under")')).toBe("Over");
  });

  it("reports a circular reference instead of looping", () => {
    const book = applyUserInput(createWorkbook(), "A1", "=A1+1");
    expect(cellView(book, "A1", evaluationCache()).text).toBe("#CYCLE!");
  });

  it("reports division by zero", () => {
    expect(view("=1/0")).toBe("#DIV/0!");
  });

  it("evaluates a standalone formula the same way", () => {
    const book = applyUserInput(createWorkbook(), "A1", "4");
    expect(evaluateFormula("=A1+1", book).kind === "num" && evaluateFormula("=A1+1", book)).toMatchObject({
      kind: "num",
      value: 5,
    });
  });
});

describe("number formats", () => {
  it("renders the small format list and leaves unknown formats raw", () => {
    expect(formatNumber(1.6, "0")).toBe("2");
    expect(formatNumber(1.5, "0.00")).toBe("1.50");
    expect(formatNumber(1234.5, "#,##0")).toBe("1,235");
    expect(formatNumber(1234.5, "#,##0.00")).toBe("1,234.50");
    expect(formatNumber(0.5, "0%")).toBe("50%");
    expect(formatNumber(1.25, "dd/mm/yyyy")).toBe("1.25");
  });
});
