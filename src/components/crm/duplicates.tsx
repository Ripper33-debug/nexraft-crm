import { useState } from "react";

import { getDuplicateGroups, mergeCompanies, mergeContacts } from "../../lib/crm/data";
import { toast } from "./toast";

type Entity = "company" | "contact";

type CompanyDupe = {
  id: string;
  name: string;
  phone: string | null;
  city: string | null;
  owner_id: string | null;
  created_at: string;
};
type ContactDupe = {
  id: string;
  first_name: string;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  company_id: string | null;
  owner_id: string | null;
  created_at: string;
};

// Collapsible "Find duplicates" drawer for the companies and contacts pages.
// Groups records that share a normalized name/phone (companies) or email/phone
// (contacts). Pick the record to keep; everything else in the group merges into
// it — references repoint, blank fields fill in, and the extras get archived
// (so a bad merge is recoverable from the archived drawer).
export function DuplicatesPanel({ entity, onMerged }: { entity: Entity; onMerged: () => void }) {
  const [open, setOpen] = useState(false);
  const [companyGroups, setCompanyGroups] = useState<CompanyDupe[][]>([]);
  const [contactGroups, setContactGroups] = useState<ContactDupe[][]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  // Selected keeper per group, keyed by group index.
  const [keepers, setKeepers] = useState<Record<number, string>>({});

  async function load() {
    setLoading(true);
    try {
      const res = await getDuplicateGroups();
      setCompanyGroups(res.companyGroups as CompanyDupe[][]);
      setContactGroups(res.contactGroups as ContactDupe[][]);
      setKeepers({});
    } catch {
      toast("Couldn't scan for duplicates", "error");
    } finally {
      setLoading(false);
    }
  }

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next) await load();
  }

  const groups: { id: string; label: string; detail: string }[][] = (
    entity === "company" ? companyGroups : contactGroups
  ).map((g) =>
    g.map((r) =>
      entity === "company"
        ? {
            id: r.id,
            label: (r as CompanyDupe).name,
            detail: [(r as CompanyDupe).phone, (r as CompanyDupe).city].filter(Boolean).join(" · "),
          }
        : {
            id: r.id,
            label: [(r as ContactDupe).first_name, (r as ContactDupe).last_name]
              .filter(Boolean)
              .join(" "),
            detail: [(r as ContactDupe).email, (r as ContactDupe).phone]
              .filter(Boolean)
              .join(" · "),
          },
    ),
  );

  async function mergeGroup(gi: number) {
    const group = groups[gi];
    const keepId = keepers[gi] ?? group[0].id;
    const losers = group.filter((r) => r.id !== keepId);
    if (losers.length === 0) return;
    setBusy(true);
    try {
      const fn = entity === "company" ? mergeCompanies : mergeContacts;
      for (const l of losers) {
        await fn({ data: { keep_id: keepId, merge_id: l.id } });
      }
      toast(`Merged ${losers.length} duplicate${losers.length === 1 ? "" : "s"}`);
      await load();
      onMerged();
    } catch (e) {
      toast(
        e instanceof Error && e.message.includes("FORBIDDEN")
          ? "You don't have edit access to every record in that group"
          : "Merge failed — please try again",
        "error",
      );
    } finally {
      setBusy(false);
    }
  }

  const label = entity === "company" ? "companies" : "contacts";

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
        {open ? "Hide" : "Find"} duplicate {label}
      </button>

      {open ? (
        <div className="mt-2 rounded-lg border border-line bg-surface/60 p-2">
          {loading ? (
            <div className="px-2 py-3 text-center text-xs text-faint">Scanning…</div>
          ) : groups.length === 0 ? (
            <div className="px-2 py-3 text-center text-xs text-faint">
              No duplicate {label} found. Nice and clean.
            </div>
          ) : (
            <div className="space-y-2">
              {groups.map((group, gi) => {
                const keepId = keepers[gi] ?? group[0].id;
                return (
                  <div key={gi} className="rounded-md border border-line/70 p-2">
                    <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-faint">
                      {group.length} matching records — choose which to keep
                    </div>
                    <ul className="divide-y divide-line/60">
                      {group.map((r) => (
                        <li key={r.id} className="flex items-center gap-2 py-1.5 text-sm">
                          <input
                            type="radio"
                            name={`dupe-${entity}-${gi}`}
                            checked={keepId === r.id}
                            onChange={() => setKeepers((k) => ({ ...k, [gi]: r.id }))}
                            className="accent-signal"
                          />
                          <span className="truncate">{r.label}</span>
                          {r.detail ? (
                            <span className="truncate text-xs text-faint">{r.detail}</span>
                          ) : null}
                          {keepId === r.id ? (
                            <span className="ml-auto shrink-0 rounded bg-signal-soft px-1.5 py-0.5 text-[10px] font-semibold text-signal">
                              KEEP
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                    <div className="mt-1.5 flex justify-end">
                      <button
                        disabled={busy}
                        onClick={() => mergeGroup(gi)}
                        className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-mute transition-colors hover:border-signal/60 hover:text-signal disabled:opacity-50"
                      >
                        {busy ? "Merging…" : `Merge into "${group.find((r) => r.id === keepId)?.label ?? ""}"`}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
