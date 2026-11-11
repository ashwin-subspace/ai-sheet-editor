import fs from "node:fs/promises";
import path from "node:path";
import { applySettingsUpdate, defaultSettings, normalizeStored, type StoredSettings } from "./provider";

/** Stored next to the project on the drive you run from (never under %USERPROFILE% or AppData). */
export const settingsPath = process.env.MODEL_SETTINGS_PATH
  ? path.resolve(process.env.MODEL_SETTINGS_PATH)
  : path.join(process.cwd(), "server", "model-settings.json");

export async function readSettings(file = settingsPath): Promise<StoredSettings> {
  try {
    return normalizeStored(JSON.parse(await fs.readFile(file, "utf8")) as unknown);
  } catch {
    return defaultSettings();
  }
}

export async function writeSettings(settings: StoredSettings, file = settingsPath): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const stored = normalizeStored(settings);
  await fs.writeFile(file, `${JSON.stringify(stored, null, 2)}\n`);
}

export async function updateSettings(
  update: { provider?: unknown; model?: unknown; apiKey?: unknown },
  file = settingsPath,
): Promise<StoredSettings> {
  const next = applySettingsUpdate(await readSettings(file), update);
  await writeSettings(next, file);
  return next;
}
