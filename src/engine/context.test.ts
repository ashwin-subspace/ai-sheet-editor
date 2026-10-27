import { describe, expect, it } from "vitest";
import { buildChatMessages, sheetSnapshot } from "./context";
import { createWorkbook } from "./types";

describe("sheet context", () => {
  it("includes the selection and says when cells were omitted", () => {
    const workbook = createWorkbook();
    for (let row = 1; row <= 120; row += 1) {
      workbook.cells[`A${row}`] = { value: row };
    }
    const snapshot = sheetSnapshot(workbook, { c1: 1, r1: 2, c2: 1, r2: 4 });
    expect(snapshot.omitted).toBe(true);
    expect(snapshot.text).toContain("A1:");
    expect(snapshot.text).toContain("A2:");
    expect(snapshot.text).not.toContain("A50:");
    const messages = buildChatMessages({
      workbook,
      selection: { anchor: "C2", end: "C6" },
      history: [
        { role: "user", text: "older question" },
        { role: "assistant", text: "older answer" },
        { role: "user", text: "should drop" },
      ],
      prompt: "What is in this selection?",
    });
    expect(messages[0].role).toBe("system");
    expect(messages.filter((message) => message.role !== "system")).toHaveLength(3);
    const last = messages[messages.length - 1].content;
    expect(last).toContain("Selection: C2:C6");
    expect(last).toContain("Other cells were omitted.");
    expect(last).toContain("What is in this selection?");
  });
});
