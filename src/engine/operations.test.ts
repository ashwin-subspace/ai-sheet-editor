import { describe, expect, it } from "vitest";
import { normalizeSelection } from "./address";
import { createHistory, redoHistory, undoHistory } from "./history";
import { parseModelJson, reviewModelText } from "./operations";
import { SAMPLE_EDIT } from "./sample";
import { createWorkbook } from "./types";
import { applyUserInput, cellView, sameWorkbook } from "./workbook";
import { evaluationCache } from "./formula";

describe("model replies", () => {
  it("accepts one fenced JSON object", () => {
    const text = '```json\n{"message":"Hi","operations":[]}\n```';
    const review = reviewModelText(text, createWorkbook(), null);
    expect(review.ok).toBe(true);
    if (review.ok) expect(review.message).toBe("Hi");
  });

  it("rejects two JSON objects and prose", () => {
    const two = '{"message":"a","operations":[]}{"message":"b","operations":[]}';
    expect(parseModelJson(two).ok).toBe(false);
    expect(reviewModelText("please do this", createWorkbook(), null).ok).toBe(false);
  });

  it("keeps the object that contains edits when a second empty object is glued on", () => {
    const text = [
      '{"message":"Updated rows.","operations":[{"op":"write_range","start":"A2","rows":[["Rent","1000"]]}]}',
      "}",
      '{"message":"Updated rows.","operations":[]}',
    ].join("\n");
    const review = reviewModelText(text, createWorkbook(), null);
    expect(review.ok).toBe(true);
    if (review.ok) expect(review.operations).toHaveLength(1);
  });

  it("rejects a whole batch when one operation is illegal", () => {
    const book = createWorkbook();
    const text = JSON.stringify({
      message: "mixed",
      operations: [
        { op: "write_range", start: "A1", rows: [["Keep"]] },
        { op: "set_formula", cell: "B1", formula: "=VLOOKUP(A1,B1:C3,2,FALSE)" },
        { op: "write_range", start: "C1", rows: [["No"]] },
      ],
    });
    const review = reviewModelText(text, book, null);
    expect(review.ok).toBe(false);
    expect(sameWorkbook(book, createWorkbook())).toBe(true);
    if (!review.ok) expect(review.error).toMatch(/VLOOKUP/);
  });

  it("rejects circular formulas and keeps the sheet", () => {
    const book = createWorkbook();
    const review = reviewModelText(
      JSON.stringify({
        message: "cycle",
        operations: [{ op: "set_formula", cell: "A1", formula: "=A1+1" }],
      }),
      book,
      null,
    );
    expect(review.ok).toBe(false);
    expect(Object.keys(book.cells)).toHaveLength(0);
  });

  it("shows division by zero in the preview instead of retrying", () => {
    const review = reviewModelText(
      JSON.stringify({
        message: "div",
        operations: [{ op: "set_formula", cell: "A1", formula: "=1/0" }],
      }),
      createWorkbook(),
      null,
    );
    expect(review.ok).toBe(true);
    if (review.ok) expect(cellView(review.workbook, "A1", evaluationCache()).text).toBe("#DIV/0!");
  });

  it("warns when edits fall outside the selection but still applies them", () => {
    const review = reviewModelText(
      JSON.stringify({
        message: "outside",
        operations: [{ op: "write_range", start: "Z1", rows: [["Far"]] }],
      }),
      createWorkbook(),
      normalizeSelection("B2", "B10"),
    );
    expect(review.ok).toBe(true);
    if (review.ok) {
      expect(review.warning).toMatch(/outside the selection/i);
      expect(review.workbook.cells.Z1?.value).toBe("Far");
    }
  });

  it("previews the expense sample, then undo and redo restore it", () => {
    let history = createHistory(createWorkbook());
    const review = reviewModelText(SAMPLE_EDIT, history.present, null);
    expect(review.ok).toBe(true);
    if (!review.ok) return;
    expect(review.workbook.cells.A2?.value).toBe("Rent");
    expect(review.workbook.cells.A1?.bold).toBe(true);
    expect(review.workbook.cells.A1?.fill).toBe("#FFF2CC");
    expect(cellView(review.workbook, "D2", evaluationCache()).text).toBe("-100");
    expect(sameWorkbook(history.present, createWorkbook())).toBe(true);
    history = undoHistory(history);
    expect(history.present.cells.A2).toBeUndefined();
    history = { ...history, past: [], present: review.workbook, future: [] };
    const accepted = {
      past: [createWorkbook()],
      present: review.workbook,
      future: [],
    };
    const undone = undoHistory(accepted);
    expect(undone.present.cells.A2).toBeUndefined();
    const redone = redoHistory(undone);
    expect(redone.present.cells.A2?.value).toBe("Rent");
  });

  it("shifts formulas when a row is inserted inside a sum", () => {
    let book = createWorkbook();
    book = applyUserInput(book, "A1", "1");
    book = applyUserInput(book, "A2", "2");
    book = applyUserInput(book, "A3", "3");
    book = applyUserInput(book, "A4", "=SUM(A1:A3)");
    const review = reviewModelText(
      JSON.stringify({ message: "insert", operations: [{ op: "insert_rows", at: 2, count: 1 }] }),
      book,
      null,
    );
    expect(review.ok).toBe(true);
    if (!review.ok) return;
    expect(review.workbook.cells.A5?.formula).toBe("=SUM(A1:A4)");
    expect(cellView(review.workbook, "A5", evaluationCache()).text).toBe("6");
  });

  it("highlights only the greater cells", () => {
    let book = createWorkbook();
    book = applyUserInput(book, "B2", "100");
    book = applyUserInput(book, "C2", "150");
    book = applyUserInput(book, "B3", "100");
    book = applyUserInput(book, "C3", "50");
    const review = reviewModelText(
      JSON.stringify({
        message: "highlight",
        operations: [
          { op: "highlight_greater", leftRange: "C2:C3", rightRange: "B2:B3", fill: "#F4C7C3" },
        ],
      }),
      book,
      null,
    );
    expect(review.ok).toBe(true);
    if (!review.ok) return;
    expect(review.workbook.cells.C2?.fill).toBe("#F4C7C3");
    expect(review.workbook.cells.C3?.fill).toBeUndefined();
  });

  it("rejects an unknown field", () => {
    const review = reviewModelText(
      JSON.stringify({ message: "no", operations: [], delete_all: true }),
      createWorkbook(),
      null,
    );
    expect(review.ok).toBe(false);
  });
});
