import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

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
  loader: () => getAnalytics(),
  component: ReportsPage,
});

function ReportsPage() {
  const a = Route.useLoaderData();
  const [exporting, setExporting] = useState(false);

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
          <Button variant="outline" onClick={exportAll} disabled={exporting}>
            {exporting ? "Preparing…" : "Export all (CSV)"}
          </Button>
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
        <SummaryCard label="Won revenue" value={formatMoney(a.won_value)} sub="All time" />
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

        {/* Export panel */}
        <Card className="p-4">
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
      </div>

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
