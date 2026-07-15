import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatMoney } from "../../lib/crm/constants";

// Charts render client-side only to stay SSR-safe and avoid hydration mismatch.
function useMounted() {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}

function Skeleton() {
  return <div className="h-56 w-full animate-pulse rounded-lg bg-slate-100" />;
}

export function StageBarChart({
  data,
}: {
  data: { stage: string; value: number; color: string }[];
}) {
  const mounted = useMounted();
  if (!mounted) return <Skeleton />;
  return (
    <ResponsiveContainer width="100%" height={224}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
        <XAxis dataKey="stage" tick={{ fontSize: 11, fill: "#64748b" }} interval={0} angle={-15} textAnchor="end" height={50} />
        <YAxis tickFormatter={(v) => `$${v >= 1000 ? `${Math.round(v / 1000)}k` : v}`} tick={{ fontSize: 11, fill: "#64748b" }} width={44} />
        <Tooltip formatter={(v: number) => formatMoney(v)} cursor={{ fill: "#f1f5f9" }} />
        <Bar dataKey="value" radius={[4, 4, 0, 0]}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function MonthlyTrendChart({
  data,
}: {
  data: { label: string; value: number }[];
}) {
  const mounted = useMounted();
  if (!mounted) return <Skeleton />;
  return (
    <ResponsiveContainer width="100%" height={224}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#64748b" }} />
        <YAxis tickFormatter={(v) => `$${v >= 1000 ? `${Math.round(v / 1000)}k` : v}`} tick={{ fontSize: 11, fill: "#64748b" }} width={44} />
        <Tooltip formatter={(v: number) => formatMoney(v)} cursor={{ fill: "#f1f5f9" }} />
        <Bar dataKey="value" fill="#22c55e" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
