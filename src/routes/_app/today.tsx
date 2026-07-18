import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { getDeals, getActivities, getCompanies, getContacts } from "../../lib/crm/data";
import {
  Card,
  Eyebrow,
  PageHeader,
  Pill,
  StageBadge,
  SummaryCard,
  PageSkeleton,
} from "../../components/crm/ui";
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

  const nothing =
    myFollowups.length === 0 && myStale.length === 0 && myRenewals.length === 0 && hotPool.length === 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title={firstName ? `${greeting}, ${firstName}` : "My day"}
        subtitle="Everything with your name on it that needs a nudge today — follow-ups, deals going cold, renewals, and hot leads up for grabs."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
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
