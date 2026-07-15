import { useState } from "react";

import { getArchived, restoreCompany, restoreContact, restoreDeal, type ArchivedRow } from "../../lib/crm/data";
import { relativeTime } from "../../lib/crm/constants";
import { toast } from "./toast";

type Entity = "company" | "contact" | "deal";

const RESTORE: Record<Entity, (args: { data: { id: string } }) => Promise<unknown>> = {
  company: restoreCompany,
  contact: restoreContact,
  deal: restoreDeal,
};

// Collapsible "Show archived" drawer used on the companies, contacts and deals
// pages. Nothing is ever hard-deleted, so this is where archived records live and
// can be restored with one click.
export function ArchivedPanel({ entity, onRestored }: { entity: Entity; onRestored: () => void }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ArchivedRow[]>([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setRows(await getArchived({ data: { entity } }));
    } catch {
      toast("Couldn't load archived items", "error");
    } finally {
      setLoading(false);
    }
  }

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next) await load();
  }

  async function onRestore(id: string) {
    try {
      await RESTORE[entity]({ data: { id } });
      toast("Restored");
      await load();
      onRestored();
    } catch {
      toast("Restore failed", "error");
    }
  }

  const label = entity === "company" ? "companies" : entity === "contact" ? "contacts" : "deals";

  return (
    <div className="mt-4">
      <button
        onClick={toggle}
        className="flex items-center gap-1.5 text-xs font-medium text-faint transition-colors hover:text-mute"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={"transition-transform " + (open ? "rotate-90" : "")}
        >
          <path d="M9 6l6 6-6 6" />
        </svg>
        {open ? "Hide" : "Show"} archived {label}
      </button>

      {open ? (
        <div className="mt-2 rounded-lg border border-line bg-surface/60 p-2">
          {loading ? (
            <div className="px-2 py-3 text-center text-xs text-faint">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="px-2 py-3 text-center text-xs text-faint">Nothing archived.</div>
          ) : (
            <ul className="divide-y divide-line/60">
              {rows.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 px-2 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm text-mute line-through decoration-faint/50">{r.label}</div>
                    <div className="truncate text-[11px] text-faint">
                      {r.sub ? r.sub + " · " : ""}archived {relativeTime(r.archived_at, new Date())}
                    </div>
                  </div>
                  <button
                    onClick={() => onRestore(r.id)}
                    className="shrink-0 rounded-md border border-line px-2 py-1 text-xs font-medium text-signal transition-colors hover:border-signal/50 hover:bg-signal-soft"
                  >
                    Restore
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
