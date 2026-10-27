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

  it("stops immediately when LM Studio is unreachable", async () => {
    const fake = scripted([
      { ok: false, status: 503, error: "LM Studio is not running at http://localhost:1234. The sheet was not changed." },
    ]);
    const result = await proposeEdits({ ...base, complete: fake.complete });
    expect(result.kind).toBe("error");
    if (result.kind === "error") expect(result.message).toMatch(/not running/);
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
});
