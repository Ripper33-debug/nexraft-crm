import { createFileRoute } from "@tanstack/react-router";

import { getDashboard } from "../../lib/crm/data";
import { Card, StageBadge } from "../../components/crm/ui";
import { StageBarChart, MonthlyTrendChart } from "../../components/crm/charts";
import { formatMoney, STALE_DAYS } from "../../lib/crm/constants";

export const Route = createFileRoute("/_app/")({
  loader: () => getDashboard(),
  component: Dashboard,
});

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-900">{value}</div>
      {sub ? <div className="mt-0.5 text-xs text-slate-400">{sub}</div> : null}
    </Card>
  );
}

function Dashboard() {
  const d = Route.useLoaderData();
  const winRate =
    d.kpi.won_count + d.kpi.lost_count > 0
      ? Math.round((d.kpi.won_count / (d.kpi.won_count + d.kpi.lost_count)) * 100)
      : null;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <h1 className="text-xl font-semibold text-slate-900">Dashboard</h1>
      <p className="text-sm text-slate-500">Your team's pipeline at a glance.</p>

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Open pipeline" value={formatMoney(d.kpi.open_value)} sub={`${d.kpi.open_count} open deals`} />
        <Kpi label="Weighted forecast" value={formatMoney(d.weighted)} sub="Probability-adjusted" />
        <Kpi label="Won (all time)" value={formatMoney(d.kpi.won_value)} sub={`${d.kpi.won_count} launched`} />
        <Kpi label="Win rate" value={winRate === null ? "—" : `${winRate}%`} sub={`${d.kpi.lost_count} lost`} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <div className="mb-2 text-sm font-semibold text-slate-800">Pipeline value by stage</div>
          <StageBarChart data={d.byStage.map((s) => ({ stage: s.stage, value: s.value, color: s.color }))} />
        </Card>
        <Card className="p-4">
          <div className="mb-2 text-sm font-semibold text-slate-800">Won revenue — last 6 months</div>
          <MonthlyTrendChart data={d.months.map((m) => ({ label: m.label, value: m.value }))} />
        </Card>
      </div>

      {/* Leaderboard */}
      <Card className="mt-4 overflow-hidden">
        <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-800">
          Team leaderboard
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500">
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
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="px-4 py-2 font-medium text-slate-800">{r.name}</td>
                  <td className="px-4 py-2 text-slate-600">{formatMoney(r.open_value)}</td>
                  <td className="px-4 py-2 text-slate-600">{r.open_count}</td>
                  <td className="px-4 py-2 text-slate-600">{formatMoney(r.won_value)}</td>
                  <td className="px-4 py-2 text-slate-600">{r.won_count}</td>
                  <td className="px-4 py-2 text-slate-600">{r.win_rate === null ? "—" : `${r.win_rate}%`}</td>
                </tr>
              ))}
              {d.leaderboard.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-sm text-slate-400">
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
          <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-800">
            Follow-ups due
          </div>
          <ul className="divide-y divide-slate-100">
            {d.followups.map((f: Record<string, unknown>) => (
              <li key={f.id as string} className="flex items-center justify-between px-4 py-2.5">
                <div className="min-w-0">
                  <div className="truncate text-sm text-slate-800">{f.subject as string}</div>
                  <div className="truncate text-xs text-slate-400">
                    {(f.type as string)}
                    {f.deal_name ? ` · ${f.deal_name as string}` : ""}
                    {f.owner_name ? ` · ${f.owner_name as string}` : ""}
                  </div>
                </div>
                <span
                  className={
                    "ml-3 shrink-0 rounded-full px-2 py-0.5 text-xs font-medium " +
                    (f.overdue ? "bg-red-50 text-red-600" : "bg-slate-100 text-slate-500")
                  }
                >
                  {f.due_date ? String(f.due_date).slice(0, 10) : "No date"}
                </span>
              </li>
            ))}
            {d.followups.length === 0 ? (
              <li className="px-4 py-6 text-center text-sm text-slate-400">Nothing due. Nice work.</li>
            ) : null}
          </ul>
        </Card>

        {/* Stale deals */}
        <Card className="overflow-hidden">
          <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-800">
            Deals needing attention
          </div>
          <ul className="divide-y divide-slate-100">
            {d.stale.map((s: Record<string, unknown>) => {
              const days = Number(s.days_in_stage) || 0;
              const stale = days >= STALE_DAYS;
              return (
                <li key={s.id as string} className="flex items-center justify-between px-4 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-sm text-slate-800">{s.name as string}</div>
                    <div className="truncate text-xs text-slate-400">
                      {formatMoney(Number(s.value))}
                      {s.owner_name ? ` · ${s.owner_name as string}` : ""}
                    </div>
                  </div>
                  <div className="ml-3 flex shrink-0 items-center gap-2">
                    <StageBadge stage={s.stage as string} />
                    <span
                      className={
                        "rounded-full px-2 py-0.5 text-xs font-medium " +
                        (stale ? "bg-amber-50 text-amber-600" : "bg-slate-100 text-slate-500")
                      }
                    >
                      {days}d
                    </span>
                  </div>
                </li>
              );
            })}
            {d.stale.length === 0 ? (
              <li className="px-4 py-6 text-center text-sm text-slate-400">No open deals yet.</li>
            ) : null}
          </ul>
        </Card>
      </div>
    </div>
  );
}
