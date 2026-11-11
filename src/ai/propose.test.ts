import { describe, expect, it } from "vitest";
import { proposeEdits, type CompletionRequest, type CompletionResult } from "./propose";
import { createWorkbook } from "../engine/types";

function scripted(responses: CompletionResult[]) {
  const calls: CompletionRequest[] = [];
  return {
    calls,
    complete: async (request: CompletionRequest): Promise<CompletionResult> => {
      calls.push(request);
      return responses.shift() ?? { ok: false, status: 500, error: "no more replies" };
    },
  };
}

const base = {
  workbook: createWorkbook(),
  selection: { anchor: "A1", end: "A1" },
  history: [],
  prompt: "Set A1 to Hello",
};

describe("proposeEdits", () => {
  it("falls back once when schema mode is rejected, and that fallback is not a repair", async () => {
    const fake = scripted([
      { ok: false, status: 400, error: "schema unsupported", schemaRejected: true },
      { ok: true, content: JSON.stringify({ message: "Set A1.", operations: [{ op: "write_range", start: "A1", rows: [["Hello"]] }] }) },
    ]);
    const result = await proposeEdits({ ...base, complete: fake.complete });
    expect(result.kind).toBe("preview");
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[0].response_format).toBeTruthy();
    expect(fake.calls[1].response_format).toBeUndefined();
    expect(fake.calls[0].temperature).toBe(0.1);
  });

  it("repairs an invalid reply twice and then stops without changing the sheet", async () => {
    const fake = scripted([
      { ok: true, content: "not json" },
      { ok: true, content: "still bad" },
      { ok: true, content: "nope" },
    ]);
    const result = await proposeEdits({ ...base, complete: fake.complete });
    expect(result.kind).toBe("error");
    expect(fake.calls).toHaveLength(3);
    expect(fake.calls[2].messages.at(-1)?.content).toMatch(/^Rejected:/);
    expect(base.workbook.cells.A1).toBeUndefined();
  });

  it("stops immediately when Ollama is unreachable", async () => {
    const fake = scripted([
      { ok: false, status: 503, error: "Connection refused at http://127.0.0.1:11434/v1. The sheet was not changed." },
    ]);
    const result = await proposeEdits({ ...base, complete: fake.complete });
    expect(result.kind).toBe("error");
    if (result.kind === "error") expect(result.message).toMatch(/Connection refused/);
    expect(fake.calls).toHaveLength(1);
  });

  it("asks again when a repair answers with no edits", async () => {
    const fake = scripted([
      { ok: true, content: "not json" },
      { ok: true, content: JSON.stringify({ message: "Added demo records.", operations: [] }) },
      { ok: true, content: JSON.stringify({ message: "Added a row.", operations: [{ op: "write_range", start: "A2", rows: [["Rent"]] }] }) },
    ]);
    const result = await proposeEdits({ ...base, complete: fake.complete });
    expect(result.kind).toBe("preview");
    expect(fake.calls).toHaveLength(3);
    expect(fake.calls[2].messages.at(-1)?.content).toMatch(/operations is empty/);
  });

  it("retries when an edit prompt comes back with no operations", async () => {
    const fake = scripted([
      { ok: true, content: JSON.stringify({ message: "Added the rows.", operations: [] }) },
      { ok: true, content: JSON.stringify({ message: "Added Rent.", operations: [{ op: "write_range", start: "A2", rows: [["Rent", 1000]] }] }) },
    ]);
    const result = await proposeEdits({ ...base, prompt: "Add a Rent row with a budget of 1000.", complete: fake.complete });
    expect(result.kind).toBe("preview");
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[1].messages.at(-1)?.content).toMatch(/operations is empty/);
  });

  it("rejects a table that was stuffed into one cell and asks for columns", async () => {
    const sentence = "entry my daily finance how much i left default starting 900";
    const fake = scripted([
      { ok: true, content: JSON.stringify({ message: "Created table in A1", operations: [{ op: "write_range", start: "A1", rows: [[sentence]] }] }) },
      { ok: true, content: JSON.stringify({ message: "Created the table.", operations: [{ op: "write_range", start: "A1", rows: [["Left", "Spent", "Item", "Result"], [900, 0, "opening", ""]] }] }) },
    ]);
    const result = await proposeEdits({
      ...base,
      prompt: "make table for me entry my daily finance",
      complete: fake.complete,
    });
    expect(result.kind).toBe("preview");
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[1].messages.at(-1)?.content).toMatch(/one cell, not a table/);
    if (result.kind === "preview") expect(result.review.changed).toContain("B1");
  });

  it("returns a message when the model answers without operations", async () => {
    const fake = scripted([{ ok: true, content: JSON.stringify({ message: "A1 is empty.", operations: [] }) }]);
    const result = await proposeEdits({ ...base, prompt: "What is in A1?", complete: fake.complete });
    expect(result).toEqual({ kind: "message", message: "A1 is empty." });
  });

  it("returns error when a repair call fails with 503", async () => {
    const fake = scripted([
      { ok: true, content: "not json" },
      { ok: false, status: 503, error: "Groq unreachable. The sheet was not changed." },
    ]);
    const result = await proposeEdits({ ...base, complete: fake.complete });
    expect(result.kind).toBe("error");
    expect(fake.calls).toHaveLength(2);
    expect(base.workbook.cells.A1).toBeUndefined();
  });

  it("stops after schema fallback when the second call also fails", async () => {
    const fake = scripted([
      { ok: false, status: 400, error: "schema unsupported", schemaRejected: true },
      { ok: false, status: 400, error: "Bad request. The sheet was not changed." },
    ]);
    const result = await proposeEdits({ ...base, complete: fake.complete });
    expect(result.kind).toBe("error");
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[1].response_format).toBeUndefined();
  });

  it("previews on the third call after two failed repairs", async () => {
    const good = JSON.stringify({
      message: "Set A1.",
      operations: [{ op: "write_range", start: "A1", rows: [["Hello"]] }],
    });
    const fake = scripted([
      { ok: true, content: JSON.stringify({ message: "x", operations: [{ op: "set_formula", cell: "A1", formula: "=VLOOKUP(A1,A1:B2,1)" }] }) },
      { ok: true, content: JSON.stringify({ message: "x", operations: [{ op: "format_range", range: "A1:AA2", bold: true }] }) },
      { ok: true, content: good },
    ]);
    const result = await proposeEdits({ ...base, complete: fake.complete });
    expect(result.kind).toBe("preview");
    expect(fake.calls).toHaveLength(3);
  });

  it("accepts valid JSON wrapped in markdown on a repair", async () => {
    const fenced = '```json\n{"message":"Set A1.","operations":[{"op":"write_range","start":"A1","rows":[["Hi"]]}]}\n```';
    const fake = scripted([
      { ok: true, content: "not json" },
      { ok: true, content: fenced },
    ]);
    const result = await proposeEdits({ ...base, complete: fake.complete });
    expect(result.kind).toBe("preview");
    expect(fake.calls).toHaveLength(2);
  });

  it("returns a message for a question when the sheet is not empty", async () => {
    const book = createWorkbook();
    book.cells.A1 = { value: "Rent" };
    const fake = scripted([{ ok: true, content: JSON.stringify({ message: "A1 is Rent.", operations: [] }) }]);
    const result = await proposeEdits({
      workbook: book,
      selection: base.selection,
      history: [],
      prompt: "What is in A1?",
      complete: fake.complete,
    });
    expect(result).toEqual({ kind: "message", message: "A1 is Rent." });
    expect(book.cells.A1?.value).toBe("Rent");
  });

  it("repairs write_range that wrongly includes count", async () => {
    const bad = JSON.stringify({
      message: "Added ten rows.",
      operations: [{ op: "write_range", start: "A3", count: 10, rows: [["Food", 400, 350, "=C3-B3"]] }],
    });
    const fake = scripted([
      { ok: true, content: bad },
      {
        ok: true,
        content: JSON.stringify({
          message: "Added rows.",
          operations: [
            {
              op: "write_range",
              start: "A3",
              rows: [
                ["Food", 400, 350, "=C3-B3"],
                ["Transport", 200, 180, "=C4-B4"],
              ],
            },
          ],
        }),
      },
    ]);
    const book = createWorkbook();
    book.cells.A1 = { value: "Category" };
    const result = await proposeEdits({
      workbook: book,
      selection: base.selection,
      history: [],
      prompt: "make ten more records with default values",
      complete: fake.complete,
    });
    expect(result.kind).toBe("preview");
    expect(fake.calls).toHaveLength(1);
    if (result.kind === "preview") expect(result.review.workbook.cells.A3?.value).toBe("Food");
  });
});
