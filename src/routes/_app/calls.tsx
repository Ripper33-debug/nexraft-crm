import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { getCompanies, getContacts, getDeals, getUsers, setCompanyCallOutcome } from "../../lib/crm/data";
import { Button, Card, EmptyState, PageHeader, Select, Input, OwnerChip, Pill, SummaryCard, Avatar } from "../../components/crm/ui";
import { CallMode } from "../../components/crm/call-mode";
import { toast } from "../../components/crm/toast";
import { OPEN_STAGES, relativeTime, daysBetween } from "../../lib/crm/constants";

type Row = Record<string, unknown>;
type Mode = "people" | "companies";

function fullName(c: Row): string {
  return `${(c.first_name as string) ?? ""} ${(c.last_name as string) ?? ""}`.trim();
}

export const Route = createFileRoute("/_app/calls")({
  loader: async () => {
    const [companies, contacts, users, deals] = await Promise.all([
      getCompanies(),
      getContacts(),
      getUsers(),
      getDeals(),
    ]);
    return { companies, contacts, users, deals };
  },
  component: CallsPage,
});

// Swipe-style triage for fresh companies (no deal yet, not yet triaged). Go
// through them one at a time: Interested / Not interested, or open Call mode.
function CallQueue({
  companies,
  onCall,
  onChanged,
}: {
  companies: Row[];
  onCall: (c: Row) => void;
  onChanged: () => void;
}) {
  const queue = useMemo(
    () => companies.filter((c) => Number(c.deal_count) === 0 && !c.call_outcome),
    [companies],
  );
  const [busy, setBusy] = useState(false);
  const total = queue.length;
  const current = queue[0];

  async function decide(outcome: "interested" | "not_interested") {
    if (!current || busy) return;
    setBusy(true);
    try {
      await setCompanyCallOutcome({ data: { id: current.id as string, outcome } });
      toast(outcome === "interested" ? "Marked interested" : "Marked not interested");
      onChanged();
    } catch {
      toast("Couldn't save — you may not own this one", "error");
    } finally {
      setBusy(false);
    }
  }

  if (total === 0) return null;
  const sub = [current.industry as string, current.city as string].filter(Boolean).join(" · ");

  return (
    <Card className="mt-5 border-signal/30 bg-gradient-to-b from-signal-soft/40 to-surface p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-signal text-[11px] font-bold text-ink">
            {total}
          </span>
          <span className="text-sm font-semibold text-bone">Need to call</span>
          <span className="text-xs text-mute">— fresh companies with no deal yet</span>
        </div>
        <span className="font-mono text-[11px] text-faint">{total} left</span>
      </div>

      <div className="mt-3 rounded-xl border border-line bg-surface p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-lg font-semibold text-bone">{current.name as string}</div>
            {sub ? <div className="mt-0.5 text-xs text-mute">{sub}</div> : null}
            <div className="mt-1 text-xs text-faint">
              {current.phone ? (current.phone as string) : "No phone on file"}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 text-xs text-faint">
            <span>Added by</span>
            {current.owner_name ? (
              <span className="inline-flex items-center gap-1 text-mute">
                <Avatar name={current.owner_name as string} size={18} />
                {current.owner_name as string}
              </span>
            ) : (
              <span className="text-faint">Unassigned</span>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button variant="danger" onClick={() => decide("not_interested")} disabled={busy}>
            ✕ Not interested
          </Button>
          <Button onClick={() => decide("interested")} disabled={busy}>
            ✓ Interested
          </Button>
          <button
            onClick={() => onCall(current)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-mute transition-colors hover:border-signal/50 hover:text-signal"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
            </svg>
            Call first
          </button>
        </div>
      </div>
    </Card>
  );
}

function CallsPage() {
  const { companies, contacts, users, deals } = Route.useLoaderData();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("people");
  const [query, setQuery] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [calling, setCalling] = useState<Row | null>(null);

  // Count open deals per company so a row can flag "live deal — worth a call".
  const openByCompany = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of deals as Row[]) {
      if (d.company_id && OPEN_STAGES.includes(d.stage as string)) {
        m.set(d.company_id as string, (m.get(d.company_id as string) ?? 0) + 1);
      }
    }
    return m;
  }, [deals]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = (mode === "people" ? (contacts as Row[]) : (companies as Row[])).filter((r) => {
      if (ownerFilter) {
        const oid = r.owner_id as string | null;
        if (ownerFilter === "__none__" ? !!oid : oid !== ownerFilter) return false;
      }
      if (!q) return true;
      const name = mode === "people" ? fullName(r) : (r.name as string);
      const extra =
        mode === "people"
          ? `${(r.company_name as string) ?? ""} ${(r.title as string) ?? ""}`
          : `${(r.industry as string) ?? ""} ${(r.city as string) ?? ""}`;
      return `${name} ${extra} ${(r.phone as string) ?? ""}`.toLowerCase().includes(q);
    });

    // Surface who needs a call: has a phone first, then longest since last contact
    // (people), or most open deals (companies).
    return [...base].sort((a, b) => {
      const ap = a.phone ? 1 : 0;
      const bp = b.phone ? 1 : 0;
      if (ap !== bp) return bp - ap;
      if (mode === "people") {
        const ad = a.last_contacted ? daysBetween(a.last_contacted as string) : 99999;
        const bd = b.last_contacted ? daysBetween(b.last_contacted as string) : 99999;
        return bd - ad;
      }
      const ao = openByCompany.get(a.id as string) ?? 0;
      const bo = openByCompany.get(b.id as string) ?? 0;
      if (ao !== bo) return bo - ao;
      return (a.name as string).localeCompare(b.name as string);
    });
  }, [mode, contacts, companies, query, ownerFilter, openByCompany]);

  const withPhone = rows.filter((r) => r.phone).length;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <PageHeader
        title="Calls"
        subtitle="Pick who to call and get a live, account-aware script with in-call prompts."
      />

      <CallQueue
        companies={companies as Row[]}
        onCall={(c) => setCalling(c)}
        onChanged={() => router.invalidate()}
      />

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <SummaryCard label="In this list" value={String(rows.length)} sub={mode === "people" ? "people" : "companies"} accent />
        <SummaryCard label="With a phone" value={String(withPhone)} sub="ready to dial" />
        <SummaryCard label="Open deals" value={String(openByCompany.size)} sub="accounts in play" />
      </div>

      {/* Controls */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
          {(["people", "companies"] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={
                "rounded-md px-3 py-1.5 text-xs font-semibold capitalize transition-all " +
                (mode === m ? "bg-signal-soft text-signal" : "text-mute hover:text-bone")
              }
            >
              {m}
            </button>
          ))}
        </div>

        <div className="min-w-[10rem] flex-1">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={mode === "people" ? "Search people, company, phone…" : "Search companies, city, phone…"}
            className="h-9 py-1.5 text-sm"
          />
        </div>

        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-faint">Owner</span>
          <Select
            value={ownerFilter}
            onChange={(e) => setOwnerFilter(e.target.value)}
            className="h-9 w-auto min-w-[9rem] py-1 text-xs"
          >
            <option value="">All owners</option>
            {(users as Row[]).map((u) => (
              <option key={u.id as string} value={u.id as string}>
                {u.name as string}
              </option>
            ))}
            <option value="__none__">Unassigned</option>
          </Select>
        </div>
      </div>

      <Card className="mt-3 overflow-hidden">
        <div className="divide-y divide-line/60">
          {rows.map((r) => {
            const name = mode === "people" ? fullName(r) : (r.name as string);
            const sub =
              mode === "people"
                ? [r.title as string, r.company_name as string].filter(Boolean).join(" · ")
                : [r.industry as string, r.city as string].filter(Boolean).join(" · ");
            const openCount = mode === "companies" ? openByCompany.get(r.id as string) ?? 0 : 0;
            const last = mode === "people" ? (r.last_contacted as string | null) : null;
            const stale = last ? daysBetween(last) : null;
            return (
              <div key={r.id as string} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2/50">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-bone">{name || "Unnamed"}</span>
                    {mode === "companies" && openCount > 0 ? (
                      <Pill tone="signal">{openCount} open</Pill>
                    ) : null}
                    {mode === "people" && !last ? <Pill tone="warn">never called</Pill> : null}
                    {mode === "people" && stale !== null && stale >= 30 ? (
                      <Pill tone="warn">{stale}d quiet</Pill>
                    ) : null}
                  </div>
                  {sub ? <div className="truncate text-xs text-mute">{sub}</div> : null}
                </div>

                <div className="hidden w-28 shrink-0 text-xs text-mute sm:block">
                  {r.phone ? (r.phone as string) : <span className="text-faint">No phone</span>}
                </div>

                <div className="hidden w-32 shrink-0 sm:block">
                  {mode === "people" ? (
                    <span className="text-xs text-mute">{last ? relativeTime(last) : <span className="text-faint">Never</span>}</span>
                  ) : (
                    <OwnerChip name={r.owner_name as string} />
                  )}
                </div>

                <button
                  onClick={() => setCalling(r)}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-gradient-to-b from-[#3ce0cd] to-signal-strong px-3 py-1.5 text-xs font-semibold text-ink shadow-[0_1px_2px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.3)] transition-all hover:shadow-[0_2px_14px_rgba(20,184,166,0.4)] active:translate-y-px"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
                  </svg>
                  Call
                </button>
              </div>
            );
          })}
        </div>
        {rows.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title={query || ownerFilter ? "Nobody matches these filters" : "Nothing to call yet"}
              hint={query || ownerFilter ? "Try clearing the search or owner filter." : "Add companies and contacts, then they'll show up here."}
            />
          </div>
        ) : null}
      </Card>

      <CallMode
        open={!!calling}
        onClose={() => setCalling(null)}
        subject={calling}
        kind={mode === "people" ? "contact" : "company"}
        deals={deals as Row[]}
        onLogged={() => router.invalidate()}
      />
    </div>
  );
}
