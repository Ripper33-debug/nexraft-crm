import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import {
  getCompanies,
  getContacts,
  getDeals,
  getUsers,
  setCompanyCallOutcome,
  sendCrmEmail,
  getGmailStatus,
} from "../../lib/crm/data";
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
  hasTeamScope,
} from "../../lib/crm/constants";
import { missedCallEmail, mailtoLink } from "../../lib/crm/emails";

type Row = Record<string, unknown>;
type Mode = "people" | "companies";

function fullName(c: Row): string {
  return `${(c.first_name as string) ?? ""} ${(c.last_name as string) ?? ""}`.trim();
}

export const Route = createFileRoute("/_app/calls")({
  loader: async ({ context }) => {
    const [companies, contacts, users, deals, gmail] = await Promise.all([
      getCompanies(),
      getContacts(),
      getUsers(),
      getDeals(),
      getGmailStatus().catch(() => ({ configured: false, connected: false, email: null })),
    ]);
    const me = (context as { user?: { id: string; role: string; name: string; email: string } }).user ?? null;
    return { companies, contacts, users, deals, me, gmail };
  },
  component: CallsPage,
});

// Swipe-style triage for fresh companies (no deal yet, not yet triaged). Go
// through them one at a time: Interested / Not interested, or open Call mode.
function CallQueue({
  companies,
  onCall,
  onNoAnswer,
  onChanged,
}: {
  companies: Row[];
  onCall: (c: Row) => void;
  onNoAnswer: (c: Row) => void;
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

      <div className="mt-3 rounded-xl border border-line bg-surface p-3 sm:p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
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
            onClick={() => onNoAnswer(current)}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 text-xs font-semibold text-sky-300 transition-colors hover:bg-sky-500/20 disabled:opacity-50"
          >
            ✉ No answer — email them
          </button>
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
  outcome: "interested" | "not_interested" | "maybe" | "no_answer" | "signed" | null;
  hint: string;
  dot: string;
};
const BOARD_COLUMNS: BoardCol[] = [
  { key: "to_call", label: "To Call", outcome: null, hint: "Fresh — no call yet", dot: "#94a3b8" },
  { key: "interested", label: "Yes", outcome: "interested", hint: "Interested", dot: "#22c55e" },
  { key: "maybe", label: "Maybe", outcome: "maybe", hint: "On the fence", dot: "#f59e0b" },
  { key: "no_answer", label: "No answer", outcome: "no_answer", hint: "Missed — emailed", dot: "#38bdf8" },
  { key: "not_interested", label: "No", outcome: "not_interested", hint: "Not interested", dot: "#ef4444" },
  { key: "signed", label: "Signed", outcome: "signed", hint: "Won 🎉", dot: "#2dd4bf" },
];

function colOf(c: Row): string | null {
  const outcome = c.call_outcome as string | null;
  if (outcome === "interested") return "interested";
  if (outcome === "maybe") return "maybe";
  if (outcome === "not_interested") return "not_interested";
  if (outcome === "no_answer") return "no_answer";
  if (outcome === "signed") return "signed";
  // No outcome yet → it still needs a first call.
  if (!outcome) return "to_call";
  return null;
}

function CompanyBoard({
  companies,
  onNoAnswer,
  onChanged,
}: {
  companies: Row[];
  onNoAnswer: (c: Row) => void;
  onChanged: () => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const [signing, setSigning] = useState<Row | null>(null);
  const byId = useMemo(() => new Map(companies.map((c) => [c.id as string, c])), [companies]);

  const grouped = useMemo(() => {
    const g: Record<string, Row[]> = {
      to_call: [],
      interested: [],
      maybe: [],
      no_answer: [],
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
    if (col.outcome === "no_answer") {
      onNoAnswer(company); // open the email-draft prompt instead of setting directly
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
      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
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
                      {/* Tap-to-move: no dragging needed (esp. on mobile). Routes
                          through the same move() as drag-and-drop. */}
                      <select
                        value={colOf(c) ?? "to_call"}
                        draggable={false}
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          const next = BOARD_COLUMNS.find((bc) => bc.key === e.target.value);
                          if (next) void move(c, next);
                        }}
                        className="mt-1.5 w-full rounded-md border border-line bg-surface-2 px-1.5 py-1 text-[11px] text-mute outline-none transition-colors focus:border-signal/50"
                      >
                        {BOARD_COLUMNS.map((bc) => (
                          <option key={bc.key} value={bc.key}>
                            {colOf(c) === bc.key ? `● ${bc.label}` : `Move to ${bc.label}`}
                          </option>
                        ))}
                      </select>
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
        Tip: drag a company between columns after you call them — or use the little dropdown on each card to move it without dragging. Pick <strong className="text-mute">No answer</strong> to email them, or <strong className="text-mute">Signed</strong> to choose their package.
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

// When a call goes unanswered, we don't lose the lead — we nudge them by email.
// This drafts a warm "sorry we missed you" note, pre-fills the rep's own email
// app (no account to connect), and drops the company into the "No answer" bucket.
function NoAnswerModal({
  company,
  email,
  repName,
  gmailConnected,
  onClose,
  onDone,
}: {
  company: Row;
  email: string;
  repName: string;
  gmailConnected: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const draft = missedCallEmail(company.name as string, repName);
  const [to, setTo] = useState(email);
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [busy, setBusy] = useState(false);

  // Mark the company "no answer" so it leaves the call queue and lands in the
  // No-answer bucket. Shared by both buttons.
  async function mark(): Promise<boolean> {
    setBusy(true);
    try {
      await setCompanyCallOutcome({ data: { id: company.id as string, outcome: "no_answer" } });
      return true;
    } catch {
      toast("Couldn't save — you may not own this one", "error");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function emailThem() {
    const ok = await mark();
    if (!ok) return;
    if (gmailConnected) {
      // Send for real from the rep's own Gmail; the server records the touch.
      setBusy(true);
      try {
        const res = await sendCrmEmail({
          data: { to: to.trim(), subject, body, company_id: company.id as string },
        });
        if (res.ok) {
          toast(`${company.name as string} → No answer · email sent`);
          onDone();
        } else {
          toast(res.error || "Moved to No answer, but the email didn't send.", "error");
        }
      } catch {
        toast("Moved to No answer, but the email didn't send.", "error");
      } finally {
        setBusy(false);
      }
      return;
    }
    // Not connected: open the rep's default mail app with everything pre-filled.
    if (typeof window !== "undefined") {
      window.location.href = mailtoLink(to.trim(), subject, body);
    }
    toast(`${company.name as string} → No answer · email drafted`);
    onDone();
  }

  async function justLog() {
    const ok = await mark();
    if (!ok) return;
    toast(`${company.name as string} → No answer`);
    onDone();
  }

  return (
    <Modal open onClose={onClose} title={`No answer — email ${company.name as string}?`} wide>
      <p className="text-sm text-mute">
        We'll move them to the <strong className="text-bone">No answer</strong> column so you don't lose
        them.{" "}
        {gmailConnected
          ? "The email sends straight from your own Gmail — just glance it over first."
          : "A ready-to-send email opens in your own mail app. Glance it over and hit send."}
      </p>

      <div className="mt-4 space-y-3">
        <div>
          <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-faint">To</label>
          <Input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="name@company.com"
            className="text-sm"
          />
          {!email ? (
            <p className="mt-1 text-[11px] text-amber-300/90">
              No contact email on file for this company — type one in, or just log the missed call.
            </p>
          ) : null}
        </div>

        <div>
          <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-faint">Subject</label>
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} className="text-sm" />
        </div>

        <div>
          <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-faint">Message</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={10}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-bone outline-none transition-colors focus:border-signal/50"
          />
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="outline" onClick={justLog} disabled={busy}>
          Just log it
        </Button>
        <Button onClick={emailThem} disabled={busy || !to.trim()}>
          {busy ? "Saving…" : gmailConnected ? "✉ Send email" : "✉ Open email draft"}
        </Button>
      </div>
    </Modal>
  );
}

function CallsPage() {
  const { companies, contacts, users, deals, me, gmail } = Route.useLoaderData();
  const gmailConnected = !!(gmail as { connected?: boolean }).connected;
  const router = useRouter();
  // Managers get the same full-team call view as admins (this flag only ever
  // gates visibility on this page, not admin tools).
  const isAdmin = hasTeamScope(me?.role);

  // Reps should only be nudged to call companies they own — dialing someone
  // else's lead steps on toes. Admins and managers keep the full view.
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
  // Admins can slice the list by owner; reps don't get a choice — their list is
  // hard-limited to their own book below, so the filter only renders for admins.
  const [ownerFilter, setOwnerFilter] = useState("");
  const [calling, setCalling] = useState<Row | null>(null);
  const [noAnswer, setNoAnswer] = useState<Row | null>(null);

  // Best email to reach each company at: the first contact on file who has one.
  // Powers the "no answer → email them" draft.
  const emailByCompany = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of contacts as Row[]) {
      const cid = c.company_id as string | null;
      const email = (c.email as string | null)?.trim();
      if (cid && email && !m.has(cid)) m.set(cid, email);
    }
    return m;
  }, [contacts]);

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
    // Reps only ever see their OWN people and companies here — calling someone
    // else's account steps on toes (and the server rejects the outcome anyway).
    // Admins see everything and can narrow with the owner filter.
    const source = mode === "people" ? (contacts as Row[]) : (companies as Row[]);
    // A contact counts as "mine" if I own it OR it belongs to one of my companies
    // (imported contacts often have no owner of their own).
    const myCompanyIds = new Set(
      (companies as Row[]).filter((c) => (c.owner_id as string | null) === me?.id).map((c) => c.id as string),
    );
    const visible = isAdmin
      ? source
      : source.filter((r) =>
          (r.owner_id as string | null) === me?.id ||
          (mode === "people" && !!r.company_id && myCompanyIds.has(r.company_id as string)),
        );
    const base = visible.filter((r) => {
      if (isAdmin && ownerFilter) {
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
  }, [mode, contacts, companies, query, ownerFilter, openByCompany, isAdmin, me]);

  const withPhone = rows.filter((r) => r.phone).length;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <PageHeader
        title="Calls"
        subtitle={isAdmin ? "Everyone's call flow — call, then move them along: Yes, Maybe, No — or Signed." : "Your companies only — call, then move them along: Yes, Maybe, No — or Signed."}
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
        onNoAnswer={(c) => setNoAnswer(c)}
        onChanged={() => router.invalidate()}
      />

      {view === "board" ? (
        <CompanyBoard
          companies={callable}
          onNoAnswer={(c) => setNoAnswer(c)}
          onChanged={() => router.invalidate()}
        />
      ) : null}

      {view === "list" ? (
        <ListView
          isAdmin={isAdmin}
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
          onNotAFit={async (r) => {
            try {
              await setCompanyCallOutcome({ data: { id: r.id as string, outcome: "not_interested" } });
              toast(`${r.name as string} → No`);
              router.invalidate();
            } catch {
              toast("Couldn't save — you may not own this one", "error");
            }
          }}
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

      {noAnswer ? (
        <NoAnswerModal
          key={noAnswer.id as string}
          company={noAnswer}
          email={emailByCompany.get(noAnswer.id as string) ?? ""}
          repName={me?.name ?? ""}
          gmailConnected={gmailConnected}
          onClose={() => setNoAnswer(null)}
          onDone={() => {
            setNoAnswer(null);
            router.invalidate();
          }}
        />
      ) : null}
    </div>
  );
}

function ListView({
  isAdmin,
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
  onNotAFit,
}: {
  isAdmin: boolean;
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
  onNotAFit: (r: Row) => void;
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

        {isAdmin ? (
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
        ) : (
          <span className="font-mono text-[10px] uppercase tracking-wider text-faint">Your book only</span>
        )}
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

                {/* Quick "Not a fit" on companies — marks a No (drops any open
                    deal to Lost) without opening the full call panel. */}
                {mode === "companies" && r.call_outcome !== "not_interested" && r.call_outcome !== "signed" ? (
                  <button
                    onClick={() => onNotAFit(r)}
                    title="Mark as No — not a fit"
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-rose-500/40 bg-rose-500/10 px-2.5 py-1.5 text-xs font-semibold text-rose-300 transition-colors hover:bg-rose-500/20"
                  >
                    ✕<span className="hidden sm:inline"> Not a fit</span>
                  </button>
                ) : null}

                <button
                  onClick={() => onCall(r)}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-signal hover:bg-signal-strong px-3 py-1.5 text-xs font-semibold text-ink transition-all active:translate-y-px"
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
