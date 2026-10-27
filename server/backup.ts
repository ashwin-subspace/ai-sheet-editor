import fs from "node:fs/promises";
import path from "node:path";

export function backupStamp(date = new Date()): string {
  const part = (value: number, length = 2) => String(value).padStart(length, "0");
  return `${date.getFullYear()}${part(date.getMonth() + 1)}${part(date.getDate())}-${part(date.getHours())}${part(date.getMinutes())}${part(date.getSeconds())}-${part(date.getMilliseconds(), 3)}`;
}

/** Copies an existing workbook into a backups folder and keeps the last 5 copies. */
export async function backupIfExists(filePath: string): Promise<string | null> {
  try {
    await fs.access(filePath);
  } catch {
    return null;
  }
  const directory = path.dirname(filePath);
  const backupDir = path.join(directory, "backups");
  await fs.mkdir(backupDir, { recursive: true });
  const base = path.basename(filePath, path.extname(filePath));
  const destination = path.join(backupDir, `${base}-${backupStamp()}.xlsx`);
  await fs.copyFile(filePath, destination);
  const entries = (await fs.readdir(backupDir))
    .filter((name) => name.startsWith(`${base}-`) && name.toLowerCase().endsWith(".xlsx"))
    .sort();
  const stale = entries.slice(0, Math.max(0, entries.length - 5));
  await Promise.all(stale.map((name) => fs.unlink(path.join(backupDir, name))));
  return destination;
}
