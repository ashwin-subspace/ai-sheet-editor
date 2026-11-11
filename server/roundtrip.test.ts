import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { dispatchRoute } from "./handler";
import { createHistory, pushHistory } from "../src/engine/history";
import { reviewModelText } from "../src/engine/operations";
import { SAMPLE_EDIT } from "../src/engine/sample";
import { createWorkbook } from "../src/engine/types";
import { defaultSettings } from "./provider";
import { completeModel } from "../src/ui/preview-state";

describe("local workbook round trip", () => {
  it("saves, opens, applies sample edit, and reopens without a model", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sheet-roundtrip-"));
    const filePath = path.join(dir, "Trip.xlsx");
    const settingsFile = path.join(dir, "settings.json");
    const deps = {
      defaultDirectory: dir,
      readSettings: async () => defaultSettings(),
      updateSettings: async (update: Parameters<typeof import("./settings-store").updateSettings>[0]) => {
        const { updateSettings } = await import("./settings-store");
        return updateSettings(update, settingsFile);
      },
    };

    const initial = createWorkbook();
    initial.cells.A1 = { value: "Title", bold: true, fill: "#FFF2CC" };
    initial.cells.B2 = { value: 2 };
    initial.cells.B3 = { value: 3 };
    initial.cells.B4 = { formula: "=SUM(B2:B3)" };

    const saved = await dispatchRoute(
      "POST",
      "/api/save",
      new URLSearchParams(),
      {
        path: filePath,
        workbook: initial,
        chat: { messages: [{ role: "user", text: "hello" }] },
      },
      deps,
    );
    expect(saved.status).toBe(200);

    const opened = await dispatchRoute("POST", "/api/open", new URLSearchParams(), { path: filePath }, deps);
    expect(opened.status).toBe(200);
    const openBody = opened.payload as { workbook: typeof initial; chat: { messages: { text: string }[] }; warnings: string[] };
    expect(openBody.warnings).toEqual([]);
    expect(openBody.chat.messages[0]?.text).toBe("hello");

    const review = reviewModelText(SAMPLE_EDIT, openBody.workbook, null);
    expect(review.ok).toBe(true);
    if (!review.ok) return;
    const accepted = pushHistory(createHistory(openBody.workbook), review.workbook);

    const savedAgain = await dispatchRoute(
      "POST",
      "/api/save",
      new URLSearchParams(),
      { path: filePath, workbook: accepted.present, chat: openBody.chat },
      deps,
    );
    expect(savedAgain.status).toBe(200);

    const reopened = await dispatchRoute("POST", "/api/open", new URLSearchParams(), { path: filePath }, deps);
    const finalBook = (reopened.payload as { workbook: typeof initial }).workbook;
    expect(finalBook.cells.A1?.value).toBe("Category");
    expect(finalBook.cells.B4?.formula).toMatch(/SUM/);

    const offline = await completeModel(
      { messages: [], temperature: 0.1, max_tokens: 100 },
      async () => {
        throw new Error("ECONNREFUSED");
      },
    );
    expect(offline.ok).toBe(false);
  });
});
