import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { getCompanies, getContacts, getDeals, getUsers, setCompanyCallOutcome } from "../../lib/crm/data";
import { Button, Card, EmptyState, Modal, PageHeader, Select, Input, OwnerChip, Pill, SummaryCard, Avatar } from "../../components/crm/ui";
import { CallMode } from "../../components/crm/call-mode";
import { toast } from "../../components/crm/toast";
import { fireConfetti } from "../../lib/crm/confetti";
import {
  OPEN_STAGES,
  relativeTime,
  daysBetween,
  formatMoney,
  PRICING_PACKAGES,
} from "../../lib/crm/constants";

type Row = Record<string, unknown>;
type Mode = "people" | "companies";

function fullName(c: Row): string {
  return `${(c.first_name as string) ?? ""} ${(c.last_name as string) ?? ""}`.trim();
}

export const Route = createFileRoute("/_app/calls")({
  loader: async ({ context }) => {
    const [companies, contacts, users, deals] = await Promise.all([
      getCompanies(),
      getContacts(),
      getUsers(),
      getDeals(),
    ]);
    const me = (context as { user?: { id: string; role: string } }).user ?? null;
    return { companies, contacts, users, deals, me };
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
    () => companies.filter((c) => !c.call_outcome),
    [companies],
  );
  const [busy, setBusy] = useState(false);
  const total = queue.length;
  const current = queue[0];

  async function decide(outcome: "interested" | "not_interested" | "maybe") {
    if (!current || busy) return;
    setBusy(true);
    try {
      await setCompanyCallOutcome({ data: { id: current.id as string, outcome } });
      toast(
        outcome === "interested"
          ? "Marked Yes"
          : outcome === "maybe"
            ? "Marked Maybe"
            : "Marked No",
      );
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
          <Button onClick={() => decide("interested")} disabled={busy}>
            ✓ Yes
          </Button>
          <button
            onClick={() => decide("maybe")}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-300 transition-colors hover:bg-amber-500/20 disabled:opacity-50"
          >
            ~ Maybe
          </button>
          <Button variant="danger" onClick={() => decide("not_interested")} disabled={busy}>
            ✕ No
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

// When a company is marked "Signed", the rep picks which package they sold. That
// sets the deal value + monthly plan and spins up a won deal behind the scenes.
function SignModal({
  company,
  open,
  onClose,
  onSigned,
}: {
  company: Row | null;
  open: boolean;
  onClose: () => void;
  onSigned: () => void;
}) {
  const [picked, setPicked] = useState<string>("business"); // Business is the default rec
  const [busy, setBusy] = useState(false);

  async function confirm() {
    if (!company || busy) return;
    const pkg = PRICING_PACKAGES.find((p) => p.id === picked);
    if (!pkg) return;
    setBusy(true);
    try {
      await setCompanyCallOutcome({
        data: {
          id: company.id as string,
          outcome: "signed",
          package: pkg.name,
          value: pkg.build,
          monthly_value: pkg.monthly,
        },
      });
      fireConfetti();
      toast(`🎉 ${company.name as string} signed on the ${pkg.name} package`);
      onSigned();
      onClose();
    } catch {
      toast("Couldn't save — you may not own this one", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={company ? `${company.name as string} signed 🎉` : "Signed"} wide>
      <p className="text-sm text-mute">
        Nice work. Pick the package they signed up for — this sets the deal value and their monthly
        plan, and adds it to your pipeline as a won deal so the numbers stay accurate.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {PRICING_PACKAGES.map((pkg) => {
          const active = picked === pkg.id;
          return (
            <button
              key={pkg.id}
              type="button"
              onClick={() => setPicked(pkg.id)}
              className={
                "relative rounded-xl border p-4 text-left transition-all " +
                (active
                  ? "border-signal bg-signal-soft/40 ring-1 ring-signal/40"
                  : "border-line bg-surface hover:border-line-strong")
              }
            >
              {pkg.recommended ? (
                <span className="absolute right-2 top-2 rounded-sm bg-signal-soft px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-signal">
                  Popular
                </span>
              ) : null}
              <div className="text-sm font-semibold text-bone">{pkg.name}</div>
              <div className="mt-1 text-xl font-bold text-bone">
                {pkg.startsAt ? "from " : ""}
                {formatMoney(pkg.build)}
              </div>
              <div className="text-xs text-mute">
                + {formatMoney(pkg.monthly)}/mo
              </div>
              <div className="mt-2 text-[11px] leading-relaxed text-faint">{pkg.pages}</div>
              <div className="mt-1 text-[11px] leading-relaxed text-faint">{pkg.blurb}</div>
              <div className="mt-2 border-t border-line/60 pt-2 text-[11px] text-mute">
                ≈ {formatMoney(pkg.firstYear)} first-year value
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-5 flex items-center justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button onClick={confirm} disabled={busy}>
          {busy ? "Saving…" : "Mark signed"}
        </Button>
      </div>
    </Modal>
  );
}

// The company journey as a drag-and-drop board. A company starts in "To Call",
// and after the call the rep drops it into Yes / Maybe / No. Dropping into
// "Signed" opens the package picker and turns it into a won deal.
type BoardCol = {
  key: string;
  label: string;
  outcome: "interested" | "not_interested" | "maybe" | "signed" | null;
  hint: string;
  dot: string;
};
const BOARD_COLUMNS: BoardCol[] = [
  { key: "to_call", label: "To Call", outcome: null, hint: "Fresh — no call yet", dot: "#94a3b8" },
  { key: "interested", label: "Yes", outcome: "interested", hint: "Interested", dot: "#22c55e" },
  { key: "maybe", label: "Maybe", outcome: "maybe", hint: "On the fence", dot: "#f59e0b" },
  { key: "not_interested", label: "No", outcome: "not_interested", hint: "Not interested", dot: "#ef4444" },
  { key: "signed", label: "Signed", outcome: "signed", hint: "Won 🎉", dot: "#2dd4bf" },
];

function colOf(c: Row): string | null {
  const outcome = c.call_outcome as string | null;
  if (outcome === "interested") return "interested";
  if (outcome === "maybe") return "maybe";
  if (outcome === "not_interested") return "not_interested";
  if (outcome === "signed") return "signed";
  // No outcome yet → it still needs a first call.
  if (!outcome) return "to_call";
  return null;
}

function CompanyBoard({ companies, onChanged }: { companies: Row[]; onChanged: () => void }) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const [signing, setSigning] = useState<Row | null>(null);
  const byId = useMemo(() => new Map(companies.map((c) => [c.id as string, c])), [companies]);

  const grouped = useMemo(() => {
    const g: Record<string, Row[]> = {
      to_call: [],
      interested: [],
      maybe: [],
      not_interested: [],
      signed: [],
    };
    for (const c of companies) {
      const k = colOf(c);
      if (k) g[k].push(c);
    }
    for (const k of Object.keys(g)) {
      g[k].sort((a, b) => (a.name as string).localeCompare(b.name as string));
    }
    return g;
  }, [companies]);

  async function move(company: Row, col: BoardCol) {
    if (colOf(company) === col.key) return;
    if (col.outcome === "signed") {
      setSigning(company); // open package picker instead of setting directly
      return;
    }
    try {
      await setCompanyCallOutcome({ data: { id: company.id as string, outcome: col.outcome } });
      toast(`${company.name as string} → ${col.label}`);
      onChanged();
    } catch {
      toast("Couldn't move that one — you may not own it", "error");
    }
  }

  function onDrop(col: BoardCol) {
    setOverCol(null);
    const id = dragId;
    setDragId(null);
    if (!id) return;
    const company = byId.get(id);
    if (company) void move(company, col);
  }

  const total = companies.filter((c) => colOf(c) !== null).length;
  if (total === 0) {
    return (
      <Card className="mt-5 p-4">
        <EmptyState
          title="No companies yet"
          hint="Add companies and they'll show up here to call and move along."
        />
      </Card>
    );
  }

  return (
    <>
      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-5">
        {BOARD_COLUMNS.map((col) => {
          const items = grouped[col.key];
          const isOver = overCol === col.key;
          return (
            <div
              key={col.key}
              onDragOver={(e) => {
                e.preventDefault();
                if (overCol !== col.key) setOverCol(col.key);
              }}
              onDragLeave={() => setOverCol((o) => (o === col.key ? null : o))}
              onDrop={() => onDrop(col)}
              className={
                "flex min-h-[8rem] flex-col rounded-xl border bg-surface/60 p-2 transition-colors " +
                (isOver ? "border-signal/60 bg-signal-soft/20" : "border-line")
              }
            >
              <div className="mb-2 flex items-center gap-1.5 px-1">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: col.dot }} />
                <span className="text-xs font-semibold text-bone">{col.label}</span>
                <span className="ml-auto font-mono text-[10px] text-faint">{items.length}</span>
              </div>
              <div className="flex flex-1 flex-col gap-1.5">
                {items.map((c) => {
                  const sub = [c.industry as string, c.city as string].filter(Boolean).join(" · ");
                  return (
                    <div
                      key={c.id as string}
                      draggable
                      onDragStart={() => setDragId(c.id as string)}
                      onDragEnd={() => {
                        setDragId(null);
                        setOverCol(null);
                      }}
                      className={
                        "cursor-grab rounded-lg border border-line bg-surface p-2 shadow-sm transition-all active:cursor-grabbing hover:border-line-strong " +
                        (dragId === c.id ? "opacity-40" : "")
                      }
                    >
                      <div className="truncate text-xs font-medium text-bone">{c.name as string}</div>
                      {sub ? <div className="truncate text-[11px] text-faint">{sub}</div> : null}
                      {c.phone ? (
                        <div className="mt-0.5 truncate text-[11px] text-mute">{c.phone as string}</div>
                      ) : null}
                    </div>
                  );
                })}
                {items.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-line/60 px-2 py-4 text-center text-[11px] text-faint">
                    {col.hint}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-2 px-1 text-[11px] text-faint">
        Tip: drag a company between columns after you call them. Drop one on <strong className="text-mute">Signed</strong> to pick their package.
      </p>

      <SignModal
        company={signing}
        open={!!signing}
        onClose={() => setSigning(null)}
        onSigned={onChanged}
      />
    </>
  );
}

function CallsPage() {
  const { companies, contacts, users, deals, me } = Route.useLoaderData();
  const router = useRouter();
  const isAdmin = me?.role === "admin";

  // Reps should only be nudged to call companies they own — dialing someone
  // else's lead steps on toes. Admins keep the full view for oversight.
  const callable = useMemo(
    () =>
      isAdmin
        ? (companies as Row[])
        : (companies as Row[]).filter((c) => (c.owner_id as string | null) === me?.id),
    [companies, isAdmin, me],
  );

  const [view, setView] = useState<"board" | "list">("board");
  const [mode, setMode] = useState<Mode>("people");
  const [query, setQuery] = useState("");
  // Default the list to the rep's own records (they can switch to "All owners");
  // admins start unfiltered.
  const [ownerFilter, setOwnerFilter] = useState(isAdmin ? "" : me?.id ?? "");
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
        subtitle="Call new companies, then move them along: Yes, Maybe, No — or Signed."
        actions={
          <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
            {(["board", "list"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={
                  "rounded-md px-3 py-1.5 text-xs font-semibold capitalize transition-all " +
                  (view === v ? "bg-signal-soft text-signal" : "text-mute hover:text-bone")
                }
              >
                {v === "board" ? "Board" : "Call list"}
              </button>
            ))}
          </div>
        }
      />

      <CallQueue
        companies={callable}
        onCall={(c) => setCalling(c)}
        onChanged={() => router.invalidate()}
      />

      {view === "board" ? (
        <CompanyBoard companies={callable} onChanged={() => router.invalidate()} />
      ) : null}

      {view === "list" ? (
        <ListView
          mode={mode}
          setMode={setMode}
          query={query}
          setQuery={setQuery}
          ownerFilter={ownerFilter}
          setOwnerFilter={setOwnerFilter}
          users={users as Row[]}
          rows={rows}
          withPhone={withPhone}
          openByCompany={openByCompany}
          onCall={(r) => setCalling(r)}
        />
      ) : null}

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

function ListView({
  mode,
  setMode,
  query,
  setQuery,
  ownerFilter,
  setOwnerFilter,
  users,
  rows,
  withPhone,
  openByCompany,
  onCall,
}: {
  mode: Mode;
  setMode: (m: Mode) => void;
  query: string;
  setQuery: (s: string) => void;
  ownerFilter: string;
  setOwnerFilter: (s: string) => void;
  users: Row[];
  rows: Row[];
  withPhone: number;
  openByCompany: Map<string, number>;
  onCall: (r: Row) => void;
}) {
  return (
    <>
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
                  onClick={() => onCall(r)}
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
    </>
  );
}
