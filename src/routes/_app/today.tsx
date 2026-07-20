import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import {
  getDeals,
  getActivities,
  getCompanies,
  getContacts,
  setCompanyCallOutcome,
} from "../../lib/crm/data";
import {
  Card,
  cx,
  Eyebrow,
  PageHeader,
  Pill,
  StageBadge,
  SummaryCard,
  PageSkeleton,
} from "../../components/crm/ui";
import { toast } from "../../components/crm/toast";
import {
  daysBetween,
  formatMoney,
  OPEN_STAGES,
  opportunityScore,
  OPPORTUNITY_BAND_INFO,
  RENEWAL_SOON_DAYS,
  relativeTime,
  STALE_DAYS,
} from "../../lib/crm/constants";

type Row = Record<string, unknown>;
type Me = { id: string; role: string; name: string; email: string } | null;

export const Route = createFileRoute("/_app/today")({
  loader: async ({ context }) => {
    const [deals, activities, companies, contacts] = await Promise.all([
      getDeals(),
      getActivities(),
      getCompanies(),
      getContacts(),
    ]);
    const me = (context as { user?: NonNullable<Me> }).user ?? null;
    return { deals, activities, companies, contacts, me };
  },
  component: TodayPage,
  pendingComponent: () => <PageSkeleton cards={4} rows={6} />,
});

// A time-of-day greeting. Computed after mount so SSR and client agree.
function useGreeting(): string {
  const [greeting, setGreeting] = useState("Here's your day");
  useEffect(() => {
    const h = new Date().getHours();
    setGreeting(h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening");
  }, []);
  return greeting;
}

// A section wrapper: title + count, and either a worklist or a quiet "clear" line.
function Section({
  title,
  icon,
  count,
  emptyLine,
  children,
}: {
  title: string;
  icon: string;
  count: number;
  emptyLine: string;
  children: ReactNode;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-base">{icon}</span>
          <Eyebrow>{title}</Eyebrow>
        </div>
        {count > 0 ? (
          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-mute">{count}</span>
        ) : null}
      </div>
      {count === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-faint">{emptyLine}</div>
      ) : (
        <ul className="divide-y divide-line/60">{children}</ul>
      )}
    </Card>
  );
}

function TodayPage() {
  const { deals, activities, companies, contacts, me } = Route.useLoaderData();
  const greeting = useGreeting();
  const firstName = (me?.name || "").split(" ")[0] || me?.name || "";
  const meId = me?.id ?? null;
  const today = new Date().toISOString().slice(0, 10);

  // Which companies have an email on file (via their contacts)? Feeds the score.
  const hasEmail = useMemo(() => {
    const set = new Set<string>();
    for (const ct of contacts as Row[]) {
      if ((ct.email as string) && (ct.company_id as string)) set.add(ct.company_id as string);
    }
    return set;
  }, [contacts]);

  // My open follow-ups, most urgent first (overdue → soonest due → undated).
  const myFollowups = useMemo(() => {
    return (activities as Row[])
      .filter((a) => a.status === "open" && meId && a.owner_id === meId)
      .map((a) => {
        const due = a.due_date ? String(a.due_date).slice(0, 10) : "";
        return { row: a, due, overdue: !!due && due < today };
      })
      .sort((a, b) => {
        if (!a.due && !b.due) return 0;
        if (!a.due) return 1;
        if (!b.due) return -1;
        return a.due < b.due ? -1 : a.due > b.due ? 1 : 0;
      });
  }, [activities, meId, today]);
  const overdueCount = myFollowups.filter((f) => f.overdue).length;

  // My open deals that haven't moved in a while — the ones quietly going cold.
  const myStale = useMemo(() => {
    return (deals as Row[])
      .filter((d) => meId && d.owner_id === meId && OPEN_STAGES.includes(d.stage as string))
      .map((d) => ({ row: d, days: daysBetween(d.stage_changed_at as string) }))
      .filter((x) => x.days >= STALE_DAYS)
      .sort((a, b) => b.days - a.days);
  }, [deals, meId]);

  // My retainers renewing soon (or already overdue).
  const myRenewals = useMemo(() => {
    return (deals as Row[])
      .filter((d) => {
        if (!meId || d.owner_id !== meId) return false;
        const rd = d.renewal_date ? String(d.renewal_date) : "";
        if (!rd) return false;
        const days = daysBetween(rd);
        return days <= RENEWAL_SOON_DAYS; // negative = already overdue
      })
      .map((d) => ({ row: d, days: daysBetween(d.renewal_date as string) }))
      .sort((a, b) => a.days - b.days);
  }, [deals, meId]);

  // Hot leads sitting in the open pool — unclaimed and worth grabbing. These are
  // team-shared, so everyone sees the same list regardless of owner.
  const hotPool = useMemo(() => {
    return (companies as Row[])
      .filter((c) => !c.owner_id && c.call_outcome !== "signed")
      .map((c) => {
        const res = opportunityScore({
          source: c.source as string | null,
          callOutcome: c.call_outcome as string | null,
          industry: c.industry as string | null,
          hasPhone: Boolean(c.phone),
          hasEmail: hasEmail.has(c.id as string),
          createdAt: c.created_at as string | null,
        });
        return { row: c, score: res.score, band: res.band, reasons: res.reasons };
      })
      .filter((x) => x.band === "hot")
      .sort((a, b) => b.score - a.score);
  }, [companies, hasEmail]);

  // My assigned leads still in play — the heart of a rep's day. Owned by me and
  // not yet closed out: fresh (never called), warm ("maybe"), or waiting on a
  // callback after a no-answer. This is the company/call pipeline reps actually
  // work; the deal- and task-based sections below never surface it, which is why
  // an actively-working rep could see an empty "all caught up" day.
  const myLeads = useMemo(() => {
    const rank: Record<string, number> = { no_answer: 0, maybe: 1, "": 2 };
    return (companies as Row[])
      .filter((c) => {
        if (!meId || c.owner_id !== meId) return false;
        const o = (c.call_outcome as string | null) ?? "";
        return o === "" || o === "maybe" || o === "no_answer";
      })
      .map((c) => ({ row: c, outcome: (c.call_outcome as string | null) ?? "" }))
      .sort((a, b) => (rank[a.outcome] ?? 3) - (rank[b.outcome] ?? 3));
  }, [companies, meId]);

  // The game plan: one numbered list that answers "what do I do first?" so
  // nobody has to weigh up the sections below themselves. Priority order:
  // overdue follow-ups → callbacks → fresh leads → warm maybes → cold deals.
  type PlanItem = {
    key: string;
    title: string;
    reason: string;
    to: string;
    params?: Record<string, string>;
    chip: string;
    tone: "danger" | "warn" | "signal" | "neutral";
  };
  const plan = useMemo<PlanItem[]>(() => {
    const items: PlanItem[] = [];
    for (const f of myFollowups.filter((x) => x.overdue)) {
      items.push({
        key: `fu-${f.row.id as string}`,
        title: (f.row.subject as string) || "Untitled task",
        reason: `You promised this ${Math.abs(daysBetween(f.due))}d ago — do it before anything else`,
        to: "/activities",
        chip: "Overdue",
        tone: "danger",
      });
    }
    for (const l of myLeads.filter((x) => x.outcome === "no_answer")) {
      items.push({
        key: `cb-${l.row.id as string}`,
        title: l.row.name as string,
        reason: "They didn't pick up last time — call again, second tries convert",
        to: "/calls",
        chip: "Call back",
        tone: "warn",
      });
    }
    for (const l of myLeads.filter((x) => x.outcome === "")) {
      items.push({
        key: `new-${l.row.id as string}`,
        title: l.row.name as string,
        reason: `Fresh lead${l.row.industry ? ` — ${(l.row.industry as string).toLowerCase()}` : ""} — never been called, first in wins`,
        to: "/calls",
        chip: "First call",
        tone: "signal",
      });
    }
    for (const l of myLeads.filter((x) => x.outcome === "maybe")) {
      items.push({
        key: `mb-${l.row.id as string}`,
        title: l.row.name as string,
        reason: "They said maybe — a friendly nudge is often all it takes",
        to: "/calls",
        chip: "Warm",
        tone: "neutral",
      });
    }
    for (const s of myStale) {
      items.push({
        key: `st-${s.row.id as string}`,
        title: s.row.name as string,
        reason: `Deal hasn't moved in ${s.days}d — check in before it goes cold`,
        to: "/deals/$dealId",
        params: { dealId: s.row.id as string },
        chip: `${s.days}d quiet`,
        tone: "warn",
      });
    }
    return items.slice(0, 8);
  }, [myFollowups, myLeads, myStale]);

  const nothing =
    myLeads.length === 0 &&
    myFollowups.length === 0 &&
    myStale.length === 0 &&
    myRenewals.length === 0 &&
    hotPool.length === 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title={firstName ? `${greeting}, ${firstName}` : "My day"}
        subtitle="Everything with your name on it that needs a nudge today — follow-ups, deals going cold, renewals, and hot leads up for grabs."
      />

      <ArcadeDeck
        leads={myLeads}
        activities={activities as Row[]}
        meId={meId}
        repFirst={firstName}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <SummaryCard
          label="Leads to work"
          value={String(myLeads.length)}
          sub="assigned to you"
          accent={myLeads.length > 0}
          hint="Companies you own that still need a call or a nudge."
        />
        <SummaryCard
          label="Follow-ups due"
          value={String(myFollowups.length)}
          sub={overdueCount > 0 ? `${overdueCount} overdue` : "on track"}
          accent={overdueCount > 0}
          hint="Your open tasks and reminders, most urgent first."
        />
        <SummaryCard
          label="Deals going cold"
          value={String(myStale.length)}
          sub={`no movement in ${STALE_DAYS}+ days`}
          hint="Open deals you own that haven't changed stage in a while."
        />
        <SummaryCard
          label="Renewals soon"
          value={String(myRenewals.length)}
          sub={`within ${RENEWAL_SOON_DAYS} days`}
          hint="Your active retainers coming up for renewal."
        />
        <SummaryCard
          label="Hot & unclaimed"
          value={String(hotPool.length)}
          sub="in the open pool"
          hint="High-scoring leads nobody's claimed yet — grab them first."
        />
      </div>

      {plan.length > 0 ? (
        <Card className="overflow-hidden border-signal/25">
          <div className="flex items-center justify-between border-b border-line bg-gradient-to-r from-signal-soft/30 to-transparent px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="text-base">🎯</span>
              <Eyebrow>Your game plan — work it top to bottom</Eyebrow>
            </div>
            <span className="text-[11px] text-faint">no guesswork, just dial</span>
          </div>
          <ol className="divide-y divide-line/60">
            {plan.map((p, i) => (
              <li key={p.key}>
                <Link
                  to={p.to}
                  params={p.params}
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2/50"
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-2 font-mono text-[11px] font-bold text-signal">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-bone">{p.title}</div>
                    <div className="truncate text-xs text-faint">{p.reason}</div>
                  </div>
                  <Pill tone={p.tone}>{p.chip}</Pill>
                </Link>
              </li>
            ))}
          </ol>
        </Card>
      ) : null}

      {nothing ? (
        <Card className="flex items-center gap-3 border-signal/25 bg-gradient-to-br from-signal-soft/40 via-surface to-surface p-5">
          <span className="text-2xl">✅</span>
          <div>
            <div className="text-sm font-semibold text-bone">You're all caught up</div>
            <div className="text-xs text-mute">
              Nothing needs you right now — no follow-ups, cold deals, renewals, or hot leads waiting.
            </div>
          </div>
        </Card>
      ) : null}

      <Section
        title="Leads to work"
        icon="📞"
        count={myLeads.length}
        emptyLine="No leads assigned to you right now — grab some from Opportunities or Discover."
      >
        {myLeads.map(({ row: c, outcome }) => {
          const label =
            outcome === "no_answer" ? "Call back" : outcome === "maybe" ? "Warm — follow up" : "New — call";
          const tone: "warn" | "neutral" | "signal" =
            outcome === "no_answer" ? "warn" : outcome === "maybe" ? "neutral" : "signal";
          return (
            <li key={c.id as string} className="px-4 py-2.5">
              <Link to="/calls" className="flex items-center justify-between gap-3 hover:opacity-90">
                <div className="min-w-0">
                  <div className="truncate text-sm text-bone">{(c.name as string) || "Untitled"}</div>
                  <div className="truncate text-xs text-faint">
                    {(c.industry as string) || "—"}
                    {c.city ? ` · ${c.city as string}` : ""}
                    {c.phone ? ` · ${c.phone as string}` : " · no phone on file"}
                  </div>
                </div>
                <Pill tone={tone}>{label}</Pill>
              </Link>
            </li>
          );
        })}
      </Section>

      <Section
        title="Follow-ups due"
        icon="✅"
        count={myFollowups.length}
        emptyLine="No open follow-ups. Nice work."
      >
        {myFollowups.map(({ row: f, due, overdue }) => (
          <li key={f.id as string} className="px-4 py-2.5">
            <Link
              to="/activities"
              className="flex items-center justify-between gap-3 hover:opacity-90"
            >
              <div className="min-w-0">
                <div className="truncate text-sm text-bone">{(f.subject as string) || "Untitled task"}</div>
                <div className="truncate text-xs text-faint">
                  {(f.type as string) || "task"}
                  {f.deal_name ? ` · ${f.deal_name as string}` : ""}
                </div>
              </div>
              <Pill tone={overdue ? "danger" : "neutral"}>
                {due ? (overdue ? `${Math.abs(daysBetween(due))}d overdue` : due) : "No date"}
              </Pill>
            </Link>
          </li>
        ))}
      </Section>

      <Section
        title="Deals going cold"
        icon="🧊"
        count={myStale.length}
        emptyLine={`Nothing's stalling — every open deal has moved within ${STALE_DAYS} days.`}
      >
        {myStale.map(({ row: d, days }) => (
          <li key={d.id as string} className="px-4 py-2.5">
            <Link
              to="/deals/$dealId"
              params={{ dealId: d.id as string }}
              className="flex items-center justify-between gap-3 hover:opacity-90"
            >
              <div className="min-w-0">
                <div className="truncate text-sm text-bone">{d.name as string}</div>
                <div className="truncate text-xs text-faint">
                  {formatMoney(Number(d.value))}
                  {d.company_name ? ` · ${d.company_name as string}` : ""}
                  {d.next_step ? ` · next: ${d.next_step as string}` : ""}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <StageBadge stage={d.stage as string} />
                <Pill tone="warn">{days}d</Pill>
              </div>
            </Link>
          </li>
        ))}
      </Section>

      <Section
        title="Renewals coming up"
        icon="🔄"
        count={myRenewals.length}
        emptyLine={`No renewals in the next ${RENEWAL_SOON_DAYS} days.`}
      >
        {myRenewals.map(({ row: d, days }) => {
          const overdue = days < 0;
          return (
            <li key={d.id as string} className="px-4 py-2.5">
              <Link
                to="/deals/$dealId"
                params={{ dealId: d.id as string }}
                className="flex items-center justify-between gap-3 hover:opacity-90"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm text-bone">{d.name as string}</div>
                  <div className="truncate text-xs text-faint">
                    {d.company_name ? `${d.company_name as string} · ` : ""}
                    {Number(d.monthly_value) > 0 ? `${formatMoney(Number(d.monthly_value))}/mo` : ""}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Pill tone={overdue ? "danger" : "neutral"}>
                    {overdue ? `${Math.abs(days)}d overdue` : `in ${days}d`}
                  </Pill>
                  <span className="text-[11px] text-faint">{String(d.renewal_date).slice(0, 10)}</span>
                </div>
              </Link>
            </li>
          );
        })}
      </Section>

      <Section
        title="Hot leads up for grabs"
        icon="🔥"
        count={hotPool.length}
        emptyLine="No unclaimed hot leads right now — check Discover to find more."
      >
        {hotPool.map(({ row: c, score, band, reasons }) => {
          const color = OPPORTUNITY_BAND_INFO[band].color;
          return (
            <li key={c.id as string} className="px-4 py-2.5">
              <Link to="/opportunities" className="flex items-center gap-3 hover:opacity-90">
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold"
                  style={{ borderColor: color, color }}
                >
                  {score}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-bone">{(c.name as string) || "Untitled"}</div>
                  <div className="truncate text-xs text-faint">
                    {(c.industry as string) || "—"}
                    {reasons.length ? ` · ${reasons.slice(0, 2).join(", ")}` : ""}
                    {c.created_at ? ` · added ${relativeTime(c.created_at as string)}` : ""}
                  </div>
                </div>
                <Pill tone="signal">Claim →</Pill>
              </Link>
            </li>
          );
        })}
      </Section>
    </div>
  );
}

// ---- Arcade deck -------------------------------------------------------------
// One company at a time, three big buttons, a mission bar and a streak flame.
// Command Deck styling, card-game feel: a rep can't get lost because there's
// only ever one thing to do. Outcomes hit the same triage backend as the Calls
// board (setCompanyCallOutcome), so stats and the leaderboard stay honest.
const ARCADE_DAILY_TARGET = 20;

function ArcadeDeck({
  leads,
  activities,
  meId,
  repFirst,
}: {
  leads: { row: Row; outcome: string }[];
  activities: Row[];
  meId: string | null;
  repFirst: string;
}) {
  // Companies triaged in this session — removed from the deck locally so we
  // never re-shuffle mid-run, plus they bump the mission bar instantly.
  const [handled, setHandled] = useState<Set<string>>(() => new Set());
  const [phase, setPhase] = useState<"in" | "out-left" | "out-up">("in");
  const [busy, setBusy] = useState(false);

  // Calls already logged today + streak, from my Call activities. Computed
  // after mount so SSR and client agree on "today".
  const [baseToday, setBaseToday] = useState(0);
  const [streak, setStreak] = useState(0);
  useEffect(() => {
    if (!meId) return;
    const days = new Set<string>();
    for (const a of activities) {
      if (a.type !== "Call" || a.owner_id !== meId || !a.completed_at) continue;
      days.add(String(a.completed_at).slice(0, 10));
    }
    const key = (d: Date) => d.toISOString().slice(0, 10);
    const today = new Date();
    setBaseToday(days.has(key(today)) ? 1 : 0);
    let s = 0;
    const cursor = new Date(today);
    if (!days.has(key(cursor))) cursor.setDate(cursor.getDate() - 1); // streak survives until today ends
    while (days.has(key(cursor))) {
      s += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    setStreak(s);
    // Count today's actual call volume, not just "did they call at all".
    let n = 0;
    for (const a of activities) {
      if (a.type === "Call" && a.owner_id === meId && String(a.completed_at ?? "").slice(0, 10) === key(today)) n += 1;
    }
    setBaseToday(n);
  }, [activities, meId]);

  const deck = leads.filter((l) => !handled.has(l.row.id as string));
  const current = deck[0];
  const done = baseToday + handled.size;
  const pct = Math.min(100, Math.round((done / ARCADE_DAILY_TARGET) * 100));

  async function play(outcome: "no_answer" | "maybe" | "interested") {
    if (!current || busy) return;
    const id = current.row.id as string;
    const name = (current.row.name as string) || "Company";
    setBusy(true);
    setPhase(outcome === "interested" ? "out-up" : "out-left");
    try {
      await setCompanyCallOutcome({ data: { id, outcome } });
      setTimeout(() => {
        setHandled((prev) => new Set(prev).add(id));
        setPhase("in");
        setBusy(false);
      }, 320);
      if (outcome === "interested") toast(`🔥 ${name} is interested — deal created!`);
      else if (outcome === "maybe") toast(`${name} → callback pile`, "info");
      else toast(`${name} → no answer, we'll retry`, "info");
    } catch {
      setPhase("in");
      setBusy(false);
      toast("Couldn't save that — try again", "error");
    }
  }

  if (leads.length === 0) return null;

  return (
    <Card className="overflow-hidden border-signal/25">
      {/* Mission strip */}
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-signal-soft/20 px-4 py-3">
        <Eyebrow>🎮 Today's mission</Eyebrow>
        <div className="h-2 min-w-[120px] flex-1 overflow-hidden rounded-full bg-surface-2 shadow-[inset_0_1px_3px_rgba(0,0,0,0.5)]">
          <div
            className="h-full rounded-full bg-gradient-to-r from-signal-strong via-signal to-[#ff8a5c] shadow-[0_0_12px_rgba(255,77,28,0.7)] transition-[width] duration-500"
            style={{ width: `${Math.max(2, pct)}%` }}
          />
        </div>
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-mute">
          <span className="font-bold text-signal">{done}</span>/{ARCADE_DAILY_TARGET} calls
        </span>
        {streak > 0 ? (
          <span className="font-mono text-[11px] text-mute" title="Days in a row with at least one call">
            <span className="animate-pulse">🔥</span> {streak}-day streak
          </span>
        ) : null}
      </div>

      {current ? (
        <>
          {/* The card */}
          <div className="px-4 py-5 sm:px-6" style={{ perspective: "1200px" }}>
            <div
              className={cx(
                "relative mx-auto max-w-xl rounded-2xl border border-line-strong bg-gradient-to-br from-[#16161d] to-surface p-6 shadow-[0_30px_70px_-30px_rgba(0,0,0,0.9),0_0_50px_-30px_rgba(255,77,28,0.6)] transition-all duration-300",
                phase === "out-left" && "-translate-x-[120%] rotate-[-6deg] opacity-0",
                phase === "out-up" && "-translate-y-16 rotate-[3deg] scale-105 opacity-0",
              )}
            >
              <span className="pointer-events-none absolute right-0 top-0 h-3 w-3 rounded-tr-2xl border-r-2 border-t-2 border-signal" />
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-faint">
                Card {handled.size + 1} of {leads.length}
                {current.outcome === "no_answer" ? " · callback" : current.outcome === "maybe" ? " · warm" : " · fresh"}
              </div>
              <div className="font-display mt-2 text-2xl font-extrabold leading-tight text-bone sm:text-3xl">
                {(current.row.name as string) || "Untitled company"}
              </div>
              <div className="mt-2 font-mono text-[11px] uppercase tracking-[0.08em] text-faint">
                {[(current.row.industry as string) || null, (current.row.city as string) || null]
                  .filter(Boolean)
                  .join(" · ") || "No details on file"}
              </div>
              <div className="mt-4 rounded-r-lg border-l-2 border-signal bg-signal-soft/30 px-4 py-3 text-sm leading-relaxed text-mute">
                "Hi, this is {repFirst || "..."} from Nexraft — we build websites for local
                businesses. I'd love to show you what we'd do with{" "}
                {(current.row.name as string) || "your business"}…"
              </div>
              <div className="font-display mt-4 text-xl font-extrabold tracking-wide text-signal">
                {(current.row.phone as string) ? `☎ ${current.row.phone as string}` : "No phone on file — try Discover"}
              </div>
            </div>
          </div>

          {/* The three buttons */}
          <div className="flex justify-center gap-3 px-4 pb-5">
            <button
              onClick={() => play("no_answer")}
              disabled={busy}
              className="flex w-36 flex-col items-center gap-1 rounded-xl border border-line bg-surface-2/60 py-3 text-sm font-semibold text-mute transition-all hover:-translate-y-0.5 hover:border-line-strong hover:text-bone disabled:opacity-50"
            >
              <span className="text-xl">📵</span>No answer
            </button>
            <button
              onClick={() => play("maybe")}
              disabled={busy}
              className="flex w-36 flex-col items-center gap-1 rounded-xl border border-line bg-surface-2/60 py-3 text-sm font-semibold text-mute transition-all hover:-translate-y-0.5 hover:border-line-strong hover:text-bone disabled:opacity-50"
            >
              <span className="text-xl">📅</span>Callback
            </button>
            <button
              onClick={() => play("interested")}
              disabled={busy}
              className="flex w-36 flex-col items-center gap-1 rounded-xl bg-gradient-to-b from-[#ff6a3c] to-signal-strong py-3 text-sm font-bold text-white shadow-[0_8px_30px_rgba(255,77,28,0.45)] transition-all hover:-translate-y-0.5 hover:shadow-[0_12px_40px_rgba(255,77,28,0.6)] disabled:opacity-50"
            >
              <span className="text-xl">🔥</span>Interested!
            </button>
          </div>
          <div className="pb-4 text-center">
            <Link to="/calls" className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint hover:text-signal">
              Need the full script + notes? Open call mode →
            </Link>
          </div>
        </>
      ) : (
        <div className="flex items-center justify-center gap-3 px-4 py-8">
          <span className="text-2xl">🏆</span>
          <div>
            <div className="text-sm font-semibold text-bone">Deck cleared — {handled.size} triaged this run</div>
            <div className="text-xs text-mute">
              Grab more from <Link to="/opportunities" className="text-signal hover:underline">Opportunities</Link> or{" "}
              <Link to="/discover" className="text-signal hover:underline">Discover</Link>.
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
