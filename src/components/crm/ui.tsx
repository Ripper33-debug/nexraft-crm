import { useEffect, useState } from "react";
import type { ReactNode, SelectHTMLAttributes, InputHTMLAttributes, TextareaHTMLAttributes } from "react";

import { stageInfo, emailHistory } from "../../lib/crm/constants";

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
  // Flat, product-grade controls: solid fill, subtle shadow, quiet press.
  // No gradients or glows — reads as enterprise software.
  primary:
    "bg-signal text-white hover:bg-signal-strong active:translate-y-px disabled:opacity-50 disabled:active:translate-y-0",
  outline:
    "border border-line bg-surface text-bone hover:bg-surface-2 active:translate-y-px disabled:opacity-50",
  ghost: "text-mute hover:bg-surface-2 hover:text-bone disabled:opacity-50",
  danger:
    "bg-red-500 text-white hover:bg-red-600 active:translate-y-px disabled:opacity-50",
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
        // Clean controls: soft-rounded, sentence case, quiet press.
        // Buttons read as product infrastructure, not marketing speak.
        "inline-flex items-center justify-center gap-2 rounded-md font-medium tracking-[0.01em] transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/40 focus-visible:ring-offset-2 focus-visible:ring-offset-ink",
        size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm",
        btnStyles[variant],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function Card({
  className,
  children,
  tilt,
}: {
  className?: string;
  children: ReactNode;
  /** Opt-in 3D: the card tips toward the cursor. Use on compact grid cards
      (projects board), not big page-width panels where tilt feels seasick. */
  tilt?: boolean;
}) {
  return (
    <div
      className={cx(
        "transition-[border-color,box-shadow] duration-300",
        "rounded-md border border-line bg-surface shadow-sm hover:border-line-strong",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("text-xs font-medium text-mute", className)}>
      {children}
    </div>
  );
}

// A tiny "?" affordance that reveals a plain-English explanation on hover.
// Uses the native title tooltip so it works even inside clipped/overflow cards.
export function InfoDot({ text, className }: { text: string; className?: string }) {
  return (
    <span
      title={text}
      aria-label={text}
      role="img"
      className={cx(
        "ml-1 inline-flex h-3.5 w-3.5 cursor-help select-none items-center justify-center rounded-full border border-line-strong text-[9px] font-bold leading-none text-faint transition-colors hover:border-signal hover:text-signal",
        className,
      )}
    >
      ?
    </span>
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
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-medium tracking-tight md:text-3xl text-bone">
            {title}
          </h1>
          {subtitle ? <p className="mt-1 text-sm text-mute">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

// KPI / summary tile, Monday-style board header stat.
export function SummaryCard({
  label,
  value,
  sub,
  accent,
  hint,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
  hint?: string;
}) {
  return (
    <div
      className={cx(
        "relative overflow-hidden rounded-md border p-4 transition-[border-color,box-shadow] duration-300",
        accent
          ? // Accent variant: clean white emphasized card with subtle shadow.
            "border-line bg-surface shadow-sm hover:shadow-md"
          : "border-line bg-surface shadow-sm hover:border-line-strong",
      )}
    >
      <Eyebrow className="flex items-center">
        {label}
        {hint ? <InfoDot text={hint} /> : null}
      </Eyebrow>
      <div
        className={cx(
          "tnum mt-2 font-display text-[1.6rem] font-semibold leading-none tracking-tight",
          "text-bone",
        )}
      >
        <CountUp value={value} />
      </div>
      {sub ? <div className="mt-1.5 text-xs text-mute">{sub}</div> : null}
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
  warn: "bg-amber-500/15 text-amber-600",
  danger: "bg-red-500/15 text-red-600",
  ok: "bg-emerald-500/15 text-emerald-600",
};

export function Pill({ tone = "neutral", children }: { tone?: PillTone; children: ReactNode }) {
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", pillTones[tone])}>
      {children}
    </span>
  );
}

// "3× emailed · last 4d ago" — the same badge on every screen where somebody
// might be about to write to this company. Renders nothing when we've never
// emailed them, which is most rows: a badge on everything is wallpaper.
//
// Amber once the three-touch sequence is spent or the last email is still
// warm; quiet grey otherwise, because "emailed them in March" is context, not
// a warning. It never blocks a send — the point is that you know before you
// click, not that the CRM decides for you.
export function EmailedBadge({
  company,
  className,
}: {
  company: { email_touches?: number | null; last_emailed_at?: string | null } | null | undefined;
  className?: string;
}) {
  const h = emailHistory(company);
  if (!h) return null;
  const loud = h.exhausted || h.recent;
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium align-middle",
        loud ? "bg-amber-500/15 text-amber-700" : "bg-surface-2 text-faint",
        className,
      )}
      title={
        h.advice ||
        `We've emailed this company ${h.touches} time${h.touches === 1 ? "" : "s"}. Worth a look at the thread before you write another.`
      }
    >
      ✉ {h.label}
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
  "w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-bone placeholder:text-faint outline-none shadow-[inset_0_1px_2px_rgba(0,0,0,0.08)] transition-all duration-150 hover:border-line-strong focus:border-signal/70 focus:ring-2 focus:ring-signal/20";

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
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/35 p-4 backdrop-blur-md duration-200 animate-in fade-in-0 sm:p-8"
    >
      <div
        className={cx(
          "mt-4 w-full rounded-2xl border border-line-strong bg-surface shadow-[0_24px_70px_-20px_rgba(0,0,0,0.18)] ring-1 ring-black/5 duration-200 animate-in fade-in-0 zoom-in-95 slide-in-from-top-2 sm:mt-8",
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

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-surface px-6 py-12 text-center">
      <p className="text-sm font-medium text-bone">{title}</p>
      {hint ? <p className="mx-auto mt-1 max-w-sm text-xs text-mute">{hint}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

// ---------- Loading skeletons ----------
// A single pulsing placeholder block. The subtle shimmer says "content is on the
// way" so a slow navigation reads as loading rather than frozen.
export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded-md bg-surface-2", className)} aria-hidden="true" />;
}

// Placeholder shaped like a SummaryCard, so KPI rows reserve their space and
// don't jump when the real numbers land.
export function SummaryCardSkeleton() {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <Skeleton className="h-2.5 w-20" />
      <Skeleton className="mt-3 h-7 w-24" />
      <Skeleton className="mt-2.5 h-2.5 w-16" />
    </div>
  );
}

// Whole-page loading state used as a route pendingComponent: a header block, a
// row of KPI cards, and a few list rows. Matches the real layout closely enough
// that the swap to live content is calm, not a flash.
export function PageSkeleton({ cards = 4, rows = 6 }: { cards?: number; rows?: number }) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="flex items-end justify-between gap-3">
        <div>
          <Skeleton className="h-6 w-40" />
          <Skeleton className="mt-2 h-3 w-64" />
        </div>
        <Skeleton className="h-9 w-28 rounded-lg" />
      </div>
      {cards > 0 ? (
        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: cards }).map((_, i) => (
            <SummaryCardSkeleton key={i} />
          ))}
        </div>
      ) : null}
      <div className="mt-4 rounded-xl border border-line bg-surface p-4">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 border-b border-line/60 py-3 last:border-0">
            <Skeleton className="h-9 w-9 rounded-full" />
            <div className="flex-1">
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="mt-2 h-2.5 w-1/4" />
            </div>
            <Skeleton className="h-3 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}
