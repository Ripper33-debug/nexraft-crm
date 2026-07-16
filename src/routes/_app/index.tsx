import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";

import { getDashboard, getActivityFeed, type FeedRow } from "../../lib/crm/data";
import { Card, StageBadge, SummaryCard, Eyebrow, OwnerChip, Pill, Avatar } from "../../components/crm/ui";
import { StageBarChart, MonthlyTrendChart } from "../../components/crm/charts";
import { formatMoney, relativeTime, STALE_DAYS, daysBetween } from "../../lib/crm/constants";

export const Route = createFileRoute("/_app/")({
  loader: async () => {
    const [dash, feed] = await Promise.all([getDashboard(), getActivityFeed()]);
    return { ...dash, feed };
  },
  component: Dashboard,
});

// Tiny inline SVG sparkline — a filled area under a 30-point trend line. No
// axes, no library; just a quick "which way is this heading" cue on a KPI.
function Sparkline({ data, color = "#2dd4bf" }: { data: number[]; color?: string }) {
  const w = 120;
  const h = 32;
  const pad = 2;
  const max = Math.max(1, ...data);
  const n = data.length;
  const stepX = n > 1 ? (w - pad * 2) / (n - 1) : 0;
  const y = (v: number) => h - pad - (v / max) * (h - pad * 2);
  const pts = data.map((v, i) => `${pad + i * stepX},${y(v)}`);
  const line = pts.length ? `M${pts.join(" L")}` : "";
  const area = pts.length ? `${line} L${pad + (n - 1) * stepX},${h - pad} L${pad},${h - pad} Z` : "";
  const gid = `spark-${color.replace(/[^a-z0-9]/gi, "")}`;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible" aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {area ? <path d={area} fill={`url(#${gid})`} /> : null}
      {line ? <path d={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" /> : null}
    </svg>
  );
}

// A KPI-style card that pairs a headline number with a 30-day sparkline.
function TrendCard({
  label,
  value,
  sub,
  data,
  color,
}: {
  label: string;
  value: string;
  sub: string;
  data: number[];
  color?: string;
}) {
  return (
    <Card className="flex items-center justify-between gap-3 p-4">
      <div className="min-w-0">
        <Eyebrow>{label}</Eyebrow>
        <div className="tnum mt-2 text-[1.7rem] font-semibold leading-none tracking-tight text-bone">{value}</div>
        <div className="mt-1.5 text-xs text-faint">{sub}</div>
      </div>
      <div className="shrink-0">
        <Sparkline data={data} color={color} />
      </div>
    </Card>
  );
}

// A time-of-day greeting. Computed after mount so SSR and client agree.
function useGreeting(): string {
  const [greeting, setGreeting] = useState("Welcome back");
  useEffect(() => {
    const h = new Date().getHours();
    setGreeting(h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening");
  }, []);
  return greeting;
}

// Small colored dot per event kind for the team activity feed.
function feedDot(verb: string): string {
  if (verb === "won") return "#22c55e";
  if (verb === "lost") return "#ef4444";
  if (verb === "note_added") return "#2dd4bf";
  if (verb === "stage_changed") return "#38bdf8";
  if (verb === "completed") return "#a855f7";
  return "#8a978f";
}

function Dashboard() {
  const d = Route.useLoaderData();
  const { user } = Route.useRouteContext();
  const greeting = useGreeting();
  const winRate =
    d.kpi.won_count + d.kpi.lost_count > 0
      ? Math.round((d.kpi.won_count / (d.kpi.won_count + d.kpi.lost_count)) * 100)
      : null;

  const firstName = (user.name || "").split(" ")[0] || user.name;
  const created30 = d.dailyCreated.reduce((s, n) => s + n, 0);
  const won30 = d.dailyWon.reduce((s, n) => s + n, 0);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-bone">
            {greeting}, {firstName}
          </h1>
          <p className="mt-1 text-sm text-mute">Here's how your team's pipeline is tracking.</p>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <TrendCard
          label="Deals created — 30 days"
          value={String(created30)}
          sub={`${created30 === 1 ? "1 new deal" : `${created30} new deals`} added`}
          data={d.dailyCreated}
          color="#38bdf8"
        />
        <TrendCard
          label="Won revenue — 30 days"
          value={formatMoney(won30)}
          sub="Closed & launched"
          data={d.dailyWon}
          color="#22c55e"
        />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard label="Open pipeline" value={formatMoney(d.kpi.open_value)} sub={`${d.kpi.open_count} open deals`} accent />
        <SummaryCard label="Weighted forecast" value={formatMoney(d.weighted)} sub="Probability-adjusted" />
        <SummaryCard label="Won (all time)" value={formatMoney(d.kpi.won_value)} sub={`${d.kpi.won_count} launched`} />
        <SummaryCard label="Win rate" value={winRate === null ? "—" : `${winRate}%`} sub={`${d.kpi.lost_count} lost`} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard
          label="Recurring revenue"
          value={`${formatMoney(d.mrr)}/mo`}
          sub={`${d.retainer_count} active retainer${d.retainer_count === 1 ? "" : "s"}`}
          accent
        />
        <SummaryCard label="Annual recurring" value={formatMoney(d.mrr * 12)} sub="MRR × 12" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <Eyebrow className="mb-2">Pipeline value by stage</Eyebrow>
          <StageBarChart data={d.byStage.map((s) => ({ stage: s.stage, value: s.value, color: s.color }))} />
        </Card>
        <Card className="p-4">
          <Eyebrow className="mb-2">Won revenue — last 6 months</Eyebrow>
          <MonthlyTrendChart data={d.months.map((m) => ({ label: m.label, value: m.value }))} />
        </Card>
      </div>

      {/* Leaderboard */}
      <Card className="mt-4 overflow-hidden">
        <div className="border-b border-line px-4 py-3">
          <Eyebrow>Team leaderboard</Eyebrow>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                <th className="px-4 py-2 font-medium">Team member</th>
                <th className="px-4 py-2 font-medium">Open pipeline</th>
                <th className="px-4 py-2 font-medium">Open</th>
                <th className="px-4 py-2 font-medium">Won value</th>
                <th className="px-4 py-2 font-medium">Won</th>
                <th className="px-4 py-2 font-medium">Win rate</th>
              </tr>
            </thead>
            <tbody>
              {d.leaderboard.map((r) => (
                <tr key={r.id} className="border-b border-line/60 last:border-0 hover:bg-surface-2/60">
                  <td className="px-4 py-2.5"><OwnerChip name={r.name} /></td>
                  <td className="px-4 py-2.5 font-medium text-bone">{formatMoney(r.open_value)}</td>
                  <td className="px-4 py-2.5 text-mute">{r.open_count}</td>
                  <td className="px-4 py-2.5 text-mute">{formatMoney(r.won_value)}</td>
                  <td className="px-4 py-2.5 text-mute">{r.won_count}</td>
                  <td className="px-4 py-2.5 text-mute">{r.win_rate === null ? "—" : `${r.win_rate}%`}</td>
                </tr>
              ))}
              {d.leaderboard.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-sm text-faint">
                    No team members yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* Follow-ups */}
        <Card className="overflow-hidden">
          <div className="border-b border-line px-4 py-3">
            <Eyebrow>Follow-ups due</Eyebrow>
          </div>
          <ul className="divide-y divide-line/60">
            {d.followups.map((f: Record<string, unknown>) => (
              <li key={f.id as string} className="flex items-center justify-between px-4 py-2.5">
                <div className="min-w-0">
                  <div className="truncate text-sm text-bone">{f.subject as string}</div>
                  <div className="truncate text-xs text-faint">
                    {(f.type as string)}
                    {f.deal_name ? ` · ${f.deal_name as string}` : ""}
                    {f.owner_name ? ` · ${f.owner_name as string}` : ""}
                  </div>
                </div>
                <span className="ml-3 shrink-0">
                  <Pill tone={f.overdue ? "danger" : "neutral"}>
                    {f.due_date ? String(f.due_date).slice(0, 10) : "No date"}
                  </Pill>
                </span>
              </li>
            ))}
            {d.followups.length === 0 ? (
              <li className="px-4 py-6 text-center text-sm text-faint">Nothing due. Nice work.</li>
            ) : null}
          </ul>
        </Card>

        {/* Stale deals */}
        <Card className="overflow-hidden">
          <div className="border-b border-line px-4 py-3">
            <Eyebrow>Deals needing attention</Eyebrow>
          </div>
          <ul className="divide-y divide-line/60">
            {d.stale.map((s: Record<string, unknown>) => {
              const days = Number(s.days_in_stage) || 0;
              const stale = days >= STALE_DAYS;
              return (
                <li key={s.id as string} className="flex items-center justify-between px-4 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-sm text-bone">{s.name as string}</div>
                    <div className="truncate text-xs text-faint">
                      {formatMoney(Number(s.value))}
                      {s.owner_name ? ` · ${s.owner_name as string}` : ""}
                    </div>
                  </div>
                  <div className="ml-3 flex shrink-0 items-center gap-2">
                    <StageBadge stage={s.stage as string} />
                    <Pill tone={stale ? "warn" : "neutral"}>{days}d</Pill>
                  </div>
                </li>
              );
            })}
            {d.stale.length === 0 ? (
              <li className="px-4 py-6 text-center text-sm text-faint">No open deals yet.</li>
            ) : null}
          </ul>
        </Card>
      </div>

      {/* Renewals coming up */}
      {d.renewals.length > 0 ? (
        <Card className="mt-4 overflow-hidden">
          <div className="border-b border-line px-4 py-3">
            <Eyebrow>Renewals coming up</Eyebrow>
          </div>
          <ul className="divide-y divide-line/60">
            {d.renewals.map((r: Record<string, unknown>) => {
              const overdue = Number(r.overdue) === 1;
              const days = Math.abs(daysBetween(r.renewal_date as string));
              return (
                <li key={r.id as string} className="flex items-center justify-between px-4 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-sm text-bone">{r.name as string}</div>
                    <div className="truncate text-xs text-faint">
                      {r.company_name ? `${r.company_name as string} · ` : ""}
                      {Number(r.monthly_value) > 0 ? `${formatMoney(Number(r.monthly_value))}/mo` : ""}
                      {r.owner_name ? ` · ${r.owner_name as string}` : ""}
                    </div>
                  </div>
                  <div className="ml-3 flex shrink-0 items-center gap-2">
                    <Pill tone={overdue ? "danger" : "neutral"}>
                      {overdue ? `${days}d overdue` : `in ${days}d`}
                    </Pill>
                    <span className="text-[11px] text-faint">{String(r.renewal_date).slice(0, 10)}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      {/* Team activity feed */}
      <Card className="mt-4 overflow-hidden">
        <div className="border-b border-line px-4 py-3">
          <Eyebrow>Team activity</Eyebrow>
        </div>
        <ul className="divide-y divide-line/60">
          {(d.feed as FeedRow[]).map((e) => (
            <li key={e.id} className="flex items-center gap-3 px-4 py-2.5">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: feedDot(e.verb) }} />
              {e.actor_name ? <Avatar name={e.actor_name} size={22} /> : null}
              <div className="min-w-0 flex-1">
                <span className="text-sm text-mute">{e.summary}</span>
              </div>
              <span className="shrink-0 text-[11px] text-faint">{relativeTime(e.created_at)}</span>
            </li>
          ))}
          {(d.feed as FeedRow[]).length === 0 ? (
            <li className="px-4 py-6 text-center text-sm text-faint">
              No activity yet — it'll fill in as your team works deals.
            </li>
          ) : null}
        </ul>
      </Card>
    </div>
  );
}
