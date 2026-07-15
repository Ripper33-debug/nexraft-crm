import { useEffect, useState } from "react";
import type { ReactNode, SelectHTMLAttributes, InputHTMLAttributes, TextareaHTMLAttributes } from "react";

import { stageInfo } from "../../lib/crm/constants";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

// Animates the numeric part of a preformatted string (e.g. "$12,400", "42%",
// "18d") from zero on mount. Renders the final value on the server so hydration
// matches, then eases up to it once mounted — no layout shift, no flicker.
function CountUp({ value }: { value: string }) {
  const [display, setDisplay] = useState(value);
  useEffect(() => {
    const match = value.match(/-?[\d,]*\.?\d+/);
    if (!match) {
      setDisplay(value);
      return;
    }
    const raw = match[0];
    const target = parseFloat(raw.replace(/,/g, ""));
    if (!isFinite(target)) {
      setDisplay(value);
      return;
    }
    const decimals = raw.includes(".") ? raw.split(".")[1]?.length ?? 0 : 0;
    const grouped = raw.includes(",");
    const start = match.index ?? 0;
    const before = value.slice(0, start);
    const after = value.slice(start + raw.length);
    const fmt = (n: number) => {
      const s = grouped
        ? n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
        : n.toFixed(decimals);
      return before + s + after;
    };
    let raf = 0;
    const dur = 650;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      if (p < 1) {
        setDisplay(fmt(target * eased));
        raf = requestAnimationFrame(tick);
      } else {
        setDisplay(value);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{display}</>;
}

type BtnVariant = "primary" | "outline" | "ghost" | "danger";
const btnStyles: Record<BtnVariant, string> = {
  // Tactile gradient fill with a top highlight, teal glow on hover, and a
  // subtle press — reads like a physical control, not a flat rectangle.
  primary:
    "bg-gradient-to-b from-[#3ce0cd] to-signal-strong text-ink shadow-[0_1px_2px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.3)] hover:shadow-[0_2px_14px_rgba(20,184,166,0.4),inset_0_1px_0_rgba(255,255,255,0.3)] active:translate-y-px disabled:opacity-50 disabled:shadow-none disabled:active:translate-y-0",
  outline:
    "border border-line-strong bg-gradient-to-b from-surface-2 to-surface text-bone shadow-[0_1px_2px_rgba(0,0,0,0.25)] hover:border-signal/40 hover:text-bone active:translate-y-px disabled:opacity-50",
  ghost: "text-mute hover:bg-surface-2 hover:text-bone disabled:opacity-50",
  danger:
    "bg-gradient-to-b from-red-500 to-red-600 text-white shadow-[0_1px_2px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.2)] hover:shadow-[0_2px_14px_rgba(239,68,68,0.4)] active:translate-y-px disabled:opacity-50",
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
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/40 focus-visible:ring-offset-2 focus-visible:ring-offset-ink",
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
    <div
      className={cx(
        "rounded-xl border border-line bg-gradient-to-b from-surface to-[#0c110e] shadow-[0_1px_2px_rgba(0,0,0,0.3),0_8px_24px_-16px_rgba(0,0,0,0.6),inset_0_1px_0_0_rgba(255,255,255,0.03)]",
        className,
      )}
    >
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
        <h1 className="text-[1.35rem] font-semibold tracking-tight text-bone">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-mute">{subtitle}</p> : null}
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
    <div
      className={cx(
        "group relative overflow-hidden rounded-xl border p-4 transition-all duration-200 hover:-translate-y-0.5",
        accent
          ? "border-signal/25 bg-gradient-to-br from-signal-soft/50 via-surface to-surface shadow-[0_8px_30px_-18px_rgba(20,184,166,0.6)] hover:shadow-[0_14px_36px_-16px_rgba(20,184,166,0.7)]"
          : "border-line bg-gradient-to-b from-surface to-[#0c110e] shadow-[0_1px_2px_rgba(0,0,0,0.3)] hover:border-line-strong hover:shadow-[0_12px_30px_-16px_rgba(0,0,0,0.7)]",
      )}
    >
      {accent ? (
        <div className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full bg-signal/20 blur-2xl" />
      ) : null}
      <Eyebrow>{label}</Eyebrow>
      <div
        className={cx(
          "tnum mt-2 text-[1.7rem] font-semibold leading-none tracking-tight",
          accent ? "text-signal" : "text-bone",
        )}
      >
        <CountUp value={value} />
      </div>
      {sub ? <div className="mt-1.5 text-xs text-faint">{sub}</div> : null}
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
  "w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-bone placeholder:text-faint outline-none shadow-[inset_0_1px_2px_rgba(0,0,0,0.25)] transition-all duration-150 hover:border-line-strong focus:border-signal/70 focus:ring-2 focus:ring-signal/20";

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
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-md duration-200 animate-in fade-in-0 sm:p-8"
    >
      <div
        className={cx(
          "mt-4 w-full rounded-2xl border border-line-strong bg-gradient-to-b from-surface to-[#0c110e] shadow-[0_24px_70px_-20px_rgba(0,0,0,0.85)] ring-1 ring-white/5 duration-200 animate-in fade-in-0 zoom-in-95 slide-in-from-top-2 sm:mt-8",
          wide ? "max-w-2xl" : "max-w-md",
        )}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h3 className="text-sm font-semibold tracking-tight text-bone">{title}</h3>
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
