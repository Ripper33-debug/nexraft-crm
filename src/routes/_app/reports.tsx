import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

const RANGES = [
  { value: "all", label: "All time" },
  { value: "year", label: "Last 12 months" },
  { value: "quarter", label: "This quarter" },
  { value: "month", label: "This month" },
] as const;

type RangeValue = (typeof RANGES)[number]["value"];

import { getAnalytics, getExportBundle } from "../../lib/crm/data";
import {
  Card,
  Eyebrow,
  PageHeader,
  SummaryCard,
  Button,
  OwnerChip,
  EmptyState,
} from "../../components/crm/ui";
import { formatMoney } from "../../lib/crm/constants";
import { downloadCsv, stampedName } from "../../lib/crm/csv";

export const Route = createFileRoute("/_app/reports")({
  validateSearch: (search: Record<string, unknown>) => ({
    range: (["all", "month", "quarter", "year"].includes(search.range as string)
      ? (search.range as RangeValue)
      : "all") as RangeValue,
  }),
  loaderDeps: ({ search: { range } }) => ({ range }),
  loader: ({ deps: { range } }) => getAnalytics({ data: { range } }),
  component: ReportsPage,
});

function ReportsPage() {
  const a = Route.useLoaderData();
  const { range } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [exporting, setExporting] = useState(false);

  const rangeSub = RANGES.find((r) => r.value === range)?.label ?? "All time";

  async function exportAll() {
    setExporting(true);
    try {
      const bundle = await getExportBundle();
      // One CSV per object; staggered so browsers don't drop concurrent downloads.
      const files: [string, Record<string, string>[]][] = [
        ["nexraft_companies", bundle.companies],
        ["nexraft_contacts", bundle.contacts],
        ["nexraft_deals", bundle.deals],
        ["nexraft_activities", bundle.activities],
      ];
      files.forEach(([name, rows], i) => {
        if (rows.length === 0) return;
        setTimeout(() => downloadCsv(stampedName(name), rows), i * 350);
      });
    } finally {
      setExporting(false);
    }
  }

  const maxLost = Math.max(1, ...a.lost_reasons.map((r) => r.n));

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <PageHeader
        title="Reports"
        subtitle="Win/loss performance and a clean export for your Monday migration."
        actions={
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-line bg-surface p-0.5" role="group" aria-label="Time range">
              {RANGES.map((r) => (
                <button
                  key={r.value}
                  onClick={() => navigate({ search: { range: r.value }, replace: true })}
                  aria-pressed={range === r.value}
                  aria-label={`Show ${r.label}`}
                  className={
                    "rounded-md px-2.5 py-1 text-xs font-medium transition-colors " +
                    (range === r.value ? "bg-signal-soft text-signal" : "text-mute hover:text-bone")
                  }
                >
                  {r.label}
                </button>
              ))}
            </div>
            <Button variant="outline" onClick={exportAll} disabled={exporting}>
              {exporting ? "Preparing…" : "Export all (CSV)"}
            </Button>
          </div>
        }
      />

      {/* Win/loss KPIs */}
      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard
          label="Win rate"
          value={a.win_rate === null ? "—" : `${a.win_rate}%`}
          sub={`${a.won_count} won · ${a.lost_count} lost`}
          accent
        />
        <SummaryCard label="Won revenue" value={formatMoney(a.won_value)} sub={rangeSub} />
        <SummaryCard label="Avg deal size" value={formatMoney(a.avg_won_value)} sub="Won deals" />
        <SummaryCard
          label="Avg sales cycle"
          value={a.avg_cycle_days === null ? "—" : `${a.avg_cycle_days}d`}
          sub="Created → won"
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* Lost reasons */}
        <Card className="p-4">
          <Eyebrow className="mb-3">Why deals are lost</Eyebrow>
          {a.lost_reasons.length === 0 ? (
            <p className="py-6 text-center text-sm text-faint">No lost deals recorded yet.</p>
          ) : (
            <ul className="space-y-2.5">
              {a.lost_reasons.map((r) => (
                <li key={r.reason}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="text-mute">{r.reason}</span>
                    <span className="font-mono text-faint">
                      {r.n} · {formatMoney(r.value)}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                    <div
                      className="h-full rounded-full bg-red-500/70"
                      style={{ width: `${Math.round((r.n / maxLost) * 100)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Source conversion */}
        <Card className="p-4">
          <Eyebrow className="mb-3">Where your wins come from</Eyebrow>
          {a.sources.length === 0 ? (
            <p className="py-6 text-center text-sm text-faint">No decided deals yet.</p>
          ) : (
            <ul className="space-y-2.5">
              {a.sources.map((s) => (
                <li key={s.source}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="text-mute">{s.source}</span>
                    <span className="font-mono text-faint">
                      {s.win_rate === null ? "—" : `${s.win_rate}% win`} · {s.won}/{s.won + s.lost} · {formatMoney(s.won_value)}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                    <div
                      className="h-full rounded-full bg-signal/70"
                      style={{ width: `${s.win_rate ?? 0}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Export panel */}
      <Card className="mt-4 p-4">
        <Eyebrow className="mb-3">Export your data</Eyebrow>
        <p className="mb-3 text-sm text-mute">
          Download clean, denormalized CSVs — names resolved, no internal IDs — ready to import into
          Monday CRM or open in Excel.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={exportAll} disabled={exporting}>
            {exporting ? "Preparing…" : "Export all (CSV)"}
          </Button>
        </div>
        <p className="mt-3 text-xs text-faint">
          Companies, contacts, deals and activities each download as a separate CSV.
        </p>
      </Card>

      {/* Per-rep performance */}
      <Card className="mt-4 overflow-hidden">
        <div className="border-b border-line px-4 py-3">
          <Eyebrow>Rep performance</Eyebrow>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                <th className="px-4 py-2 font-medium">Team member</th>
                <th className="px-4 py-2 font-medium">Won</th>
                <th className="px-4 py-2 font-medium">Lost</th>
                <th className="px-4 py-2 font-medium">Win rate</th>
                <th className="px-4 py-2 font-medium">Won value</th>
                <th className="px-4 py-2 font-medium">Avg deal</th>
                <th className="px-4 py-2 font-medium">Avg cycle</th>
              </tr>
            </thead>
            <tbody>
              {a.reps.map((r) => (
                <tr key={r.id} className="border-b border-line/60 last:border-0 hover:bg-surface-2/60">
                  <td className="px-4 py-2.5">
                    <OwnerChip name={r.name} />
                  </td>
                  <td className="px-4 py-2.5 text-mute">{r.won_count}</td>
                  <td className="px-4 py-2.5 text-mute">{r.lost_count}</td>
                  <td className="px-4 py-2.5 text-bone">{r.win_rate === null ? "—" : `${r.win_rate}%`}</td>
                  <td className="px-4 py-2.5 text-mute">{formatMoney(r.won_value)}</td>
                  <td className="px-4 py-2.5 text-mute">{r.avg_deal ? formatMoney(r.avg_deal) : "—"}</td>
                  <td className="px-4 py-2.5 text-mute">{r.avg_cycle_days === null ? "—" : `${r.avg_cycle_days}d`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {a.reps.length === 0 ? (
          <div className="p-4">
            <EmptyState title="No reps yet" hint="Performance shows once deals are won or lost." />
          </div>
        ) : null}
      </Card>
    </div>
  );
}
