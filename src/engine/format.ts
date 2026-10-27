import { NUMBER_FORMATS, type NumberFormat } from "./types";

export function isKnownNumberFormat(format: string): format is NumberFormat {
  return (NUMBER_FORMATS as readonly string[]).includes(format);
}

function roundHalfAway(value: number, digits: number): number {
  const factor = 10 ** digits;
  const sign = value < 0 ? -1 : 1;
  return (sign * Math.round(Math.abs(value) * factor + Number.EPSILON)) / factor;
}

function generalNumber(value: number): string {
  if (!Number.isFinite(value)) return "#VALUE!";
  const rounded = roundHalfAway(value, 10);
  if (Object.is(rounded, -0)) return "0";
  return String(rounded);
}

function grouped(value: number, digits: number): string {
  return roundHalfAway(value, digits).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    useGrouping: true,
  });
}

/** Formats a number for the grid. Unknown Excel formats stay as the raw number. */
export function formatNumber(value: number, format: string | undefined): string {
  if (!format || format === "General" || !isKnownNumberFormat(format)) {
    return generalNumber(value);
  }
  if (format === "0") return String(roundHalfAway(value, 0));
  if (format === "0.00") return roundHalfAway(value, 2).toFixed(2);
  if (format === "#,##0") return grouped(value, 0);
  if (format === "#,##0.00") return grouped(value, 2);
  if (format === "0%") return `${roundHalfAway(value * 100, 0)}%`;
  return generalNumber(value);
}

export function formatRuntimeText(
  value: number | string | boolean,
  numberFormat: string | undefined,
): string {
  if (typeof value === "number") return formatNumber(value, numberFormat);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return value;
}
