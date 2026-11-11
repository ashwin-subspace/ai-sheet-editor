import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { dispatchRoute, xlsxPath } from "./handler";
import { createWorkbook } from "../src/engine/types";
import { workbookToBuffer } from "./xlsx";
import { defaultSettings } from "./provider";

async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "sheet-api-"));
}

function mockSettings(file: string) {
  return {
    readSettings: async () => defaultSettings(),
    updateSettings: async (update: Parameters<typeof import("./settings-store").updateSettings>[0]) => {
      const { updateSettings } = await import("./settings-store");
      return updateSettings(update, file);
    },
  };
}

describe("xlsxPath", () => {
  it("rejects non-xlsx and null bytes", () => {
    expect(xlsxPath(undefined)).toBeNull();
    expect(xlsxPath("notes.txt")).toBeNull();
    expect(xlsxPath("bad\u0000.xlsx")).toBeNull();
  });
});

describe("dispatchRoute ready", () => {
  it("returns readiness payload", async () => {
    const dir = await tempDir();
    const result = await dispatchRoute("GET", "/api/ready", new URLSearchParams(), undefined, {
      defaultDirectory: dir,
      ...mockSettings(path.join(dir, "s.json")),
      listProviderModels: async () => ({
        status: 200,
        payload: { models: ["llama3.1:8b"] },
      }),
    });
    expect(result.status).toBe(200);
    const body = result.payload as { ok?: boolean; issues?: unknown[] };
    expect(typeof body.ok).toBe("boolean");
    expect(Array.isArray(body.issues)).toBe(true);
  });
});

describe("dispatchRoute files", () => {
  it("returns 400 for open on a missing file", async () => {
    const dir = await tempDir();
    const missing = path.join(dir, "nope.xlsx");
    const result = await dispatchRoute("POST", "/api/open", new URLSearchParams(), { path: missing }, {
      defaultDirectory: dir,
      ...mockSettings(path.join(dir, "settings.json")),
    });
    expect(result.status).toBe(400);
    expect((result.payload as { error?: string }).error).toMatch(/open/i);
  });

  it("returns 400 for corrupt upload base64", async () => {
    const dir = await tempDir();
    const result = await dispatchRoute(
      "POST",
      "/api/open-upload",
      new URLSearchParams(),
      { fileName: "bad.xlsx", dataBase64: Buffer.from("not a zip").toString("base64") },
      { defaultDirectory: dir, ...mockSettings(path.join(dir, "s.json")) },
    );
    expect(result.status).toBe(400);
    expect((result.payload as { error?: string }).error).toBeDefined();
  });

  it("saves a backup and round-trips chat", async () => {
    const dir = await tempDir();
    const filePath = path.join(dir, "Book.xlsx");
    const initial = createWorkbook();
    initial.cells.A1 = { value: "v1", bold: true };
    await fs.writeFile(filePath, await workbookToBuffer(initial));
    const chatPath = filePath.replace(/\.xlsx$/i, ".chat.json");
    await fs.writeFile(chatPath, JSON.stringify({ messages: [{ role: "user", text: "hi" }] }));

    const next = createWorkbook();
    next.cells.A1 = { value: "v2", bold: true };
    const saved = await dispatchRoute(
      "POST",
      "/api/save",
      new URLSearchParams(),
      { path: filePath, workbook: next, chat: { messages: [{ role: "user", text: "save" }] } },
      { defaultDirectory: dir, ...mockSettings(path.join(dir, "s.json")) },
    );
    expect(saved.status).toBe(200);
    const backup = (saved.payload as { backup?: string }).backup;
    expect(backup).toBeTruthy();
    const backupBytes = await fs.readFile(backup!);
    const reopened = await dispatchRoute("POST", "/api/open", new URLSearchParams(), { path: filePath }, {
      defaultDirectory: dir,
      ...mockSettings(path.join(dir, "s.json")),
    });
    expect(reopened.status).toBe(200);
    const payload = reopened.payload as { workbook: typeof next; chat: { messages: unknown[] } };
    expect(payload.workbook.cells.A1?.value).toBe("v2");
    expect(payload.chat.messages).toHaveLength(1);
    expect(backupBytes.length).toBeGreaterThan(0);
  });

  it("opens with an empty chat when the sidecar is invalid", async () => {
    const dir = await tempDir();
    const filePath = path.join(dir, "Tiny.xlsx");
    const book = createWorkbook();
    book.cells.A1 = { value: "ok" };
    await fs.writeFile(filePath, await workbookToBuffer(book));
    await fs.writeFile(filePath.replace(/\.xlsx$/i, ".chat.json"), JSON.stringify({ messages: "nope" }));
    const opened = await dispatchRoute("POST", "/api/open", new URLSearchParams(), { path: filePath }, {
      defaultDirectory: dir,
      ...mockSettings(path.join(dir, "s.json")),
    });
    expect(opened.status).toBe(200);
    expect((opened.payload as { chat: { messages: unknown[] } }).chat.messages).toEqual([]);
  });
});
