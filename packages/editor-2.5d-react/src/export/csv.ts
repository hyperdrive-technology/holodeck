/**
 * RFC 4180 CSV with spreadsheet formula-injection protection (holodeck#42).
 *
 * Every text cell comes from a document, and documents come from files and
 * other people: a component named `=HYPERLINK("http://evil","click")` must
 * open in Excel / Sheets / LibreOffice as text, not as a formula (OWASP
 * "CSV Injection"). Text cells that start with `=`, `+`, `-`, `@`, a tab or
 * a carriage return get a leading `'`, which every major spreadsheet treats
 * as "this is text" and hides. Numbers are written by us from finite values
 * (`-3` is a number, not a formula) and are never prefixed.
 */

/** One cell: text is escaped (and defused); finite numbers and booleans are written as is; null / undefined is empty. */
export type CsvCell = string | number | boolean | null | undefined;

/** Characters a spreadsheet may read as the start of a formula (or that hide one). */
const FORMULA_START = /^[=+\-@\t\r]/;
/** Cells with any of these must be quoted. */
const NEEDS_QUOTES = /[",\r\n]/;

/** One escaped cell. Non-finite numbers (NaN, Infinity) are written empty: they are not data. */
export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  const text = FORMULA_START.test(value) ? `'${value}` : value;
  return NEEDS_QUOTES.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Rows to CSV text: CRLF line ends (RFC 4180), a trailing CRLF, every row as wide as the header. */
export function toCsv(header: readonly string[], rows: readonly (readonly CsvCell[])[]): string {
  const width = header.length;
  const line = (cells: readonly CsvCell[]) => {
    const padded = cells.length >= width ? cells.slice(0, width) : [...cells, ...Array<CsvCell>(width - cells.length).fill('')];
    return padded.map(csvCell).join(',');
  };
  return [line(header), ...rows.map(line)].map((l) => `${l}\r\n`).join('');
}

/**
 * UTF-8 byte-order mark. Prepend it to a CSV file meant for Excel, which
 * otherwise opens UTF-8 (names with accents, units like °C) as Windows-1252.
 */
export const CSV_UTF8_BOM = '﻿';
