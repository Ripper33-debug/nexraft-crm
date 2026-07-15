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
  return <div className="h-56 w-full animate-pulse rounded-lg bg-surface-2" />;
}

const AXIS_TICK = { fontSize: 11, fill: "#8a978f" } as const;
const TOOLTIP_STYLE = {
  backgroundColor: "#0f1512",
  border: "1px solid #222c26",
  borderRadius: 8,
  color: "#e8ede9",
  fontSize: 12,
} as const;

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
        <XAxis dataKey="stage" tick={AXIS_TICK} interval={0} angle={-15} textAnchor="end" height={50} axisLine={{ stroke: "#222c26" }} tickLine={false} />
        <YAxis tickFormatter={(v) => `$${v >= 1000 ? `${Math.round(v / 1000)}k` : v}`} tick={AXIS_TICK} width={44} axisLine={false} tickLine={false} />
        <Tooltip formatter={(v: number) => formatMoney(v)} cursor={{ fill: "rgba(255,255,255,0.04)" }} contentStyle={TOOLTIP_STYLE} labelStyle={{ color: "#8a978f" }} />
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
        <XAxis dataKey="label" tick={AXIS_TICK} axisLine={{ stroke: "#222c26" }} tickLine={false} />
        <YAxis tickFormatter={(v) => `$${v >= 1000 ? `${Math.round(v / 1000)}k` : v}`} tick={AXIS_TICK} width={44} axisLine={false} tickLine={false} />
        <Tooltip formatter={(v: number) => formatMoney(v)} cursor={{ fill: "rgba(255,255,255,0.04)" }} contentStyle={TOOLTIP_STYLE} labelStyle={{ color: "#8a978f" }} />
        <Bar dataKey="value" fill="#2dd4bf" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
