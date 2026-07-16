import { useRef, useState } from "react";

import { Button, Modal } from "./ui";
import { toast } from "./toast";
import { parseCsv } from "../../lib/crm/csv";

// One importable field: the internal key we send to the server, a friendly
// label, whether it's required, and the header names we'll accept for it.
export type ImportField = {
  key: string;
  label: string;
  required?: boolean;
  aliases: string[];
};

// Given a parsed CSV row (keys already lower-cased) and the field spec, pull the
// first alias that has a value.
function pick(row: Record<string, string>, field: ImportField): string {
  for (const a of field.aliases) {
    const v = row[a.toLowerCase()];
    if (v != null && v.trim() !== "") return v.trim();
  }
  return "";
}

export function ImportCsvButton({
  label,
  fields,
  onImport,
  onDone,
  sampleHint,
}: {
  label: string;
  fields: ImportField[];
  onImport: (rows: Record<string, string>[]) => Promise<{ added: number }>;
  onDone: () => void;
  sampleHint?: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [fileName, setFileName] = useState("");
  const [skipped, setSkipped] = useState(0);
  const [busy, setBusy] = useState(false);

  const requiredKeys = fields.filter((f) => f.required).map((f) => f.key);

  function reset() {
    setRows([]);
    setFileName("");
    setSkipped(0);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    try {
      const text = await file.text();
      const parsed = parseCsv(text);
      const mapped: Record<string, string>[] = [];
      let dropped = 0;
      for (const raw of parsed) {
        const rec: Record<string, string> = {};
        for (const f of fields) {
          const val = pick(raw, f);
          if (val) rec[f.key] = val;
        }
        // Skip rows missing any required field.
        if (requiredKeys.every((k) => rec[k])) {
          mapped.push(rec);
        } else {
          dropped++;
        }
      }
      setRows(mapped);
      setSkipped(dropped);
      if (mapped.length === 0) {
        toast("No rows matched — check your column headers", "error");
      }
    } catch {
      toast("Couldn't read that file", "error");
    }
  }

  async function doImport() {
    if (rows.length === 0) return;
    setBusy(true);
    try {
      const res = await onImport(rows);
      toast(`Imported ${res.added} ${res.added === 1 ? "record" : "records"}`);
      setOpen(false);
      reset();
      onDone();
    } catch {
      toast("Import failed — please try again", "error");
    } finally {
      setBusy(false);
    }
  }

  const previewCols = fields.slice(0, 4);

  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          reset();
          setOpen(true);
        }}
      >
        Import CSV
      </Button>

      <Modal open={open} onClose={() => setOpen(false)} title={label} wide>
        <div className="space-y-4">
          <div className="rounded-lg border border-line bg-surface-2/40 px-3 py-2.5 text-xs text-mute">
            <div className="mb-1 font-medium text-bone">Expected columns</div>
            <div className="flex flex-wrap gap-1.5">
              {fields.map((f) => (
                <span
                  key={f.key}
                  className="rounded-md border border-line bg-surface px-1.5 py-0.5 font-mono text-[11px] text-mute"
                >
                  {f.aliases[0]}
                  {f.required ? <span className="text-signal"> *</span> : null}
                </span>
              ))}
            </div>
            {sampleHint ? <div className="mt-2 text-faint">{sampleHint}</div> : null}
          </div>

          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={onFile}
            className="block w-full text-sm text-mute file:mr-3 file:rounded-lg file:border-0 file:bg-signal-soft file:px-3 file:py-2 file:text-sm file:font-medium file:text-signal hover:file:bg-signal-soft/70"
          />

          {rows.length > 0 ? (
            <div>
              <div className="mb-2 text-sm text-mute">
                <span className="font-semibold text-bone">{rows.length}</span> row
                {rows.length === 1 ? "" : "s"} ready to import
                {skipped > 0 ? (
                  <span className="text-faint"> · {skipped} skipped (missing required field)</span>
                ) : null}
              </div>
              <div className="max-h-56 overflow-auto rounded-lg border border-line">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-surface-2">
                    <tr className="text-left font-mono uppercase tracking-wider text-faint">
                      {previewCols.map((f) => (
                        <th key={f.key} className="px-2.5 py-1.5 font-medium">
                          {f.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 8).map((r, i) => (
                      <tr key={i} className="border-t border-line/60">
                        {previewCols.map((f) => (
                          <td key={f.key} className="truncate px-2.5 py-1.5 text-mute">
                            {r[f.key] || "—"}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length > 8 ? (
                <div className="mt-1 text-[11px] text-faint">…and {rows.length - 8} more</div>
              ) : null}
            </div>
          ) : fileName ? (
            <div className="text-sm text-faint">No importable rows found in “{fileName}”.</div>
          ) : null}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={doImport} disabled={busy || rows.length === 0}>
              {busy ? "Importing…" : `Import ${rows.length || ""}`.trim()}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
