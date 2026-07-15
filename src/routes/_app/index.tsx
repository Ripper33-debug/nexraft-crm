import { createFileRoute } from "@tanstack/react-router";

import { getDashboard } from "../../lib/crm/data";
import { Card, StageBadge, SummaryCard, PageHeader, Eyebrow, OwnerChip, Pill } from "../../components/crm/ui";
import { StageBarChart, MonthlyTrendChart } from "../../components/crm/charts";
import { formatMoney, STALE_DAYS } from "../../lib/crm/constants";

export const Route = createFileRoute("/_app/")({
  loader: () => getDashboard(),
  component: Dashboard,
});

function Dashboard() {
  const d = Route.useLoaderData();
  const winRate =
    d.kpi.won_count + d.kpi.lost_count > 0
      ? Math.round((d.kpi.won_count / (d.kpi.won_count + d.kpi.lost_count)) * 100)
      : null;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <PageHeader title="Dashboard" subtitle="Your team's pipeline at a glance." />

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard label="Open pipeline" value={formatMoney(d.kpi.open_value)} sub={`${d.kpi.open_count} open deals`} accent />
        <SummaryCard label="Weighted forecast" value={formatMoney(d.weighted)} sub="Probability-adjusted" />
        <SummaryCard label="Won (all time)" value={formatMoney(d.kpi.won_value)} sub={`${d.kpi.won_count} launched`} />
        <SummaryCard label="Win rate" value={winRate === null ? "—" : `${winRate}%`} sub={`${d.kpi.lost_count} lost`} />
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
    </div>
  );
}
