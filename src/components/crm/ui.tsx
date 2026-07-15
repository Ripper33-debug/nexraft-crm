import type { ReactNode, SelectHTMLAttributes, InputHTMLAttributes, TextareaHTMLAttributes } from "react";

import { stageInfo } from "../../lib/crm/constants";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

type BtnVariant = "primary" | "outline" | "ghost" | "danger";
const btnStyles: Record<BtnVariant, string> = {
  primary: "bg-signal text-ink hover:bg-signal-strong disabled:opacity-50",
  outline: "border border-line bg-surface-2 text-bone hover:border-line-strong hover:bg-surface disabled:opacity-50",
  ghost: "text-mute hover:bg-surface-2 hover:text-bone disabled:opacity-50",
  danger: "bg-red-500/90 text-white hover:bg-red-500 disabled:opacity-50",
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  children,
  ...props
}: {
  variant?: BtnVariant;
  size?: "sm" | "md";
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition-colors",
        size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3.5 py-2 text-sm",
        btnStyles[variant],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cx("rounded-xl border border-line bg-surface shadow-[0_1px_0_0_rgba(255,255,255,0.02)_inset]", className)}>
      {children}
    </div>
  );
}

// Uppercase mono label — the "technical / built like infrastructure" Nexraft feel.
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-faint", className)}>
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-bone">{title}</h1>
        {subtitle ? <p className="mt-0.5 text-sm text-mute">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

// KPI / summary tile, Monday-style board header stat.
export function SummaryCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <Eyebrow>{label}</Eyebrow>
      <div className={cx("mt-2 text-2xl font-semibold tracking-tight", accent ? "text-signal" : "text-bone")}>
        {value}
      </div>
      {sub ? <div className="mt-0.5 text-xs text-faint">{sub}</div> : null}
    </div>
  );
}

export function StageBadge({ stage }: { stage: string }) {
  const info = stageInfo(stage);
  return (
    <span
      className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold"
      style={{ backgroundColor: `${info.color}26`, color: info.color, boxShadow: `inset 0 0 0 1px ${info.color}33` }}
    >
      {stage}
    </span>
  );
}

type PillTone = "neutral" | "signal" | "warn" | "danger" | "ok";
const pillTones: Record<PillTone, string> = {
  neutral: "bg-surface-2 text-mute",
  signal: "bg-signal-soft text-signal",
  warn: "bg-amber-500/15 text-amber-400",
  danger: "bg-red-500/15 text-red-400",
  ok: "bg-emerald-500/15 text-emerald-400",
};

export function Pill({ tone = "neutral", children }: { tone?: PillTone; children: ReactNode }) {
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", pillTones[tone])}>
      {children}
    </span>
  );
}

// Deterministic teal-family avatar for owner attribution.
const AVATAR_COLORS = ["#2dd4bf", "#38bdf8", "#a855f7", "#f59e0b", "#f472b6", "#34d399", "#818cf8"];
function initials(name: string): string {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase() || "?";
}
function colorFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function Avatar({ name, size = 22 }: { name: string; size?: number }) {
  const c = colorFor(name || "?");
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-ink"
      style={{ width: size, height: size, backgroundColor: c, fontSize: Math.round(size * 0.42) }}
      title={name}
    >
      {initials(name || "?")}
    </span>
  );
}

// Owner chip used across every table so the whole team can see who owns a client.
export function OwnerChip({ name }: { name: string | null | undefined }) {
  if (!name) return <span className="text-faint">Unassigned</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Avatar name={name} size={20} />
      <span className="text-bone">{name}</span>
    </span>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-mute">{label}</span>
      {children}
    </label>
  );
}

const fieldCls =
  "w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-bone placeholder:text-faint outline-none transition-colors focus:border-signal/60 focus:ring-2 focus:ring-signal/15";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(fieldCls, props.className)} />;
}
export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(fieldCls, "min-h-20", props.className)} />;
}
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(fieldCls, "appearance-none", props.className)} />;
}

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm sm:p-8">
      <div
        className={cx(
          "w-full rounded-xl border border-line bg-surface shadow-2xl",
          wide ? "max-w-2xl" : "max-w-md",
        )}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h3 className="text-sm font-semibold text-bone">{title}</h3>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-faint hover:bg-surface-2 hover:text-bone"
            aria-label="Close"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-surface px-6 py-12 text-center">
      <p className="text-sm font-medium text-bone">{title}</p>
      {hint ? <p className="mt-1 text-xs text-mute">{hint}</p> : null}
    </div>
  );
}
