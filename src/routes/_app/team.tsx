import { createFileRoute, Link, redirect, useRouter } from "@tanstack/react-router";
import { useRef, useState } from "react";

import {
  getTeamOverview,
  getUserDetail,
  getSignupCode,
  getRepActivity,
  adminCreateUser,
  adminUpdateRole,
  adminResetPassword,
  adminDeleteUser,
  adminReassignBook,
  runResearchBatch,
  runReResearchBatch,
  runRedraftEmailsBatch,
  runFullReResearchBatch,
  huntLeadsBatch,
  type TeamMemberRow,
  type RepActivityRow,
} from "../../lib/crm/data";
import { toast } from "../../components/crm/toast";
import {
  Button,
  Card,
  Field,
  Input,
  Select,
  Modal,
  PageHeader,
  SummaryCard,
  Eyebrow,
  OwnerChip,
  Avatar,
  Pill,
  StageBadge,
} from "../../components/crm/ui";
import { formatMoney, formatRange, pipelineValueRange, pipelineMrrRange, relativeTime } from "../../lib/crm/constants";

export const Route = createFileRoute("/_app/team")({
  beforeLoad: ({ context }) => {
    const user = (context as { user?: { role?: string } }).user;
    if (!user || user.role !== "admin") {
      throw redirect({ to: "/" });
    }
  },
  loader: async () => {
    const [team, code, activity] = await Promise.all([
      getTeamOverview(),
      getSignupCode(),
      getRepActivity({ data: { range: "week" } }).catch(() => ({ range: "week" as const, rows: [] })),
    ]);
    return { team, code: code.code, activity };
  },
  component: TeamPage,
});

type Detail = Awaited<ReturnType<typeof getUserDetail>>;

// "Who actually did the work" — effort metrics per rep from the event log, over
// a selectable window. State (pipeline size) lives in the table above; this
// panel measures MOTION: calls triaged, emails sent, records created, stage
// moves, notes. The Total column ranks the hustle.
// Admin lever for the research engine: one click walks the ENTIRE backlog —
// it keeps requesting batches until every company has a dossier (or you click
// again to stop). Progress lives in the button label; the tab must stay open
// while it works. Each batch is its own serverless call, so stopping midway
// loses nothing — everything already researched is saved.
function ResearchBatchButton() {
  const [running, setRunning] = useState(false);
  const [left, setLeft] = useState<number | null>(null);
  // Ref, not state: the running loop's closure must see the stop click even
  // though re-renders have replaced the component's locals since it started.
  const stopRef = useRef(false);
  const run = async () => {
    if (running) {
      stopRef.current = true;
      setRunning(false);
      toast("⏸ Research stopped — everything done so far is saved.");
      return;
    }
    setRunning(true);
    stopRef.current = false;
    let total = 0;
    try {
      // Loop until the queue is empty. Hard ceiling of 200 batches (1,200
      // companies) so a bug can never leave this spinning forever.
      for (let i = 0; i < 200; i++) {
        const res = await runResearchBatch();
        total += res.enriched;
        setLeft(res.remaining);
        if (stopRef.current) return;
        if (res.remaining === 0 || res.enriched === 0) break;
      }
      toast(
        total === 0
          ? "🔎 All caught up — every company already has a dossier."
          : `🔎 Done — researched ${total} compan${total === 1 ? "y" : "ies"}. Selling points are on each company page.`,
      );
    } catch {
      toast(
        total > 0
          ? `Research hit a snag after ${total} companies — click again to continue.`
          : "Research failed to start — try again in a moment.",
      );
    } finally {
      setRunning(false);
      setLeft(null);
    }
  };
  return (
    <Button variant="outline" onClick={run}>
      {running ? (left !== null ? `Digging… ${left} left (click to stop)` : "Digging… (click to stop)") : "🔎 Research all"}
    </Button>
  );
}

// Same loop, different pool: refreshes dossiers written before the AI layer
// existed so every company gets a call brief + drafted email. The server
// refuses to run without an AI key — ANTHROPIC_API_KEY or OPENROUTER_API_KEY
// (no point re-crawling for nothing),
// and this surfaces that as a plain-language toast instead of a silent no-op.
function ReResearchButton() {
  const [running, setRunning] = useState(false);
  const [left, setLeft] = useState<number | null>(null);
  const stopRef = useRef(false);
  const run = async () => {
    if (running) {
      stopRef.current = true;
      setRunning(false);
      toast("⏸ Refresh stopped — every brief written so far is saved.");
      return;
    }
    setRunning(true);
    stopRef.current = false;
    let total = 0;
    try {
      for (let i = 0; i < 200; i++) {
        const res = await runReResearchBatch();
        if (!res.configured) {
          toast("AI isn't set up yet — add OPENROUTER_API_KEY (or ANTHROPIC_API_KEY) in Vercel first, then run this.", "error");
          return;
        }
        total += res.refreshed;
        setLeft(res.remaining);
        if (stopRef.current) return;
        if (res.remaining === 0 || res.refreshed === 0) break;
      }
      toast(
        total === 0
          ? "✨ All caught up — every dossier already has an AI brief."
          : `✨ Done — refreshed ${total} compan${total === 1 ? "y" : "ies"} with AI briefs and email drafts.`,
      );
    } catch {
      toast(
        total > 0
          ? `Refresh hit a snag after ${total} companies — click again to continue.`
          : "Refresh failed to start — try again in a moment.",
      );
    } finally {
      setRunning(false);
      setLeft(null);
    }
  };
  return (
    <Button variant="outline" onClick={run}>
      {running ? (left !== null ? `Refreshing… ${left} left (click to stop)` : "Refreshing… (click to stop)") : "✨ Add AI briefs"}
    </Button>
  );
}

// Same loop again for prompt upgrades: rewrites every email draft written
// under an older prompt version (server tracks this per-draft) straight from
// the saved dossier — no re-crawl, so it's fast and cheap. This is the
// "make the emails better right now" button.
function RedraftEmailsButton() {
  const [running, setRunning] = useState(false);
  const [left, setLeft] = useState<number | null>(null);
  const stopRef = useRef(false);
  const run = async () => {
    if (running) {
      stopRef.current = true;
      setRunning(false);
      toast("⏸ Redraft stopped — every email rewritten so far is saved.");
      return;
    }
    setRunning(true);
    stopRef.current = false;
    let total = 0;
    try {
      for (let i = 0; i < 200; i++) {
        const res = await runRedraftEmailsBatch();
        if (!res.configured) {
          toast("AI isn't set up yet — add OPENROUTER_API_KEY (or ANTHROPIC_API_KEY) in Vercel first, then run this.", "error");
          return;
        }
        total += res.redrafted;
        setLeft(res.remaining);
        if (stopRef.current) return;
        // redrafted === 0 means this batch made no progress (AI hiccup or
        // kept-good-drafts) — stop instead of hammering the same companies.
        if (res.remaining === 0 || res.redrafted === 0) break;
      }
      toast(
        total === 0
          ? "✍️ All caught up — every email draft is already on the latest style."
          : `✍️ Done — rewrote ${total} email draft${total === 1 ? "" : "s"} in the new tailored style. Check any company in Outreach.`,
      );
    } catch {
      toast(
        total > 0
          ? `Redraft hit a snag after ${total} emails — click again to continue.`
          : "Redraft failed to start — try again in a moment.",
      );
    } finally {
      setRunning(false);
      setLeft(null);
    }
  };
  return (
    <Button variant="outline" onClick={run}>
      {running ? (left !== null ? `Rewriting… ${left} left (click to stop)` : "Rewriting… (click to stop)") : "✍️ Re-draft emails"}
    </Button>
  );
}

// Bulk lead hunt: sweeps a fixed rotation of Florida cities × service niches
// and imports ONLY businesses that list BOTH a phone and an email — every lead
// it adds is fully contactable on day one. Loops until it's added the target
// count or the whole rotation has been swept; stoppable mid-run like the rest,
// and everything found so far stays saved.
const HUNT_TARGET = 1000;
function HuntLeadsButton() {
  const [running, setRunning] = useState(false);
  const [found, setFound] = useState(0);
  const stopRef = useRef(false);
  const run = async () => {
    if (running) {
      stopRef.current = true;
      setRunning(false);
      toast("⏸ Hunt stopped — every lead found so far is saved in the pool.");
      return;
    }
    setRunning(true);
    stopRef.current = false;
    setFound(0);
    let total = 0;
    try {
      for (let step = 0; ; step++) {
        const res = await huntLeadsBatch({ data: { step } });
        total += res.imported;
        setFound(total);
        if (stopRef.current) return;
        if (total >= HUNT_TARGET || res.done) break;
      }
      toast(
        total === 0
          ? "🎯 Hunt finished but found nothing new with both a phone AND an email — the map data has been picked clean for now."
          : `🎯 Hunt done — added ${total} lead${total === 1 ? "" : "s"}, every one with a phone AND an email. They're in the pool, and tonight's sweep starts researching them.`,
      );
    } catch {
      toast(
        total > 0
          ? `Hunt hit a snag after ${total} leads — click again to keep going.`
          : "Hunt failed to start — try again in a moment.",
      );
    } finally {
      setRunning(false);
    }
  };
  return (
    <Button variant="outline" onClick={run}>
      {running ? `Hunting… ${found} added (click to stop)` : "🎯 Hunt 1,000 leads"}
    </Button>
  );
}

// Full refresh: re-digs EVERY company, oldest dossier first. The cutoff is
// captured the moment the run starts and sent with every batch, so the server
// only touches dossiers older than the click — that's what makes the loop
// finish instead of chasing its own tail. Stoppable like the others, and
// stopping midway keeps everything refreshed so far.
function FullReResearchButton() {
  const [running, setRunning] = useState(false);
  const [left, setLeft] = useState<number | null>(null);
  const stopRef = useRef(false);
  const run = async () => {
    if (running) {
      stopRef.current = true;
      setRunning(false);
      toast("⏸ Re-research stopped — everything refreshed so far is saved.");
      return;
    }
    if (
      !window.confirm(
        "Re-research EVERY company? This re-reads each website and rewrites every dossier (nothing a rep typed is touched). It can take a while on a big list — you can stop it anytime.",
      )
    )
      return;
    setRunning(true);
    stopRef.current = false;
    const before = new Date().toISOString();
    let total = 0;
    try {
      for (let i = 0; i < 200; i++) {
        const res = await runFullReResearchBatch({ data: { before } });
        total += res.refreshed;
        setLeft(res.remaining);
        if (stopRef.current) return;
        if (res.remaining === 0 || res.refreshed === 0) break;
      }
      toast(
        total === 0
          ? "🔁 Nothing to refresh — every dossier is already newer than this run."
          : `🔁 Done — re-researched ${total} compan${total === 1 ? "y" : "ies"} with fresh intel.`,
      );
    } catch {
      toast(
        total > 0
          ? `Re-research hit a snag after ${total} companies — click again to continue.`
          : "Re-research failed to start — try again in a moment.",
      );
    } finally {
      setRunning(false);
      setLeft(null);
    }
  };
  return (
    <Button variant="outline" onClick={run}>
      {running ? (left !== null ? `Re-digging… ${left} left (click to stop)` : "Re-digging… (click to stop)") : "🔁 Re-research all"}
    </Button>
  );
}

function RepActivityPanel({
  initial,
}: {
  initial: { range: "week" | "month" | "quarter"; rows: RepActivityRow[] };
}) {
  const [range, setRange] = useState<"week" | "month" | "quarter">(initial.range);
  const [rows, setRows] = useState<RepActivityRow[]>(initial.rows);
  const [loading, setLoading] = useState(false);

  async function load(r: "week" | "month" | "quarter") {
    setRange(r);
    setLoading(true);
    try {
      const res = await getRepActivity({ data: { range: r } });
      setRows(res.rows);
    } catch {
      /* keep whatever we have */
    } finally {
      setLoading(false);
    }
  }

  const RANGES: Array<{ key: "week" | "month" | "quarter"; label: string }> = [
    { key: "week", label: "7 days" },
    { key: "month", label: "30 days" },
    { key: "quarter", label: "90 days" },
  ];

  return (
    <Card className="mt-4 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div>
          <Eyebrow>Rep activity</Eyebrow>
          <div className="mt-0.5 text-xs text-faint">
            Actions logged by each rep — calls, emails, new records, deal moves, notes.
          </div>
        </div>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => load(r.key)}
              disabled={loading}
              className={
                "rounded-full px-2.5 py-1 text-xs font-medium transition-colors " +
                (range === r.key
                  ? "bg-signal-soft text-signal"
                  : "text-mute hover:bg-surface-2 hover:text-bone")
              }
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <div className={"overflow-x-auto" + (loading ? " opacity-50" : "")}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left font-mono text-[10px] uppercase tracking-wider text-faint">
              <th className="px-4 py-2.5 font-medium">Rep</th>
              <th className="px-4 py-2.5 font-medium">Calls</th>
              <th className="px-4 py-2.5 font-medium">Emails</th>
              <th className="px-4 py-2.5 font-medium">New records</th>
              <th className="px-4 py-2.5 font-medium">Deal moves</th>
              <th className="px-4 py-2.5 font-medium">Won / Lost</th>
              <th className="px-4 py-2.5 font-medium">Notes</th>
              <th className="px-4 py-2.5 font-medium">Total</th>
              <th className="px-4 py-2.5 font-medium">Last active</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line/60 last:border-0 hover:bg-surface-2/60">
                <td className="px-4 py-2.5">
                  <span className="inline-flex items-center gap-2">
                    <Avatar name={r.name} size={22} />
                    <span className="font-medium text-bone">{r.name}</span>
                  </span>
                </td>
                <td className="px-4 py-2.5 text-mute">{r.calls}</td>
                <td className="px-4 py-2.5 text-mute">{r.emails}</td>
                <td className="px-4 py-2.5 text-mute">{r.created + r.claims}</td>
                <td className="px-4 py-2.5 text-mute">{r.stage_moves}</td>
                <td className="px-4 py-2.5">
                  <span className="text-emerald-600">{r.won}</span>
                  <span className="text-faint"> / </span>
                  <span className="text-red-600">{r.lost}</span>
                </td>
                <td className="px-4 py-2.5 text-mute">{r.notes}</td>
                <td className="px-4 py-2.5">
                  {Number(r.total) === 0 ? (
                    <Pill tone="warn">Idle</Pill>
                  ) : (
                    <span className="font-medium text-bone">{r.total}</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-xs text-faint">
                  {r.last_active ? relativeTime(r.last_active) : "—"}
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-6 text-center text-sm text-faint">
                  No activity logged in this window yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function TeamPage() {
  const { team, code, activity } = Route.useLoaderData();
  const router = useRouter();
  const rows = team as TeamMemberRow[];

  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [resetFor, setResetFor] = useState<TeamMemberRow | null>(null);
  const [reassignFor, setReassignFor] = useState<TeamMemberRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => router.invalidate();

  const totals = rows.reduce(
    (acc, r) => ({
      open_value: acc.open_value + Number(r.open_value),
      won_value: acc.won_value + Number(r.won_value),
      open_count: acc.open_count + Number(r.open_count),
      open_unpriced: acc.open_unpriced + Number(r.open_unpriced ?? 0),
      open_monthly: acc.open_monthly + Number(r.open_monthly ?? 0),
      open_monthly_unpriced: acc.open_monthly_unpriced + Number(r.open_monthly_unpriced ?? 0),
    }),
    { open_value: 0, won_value: 0, open_count: 0, open_unpriced: 0, open_monthly: 0, open_monthly_unpriced: 0 },
  );
  const totalRange = pipelineValueRange(totals.open_value, totals.open_unpriced);
  const totalMrrRange = pipelineMrrRange(totals.open_monthly, totals.open_monthly_unpriced);

  async function openDetail(id: string) {
    setDetailLoading(true);
    try {
      const d = await getUserDetail({ data: { id } });
      setDetail(d);
    } finally {
      setDetailLoading(false);
    }
  }

  async function changeRole(r: TeamMemberRow, next: "admin" | "manager" | "member") {
    setBusy(true);
    setError(null);
    const res = await adminUpdateRole({ data: { id: r.id, role: next } });
    if (!res.ok) setError(res.error);
    await refresh();
    setBusy(false);
  }

  async function removeUser(r: TeamMemberRow) {
    if (!confirm(`Remove ${r.name}? Their records stay but become unassigned.`)) return;
    setBusy(true);
    setError(null);
    const res = await adminDeleteUser({ data: { id: r.id } });
    if (!res.ok) setError(res.error);
    await refresh();
    setBusy(false);
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <PageHeader
        title="Team"
        subtitle="Admin view — everything your team has in the CRM."
        actions={
          <div className="flex flex-wrap gap-2">
            <HuntLeadsButton />
            <ResearchBatchButton />
            <ReResearchButton />
            <RedraftEmailsButton />
            <FullReResearchButton />
            <Button onClick={() => setAddOpen(true)}>+ Add teammate</Button>
          </div>
        }
      />

      {error ? (
        <div className="mt-4 rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-600">{error}</div>
      ) : null}

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <SummaryCard label="Team members" value={String(rows.length)} />
        <SummaryCard label="Open pipeline" value={formatRange(totalRange.low, totalRange.high)} sub={totals.open_unpriced > 0 ? `${totals.open_count} deals · ${totals.open_unpriced} est.` : `${totals.open_count} deals`} accent />
        <SummaryCard label="Potential MRR" value={`${formatRange(totalMrrRange.low, totalMrrRange.high)}/mo`} sub={`rep cut ${formatRange(Math.round(totalMrrRange.low * 0.3), Math.round(totalMrrRange.high * 0.3))}/mo`} />
        <SummaryCard label="Won (all time)" value={formatMoney(totals.won_value)} />
        <div className="rounded-xl border border-line bg-surface p-4">
          <Eyebrow>Team access code</Eyebrow>
          <div className="mt-2 font-mono text-lg font-semibold text-signal">{code}</div>
          <div className="mt-0.5 text-xs text-faint">Share so teammates can sign up</div>
        </div>
      </div>

      <Card className="mt-4 overflow-hidden">
        <div className="border-b border-line px-4 py-3">
          <Eyebrow>Per-member breakdown</Eyebrow>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                <th className="px-4 py-2.5 font-medium">Member</th>
                <th className="px-4 py-2.5 font-medium">Open pipeline</th>
                <th className="px-4 py-2.5 font-medium">Potential MRR</th>
                <th className="px-4 py-2.5 font-medium">Won</th>
                <th className="px-4 py-2.5 font-medium">Companies</th>
                <th className="px-4 py-2.5 font-medium">Contacts</th>
                <th className="px-4 py-2.5 font-medium">Follow-ups</th>
                <th className="px-4 py-2.5 font-medium">Role</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-line/60 last:border-0 hover:bg-surface-2/60">
                  <td className="px-4 py-2.5">
                    <button onClick={() => openDetail(r.id)} className="inline-flex items-center gap-2 text-left">
                      <Avatar name={r.name} size={22} />
                      <span>
                        <span className="block font-medium text-bone hover:text-signal">{r.name}</span>
                        <span className="block text-xs text-faint">{r.email}</span>
                      </span>
                    </button>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-bone">
                      {formatRange(
                        pipelineValueRange(Number(r.open_value), Number(r.open_unpriced ?? 0)).low,
                        pipelineValueRange(Number(r.open_value), Number(r.open_unpriced ?? 0)).high,
                      )}
                    </div>
                    <div className="text-xs text-faint">{r.open_count} open</div>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-signal">
                      {formatRange(
                        pipelineMrrRange(Number(r.open_monthly), Number(r.open_monthly_unpriced ?? 0)).low,
                        pipelineMrrRange(Number(r.open_monthly), Number(r.open_monthly_unpriced ?? 0)).high,
                      )}
                      <span className="text-xs text-faint">/mo</span>
                    </div>
                    <div className="text-xs text-faint">
                      rep cut{" "}
                      {formatRange(
                        Math.round(pipelineMrrRange(Number(r.open_monthly), Number(r.open_monthly_unpriced ?? 0)).low * 0.3),
                        Math.round(pipelineMrrRange(Number(r.open_monthly), Number(r.open_monthly_unpriced ?? 0)).high * 0.3),
                      )}
                      /mo
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="text-mute">{formatMoney(Number(r.won_value))}</div>
                    <div className="text-xs text-faint">{r.won_count} won</div>
                  </td>
                  <td className="px-4 py-2.5 text-mute">{r.companies_count}</td>
                  <td className="px-4 py-2.5 text-mute">{r.contacts_count}</td>
                  <td className="px-4 py-2.5">
                    {Number(r.overdue_activities) > 0 ? (
                      <Pill tone="danger">{r.overdue_activities} overdue</Pill>
                    ) : (
                      <span className="text-mute">{r.open_activities} open</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {r.role === "admin" ? (
                      <Pill tone="signal">Admin</Pill>
                    ) : r.role === "manager" ? (
                      <span title="Sees & works the whole team's companies, contacts, and deals — no admin pages">
                        <Pill tone="warn">Manager</Pill>
                      </span>
                    ) : (
                      <Pill tone="neutral">Member</Pill>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {/* Role picker: the old toggle only knew admin/member. */}
                      <select
                        disabled={busy}
                        value={r.role}
                        onChange={(e) => changeRole(r, e.target.value as "admin" | "manager" | "member")}
                        title="Member: own book only · Manager: whole team's book · Admin: everything incl. Team/Payroll/Billing"
                        className="rounded border border-line bg-surface px-1.5 py-0.5 text-xs text-mute hover:text-signal disabled:opacity-50"
                      >
                        <option value="member">Member</option>
                        <option value="manager">Manager</option>
                        <option value="admin">Admin</option>
                      </select>
                      <span className="text-line-strong">·</span>
                      <button
                        disabled={busy}
                        onClick={() => {
                          setResetFor(r);
                          setError(null);
                        }}
                        className="text-xs text-mute hover:text-signal disabled:opacity-50"
                      >
                        Reset password
                      </button>
                      <span className="text-line-strong">·</span>
                      <button
                        disabled={busy || (Number(r.companies_count) === 0 && Number(r.open_count) === 0 && Number(r.won_count) === 0 && Number(r.contacts_count) === 0)}
                        onClick={() => {
                          setReassignFor(r);
                          setError(null);
                        }}
                        className="text-xs text-mute hover:text-signal disabled:opacity-30"
                      >
                        Reassign
                      </button>
                      <span className="text-line-strong">·</span>
                      <button
                        disabled={busy}
                        onClick={() => removeUser(r)}
                        className="text-xs text-faint hover:text-red-600 disabled:opacity-50"
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <RepActivityPanel initial={activity as { range: "week" | "month" | "quarter"; rows: RepActivityRow[] }} />

      <MemberDetailModal
        detail={detail}
        loading={detailLoading}
        onClose={() => setDetail(null)}
      />

      <AddTeammateModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSaved={async () => {
          setAddOpen(false);
          await refresh();
        }}
      />

      <ResetPasswordModal
        member={resetFor}
        onClose={() => setResetFor(null)}
        onSaved={() => setResetFor(null)}
      />

      <ReassignModal
        member={reassignFor}
        team={rows}
        onClose={() => setReassignFor(null)}
        onSaved={async () => {
          setReassignFor(null);
          await refresh();
        }}
      />
    </div>
  );
}

function ReassignModal({
  member,
  team,
  onClose,
  onSaved,
}: {
  member: TeamMemberRow | null;
  team: TeamMemberRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const others = team.filter((t) => t.id !== member?.id);
  const [toId, setToId] = useState("");
  const [moveCompanies, setMoveCompanies] = useState(true);
  const [moveDeals, setMoveDeals] = useState(true);
  const [moveContacts, setMoveContacts] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!member) return null;

  const target = others.find((t) => t.id === toId);
  const nothingPicked = !moveCompanies && !moveDeals && !moveContacts;

  async function submit() {
    if (!member || !toId || nothingPicked) return;
    setSaving(true);
    setError(null);
    try {
      const res = await adminReassignBook({
        data: {
          from_user_id: member.id,
          to_user_id: toId,
          companies: moveCompanies,
          deals: moveDeals,
          contacts: moveContacts,
        },
      });
      setSaving(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onSaved();
    } catch {
      setSaving(false);
      setError("Couldn't reassign those records. Please try again.");
    }
  }

  const Check = ({
    checked,
    onChange,
    label,
    count,
  }: {
    checked: boolean;
    onChange: (v: boolean) => void;
    label: string;
    count: number;
  }) => (
    <label className="flex cursor-pointer items-center justify-between rounded-lg border border-line bg-surface px-3 py-2.5 hover:border-line-strong">
      <span className="flex items-center gap-2.5">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 accent-signal"
        />
        <span className="text-sm text-bone">{label}</span>
      </span>
      <span className="font-mono text-xs text-faint">{count}</span>
    </label>
  );

  return (
    <Modal open onClose={onClose} title={`Reassign ${member.name}'s records`}>
      <div className="space-y-4">
        {error ? (
          <div className="rounded-lg bg-red-500/15 px-3 py-2 text-xs text-red-600">{error}</div>
        ) : null}

        <Field label="Hand everything to">
          <Select value={toId} onChange={(e) => setToId(e.target.value)}>
            <option value="">Choose a teammate…</option>
            {others.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>

        <div>
          <div className="mb-1.5">
            <Eyebrow>What to move</Eyebrow>
          </div>
          <div className="space-y-2">
            <Check checked={moveCompanies} onChange={setMoveCompanies} label="Companies" count={Number(member.companies_count)} />
            <Check checked={moveDeals} onChange={setMoveDeals} label="Deals" count={Number(member.open_count) + Number(member.won_count)} />
            <Check checked={moveContacts} onChange={setMoveContacts} label="Contacts" count={Number(member.contacts_count)} />
          </div>
        </div>

        <p className="text-xs text-faint">
          {target
            ? `These records move from ${member.name} to ${target.name}. ${target.name} becomes the owner; you can always move them back.`
            : "Pick who should take over these records."}
        </p>

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={saving || !toId || nothingPicked}>
            {saving ? "Moving…" : "Reassign records"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <Eyebrow className="mb-1.5">{title}</Eyebrow>
      {children}
    </div>
  );
}

function MemberDetailModal({
  detail,
  loading,
  onClose,
}: {
  detail: Detail | null;
  loading: boolean;
  onClose: () => void;
}) {
  if (!detail && !loading) return null;
  return (
    <Modal open onClose={onClose} title={detail ? detail.user.name : "Loading…"} wide>
      {loading || !detail ? (
        <div className="py-8 text-center text-sm text-mute">Loading…</div>
      ) : (
        <div className="space-y-5">
          <div className="flex items-center gap-3">
            <Avatar name={detail.user.name} size={40} />
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium text-bone">{detail.user.name}</span>
                {detail.user.role === "admin" ? (
                  <Pill tone="signal">Admin</Pill>
                ) : detail.user.role === "manager" ? (
                  <Pill tone="warn">Manager</Pill>
                ) : null}
              </div>
              <div className="text-xs text-faint">{detail.user.email}</div>
            </div>
          </div>

          <Section title={`Deals (${detail.deals.length})`}>
            {detail.deals.length === 0 ? (
              <p className="text-sm text-faint">No deals owned.</p>
            ) : (
              <ul className="divide-y divide-line/60 rounded-lg border border-line">
                {detail.deals.map((d) => (
                  <li key={d.id as string}>
                    {/* Owner's ask (2026-07-22): from this panel, click through to the
                        deal itself — notes, calls, and the full timeline live there. */}
                    <Link
                      to="/deals/$dealId"
                      params={{ dealId: d.id as string }}
                      title="Open this deal — notes, calls, and full history"
                      className="flex items-center justify-between gap-2 px-3 py-2 transition-colors hover:bg-surface-2"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm text-bone">{d.name as string}</div>
                        <div className="truncate text-xs text-faint">{(d.company_name as string) || "No company"}</div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="font-mono text-xs text-signal">{formatMoney(Number(d.value))}</span>
                        <StageBadge stage={d.stage as string} />
                        <span className="text-xs text-faint">→</span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <div className="grid gap-4 sm:grid-cols-2">
            <Section title={`Companies (${detail.companies.length})`}>
              {detail.companies.length === 0 ? (
                <p className="text-sm text-faint">None.</p>
              ) : (
                <ul className="space-y-1">
                  {detail.companies.map((c) => (
                    <li key={c.id as string} className="text-sm">
                      <Link
                        to="/companies/$companyId"
                        params={{ companyId: c.id as string }}
                        search={{ focus: undefined, new: undefined }}
                        title="Open this company — notes, research, deals, and history"
                        className="text-bone hover:text-signal hover:underline"
                      >
                        {c.name as string}
                      </Link>
                      {c.city ? <span className="text-faint"> · {c.city as string}</span> : null}
                    </li>
                  ))}
                </ul>
              )}
            </Section>
            <Section title={`Contacts (${detail.contacts.length})`}>
              {detail.contacts.length === 0 ? (
                <p className="text-sm text-faint">None.</p>
              ) : (
                <ul className="space-y-1">
                  {detail.contacts.map((c) => (
                    <li key={c.id as string} className="text-sm">
                      <Link
                        to="/contacts/$contactId"
                        params={{ contactId: c.id as string }}
                        search={{ focus: undefined, new: undefined }}
                        title="Open this contact — details and history"
                        className="text-bone hover:text-signal hover:underline"
                      >
                        {`${c.first_name as string} ${(c.last_name as string) || ""}`.trim()}
                      </Link>
                      {c.title ? <span className="text-faint"> · {c.title as string}</span> : null}
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>

          <Section title={`Activities (${detail.activities.length})`}>
            {detail.activities.length === 0 ? (
              <p className="text-sm text-faint">None.</p>
            ) : (
              <ul className="divide-y divide-line/60 rounded-lg border border-line">
                {detail.activities.map((a) => (
                  <li key={a.id as string} className="flex items-center justify-between gap-2 px-3 py-2">
                    <div className="min-w-0">
                      <div className={"truncate text-sm " + (a.status === "done" ? "text-faint line-through" : "text-bone")}>
                        {a.subject as string}
                      </div>
                      <div className="text-xs text-faint">
                        {a.type as string}
                        {a.deal_name && a.deal_id ? (
                          <>
                            {" · "}
                            <Link
                              to="/deals/$dealId"
                              params={{ dealId: a.deal_id as string }}
                              className="hover:text-signal hover:underline"
                            >
                              {a.deal_name as string}
                            </Link>
                          </>
                        ) : a.deal_name ? (
                          ` · ${a.deal_name as string}`
                        ) : (
                          ""
                        )}
                      </div>
                    </div>
                    {a.due_date ? <Pill tone="neutral">{String(a.due_date).slice(0, 10)}</Pill> : null}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      )}
    </Modal>
  );
}

function AddTeammateModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const res = await adminCreateUser({
      data: {
        name: String(fd.get("name") || ""),
        email: String(fd.get("email") || ""),
        password: String(fd.get("password") || ""),
        role: (String(fd.get("role") || "member") as "admin" | "manager" | "member"),
      },
    });
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onSaved();
  }

  return (
    <Modal open={open} onClose={onClose} title="Add teammate">
      <form onSubmit={onSubmit} className="space-y-3">
        {error ? <div className="rounded-lg bg-red-500/15 px-3 py-2 text-xs text-red-600">{error}</div> : null}
        <Field label="Full name">
          <Input name="name" required placeholder="Their name" />
        </Field>
        <Field label="Email">
          <Input name="email" type="email" required placeholder="teammate@nexraft.com" />
        </Field>
        <Field label="Temporary password">
          <Input name="password" type="text" required minLength={8} placeholder="At least 8 characters" />
        </Field>
        <Field label="Role">
          <Select name="role" defaultValue="member">
            <option value="member">Member — their own book only</option>
            <option value="manager">Manager — the whole team's book</option>
            <option value="admin">Admin — everything, incl. Team &amp; Payroll</option>
          </Select>
        </Field>
        <p className="text-xs text-faint">
          They can sign in right away with this email and password, then change it later.
        </p>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Adding…" : "Add teammate"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ResetPasswordModal({
  member,
  onClose,
  onSaved,
}: {
  member: TeamMemberRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!member) return null;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!member) return;
    setSaving(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    try {
      await adminResetPassword({
        data: { id: member.id, password: String(fd.get("password") || "") },
      });
      setSaving(false);
      onSaved();
    } catch {
      setSaving(false);
      setError("Couldn't reset the password. Please try again.");
    }
  }

  return (
    <Modal open onClose={onClose} title={`Reset password — ${member.name}`}>
      <form onSubmit={onSubmit} className="space-y-3">
        {error ? <div className="rounded-lg bg-red-500/15 px-3 py-2 text-xs text-red-600">{error}</div> : null}
        <Field label="New password">
          <Input name="password" type="text" required minLength={8} placeholder="At least 8 characters" />
        </Field>
        <p className="text-xs text-faint">
          This signs {member.name} out everywhere. Share the new password with them directly.
        </p>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Set password"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
