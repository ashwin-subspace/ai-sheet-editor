import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readSettings } from "./settings-store";

describe("settings-store", () => {
  it("returns Ollama defaults when the settings file is not JSON", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sheet-settings-"));
    const file = path.join(dir, "model-settings.json");
    await fs.writeFile(file, "not json", "utf8");
    const settings = await readSettings(file);
    expect(settings.provider).toBe("ollama");
    expect(settings.model).toBe("");
  });
});
