/**
 * Shared CSV helpers for the demo portal.
 *
 * `toCsv`/`downloadCsv` were previously duplicated verbatim in module-others and
 * module-payments; they live here now. `parseCsv` is used by bank/GCash
 * reconciliation to read an uploaded transaction-history file.
 */

export type CsvRow = (string | number)[];

/** Quote every cell (RFC-4180 style) and join into a CSV string. */
export function toCsv(rows: CsvRow[]): string {
  return rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
}

/** Trigger a browser download of `rows` as a CSV file. */
export function downloadCsv(filename: string, rows: CsvRow[]): void {
  const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8;" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * Minimal but correct CSV parser: handles quoted fields, escaped quotes (""),
 * embedded commas and newlines, and both \n and \r\n line endings. Returns a
 * grid of trimmed-free string cells (callers decide on trimming). Blank trailing
 * lines are dropped.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      // Swallow the \n of a \r\n pair.
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }
  // Flush the final field/row if the file didn't end with a newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Drop fully empty rows (e.g. blank separator lines from exports).
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
}
