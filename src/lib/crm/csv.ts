// Client-side CSV export helpers. Kept dependency-free so it works in the SSR
// build and the browser. Values are RFC-4180 quoted.

export function toCsv(rows: Record<string, string>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const esc = (v: string) => {
    const s = v ?? "";
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => esc(row[h] ?? "")).join(","));
  }
  return lines.join("\r\n");
}

// Trigger a browser download of the given rows as a .csv file. No-ops on the
// server (guards on `document`).
export function downloadCsv(filename: string, rows: Record<string, string>[]): void {
  if (typeof document === "undefined") return;
  const csv = toCsv(rows);
  // BOM so Excel opens UTF-8 correctly.
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const pad = (n: number) => String(n).padStart(2, "0");

export function stampedName(base: string): string {
  const d = new Date();
  return `${base}_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.csv`;
}
