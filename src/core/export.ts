// CSV export. Cells are escaped per RFC 4180, and text that a spreadsheet could run as a formula is defused.
import { isShown, type Estimate } from "./stats";

export type CsvCell = string | number | null;

export interface CsvTable {
  /** Short description of what the table shows, written into the header comment. */
  title: string;
  columns: string[];
  rows: CsvCell[][];
}

export interface CsvMeta {
  dataVersion: string;
  builtAt: string;
}

/** Column names for the cells produced by estimateCells(). */
export const ESTIMATE_COLUMNS = [
  "isolates_with",
  "isolates_total",
  "percent",
  "ci95_low_percent",
  "ci95_high_percent",
  "confidence",
] as const;

/** Spreadsheet programs run text starting with these characters as formulas ("CSV injection"). */
const FORMULA_START = /^[=+\-@\t\r]/;

/** Turns one value into a safe CSV field: formula-defused, and quoted if it has commas, quotes or line breaks. */
export function escapeCsvCell(cell: CsvCell): string {
  if (cell === null) return "";
  if (typeof cell === "number") return Number.isFinite(cell) ? String(cell) : "";
  const text = FORMULA_START.test(cell) ? `'${cell}` : cell;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** Rounds a percentage to three decimals so exports are tidy but not lossy. */
function pct(p: number): number {
  return Number((p * 100).toFixed(3));
}

/** Splits an Estimate into export cells; hidden estimates export blank percentages, never a noisy number. */
export function estimateCells(e: Estimate): CsvCell[] {
  if (!isShown(e)) return [e.k, e.n, null, null, null, "hidden"];
  return [e.k, e.n, pct(e.p), pct(e.ci[0]), pct(e.ci[1]), e.flag === "low" ? "low" : "ok"];
}

/** Builds the CSV text: three comment rows (title, data version, disclaimer), the header, then the data rows. */
export function toCsv(table: CsvTable, meta: CsvMeta): string {
  const comment = (text: string): string => escapeCsvCell(`# ${text}`);
  const lines = [
    comment(`ResistanceScope export: ${table.title}`),
    comment(`Data version ${meta.dataVersion}; built ${meta.builtAt}`),
    comment(
      "Percentages are shares of sequenced isolates in public databases; not true prevalence; gene presence is not proof of resistance; educational use only; not for clinical decisions",
    ),
    table.columns.map(escapeCsvCell).join(","),
    ...table.rows.map((row) => row.map(escapeCsvCell).join(",")),
  ];
  return lines.join("\r\n") + "\r\n";
}
