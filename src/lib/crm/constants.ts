// Pure constants shared by client and server. No server-only imports here.

export type StageInfo = {
  name: string;
  prob: number; // win probability as a fraction
  kind: "open" | "won" | "lost";
  color: string; // hex for charts / badges
};

// Pipeline tuned for a web-design studio (Nexraft builds websites).
export const STAGES: StageInfo[] = [
  { name: "Lead", prob: 0.1, kind: "open", color: "#94a3b8" },
  { name: "Discovery", prob: 0.25, kind: "open", color: "#38bdf8" },
  { name: "Proposal", prob: 0.5, kind: "open", color: "#6366f1" },
  { name: "Negotiation", prob: 0.7, kind: "open", color: "#a855f7" },
  { name: "In Build", prob: 0.9, kind: "open", color: "#f59e0b" },
  { name: "Launched", prob: 1.0, kind: "won", color: "#22c55e" },
  { name: "Lost", prob: 0.0, kind: "lost", color: "#ef4444" },
];

export const STAGE_NAMES = STAGES.map((s) => s.name);
export const OPEN_STAGES = STAGES.filter((s) => s.kind === "open").map((s) => s.name);

export function stageInfo(name: string): StageInfo {
  return STAGES.find((s) => s.name === name) ?? STAGES[0];
}

export const ACTIVITY_TYPES = ["Call", "Email", "Meeting", "Task", "Note"];
export const LEAD_SOURCES = ["Referral", "Website", "Cold Outreach", "Event", "Social", "Other"];

// Proposal lifecycle on a deal — light-touch tracking for a web studio.
export type ProposalInfo = { value: string; label: string; color: string };
export const PROPOSAL_STATUSES: ProposalInfo[] = [
  { value: "none", label: "No proposal", color: "#64748b" },
  { value: "sent", label: "Sent", color: "#38bdf8" },
  { value: "viewed", label: "Viewed", color: "#a855f7" },
  { value: "signed", label: "Signed", color: "#22c55e" },
];
export function proposalInfo(value: string | null | undefined): ProposalInfo {
  return PROPOSAL_STATUSES.find((p) => p.value === value) ?? PROPOSAL_STATUSES[0];
}

// ---------- Pricing packages (internal) ----------
// The three standard Nexraft offers. Every deal is sold as a one-time build plus
// a required managed monthly plan (minimum 12-month term). "Business" is the
// default recommendation. These power the package picker shown when a rep marks
// a company as Signed. Values are the studio's internal starting prices — say
// "starts at" until scope is confirmed.
export type PricingPackage = {
  id: "starter" | "business" | "pro";
  name: string;
  build: number; // one-time build fee
  monthly: number; // required monthly managed plan
  firstYear: number; // build + 12 months, for a quick "first-year value" read
  pages: string; // rough page count guidance
  blurb: string; // one-line best-fit
  recommended?: boolean;
  startsAt?: boolean; // Pro is "starts at" (scope-dependent)
};

export const PRICING_PACKAGES: PricingPackage[] = [
  {
    id: "starter",
    name: "Starter",
    build: 1500,
    monthly: 299,
    firstYear: 5088,
    pages: "Up to 5 pages",
    blurb: "Simple, single-location local business.",
  },
  {
    id: "business",
    name: "Business",
    build: 2500,
    monthly: 399,
    firstYear: 7288,
    pages: "Up to 10 pages",
    blurb: "Established business that needs room to grow.",
    recommended: true,
  },
  {
    id: "pro",
    name: "Pro",
    build: 4000,
    monthly: 599,
    firstYear: 11188,
    pages: "Up to 15 pages",
    blurb: "Premium or complex build with more moving parts.",
    startsAt: true,
  },
];

export function pricingPackage(id: string | null | undefined): PricingPackage | undefined {
  return PRICING_PACKAGES.find((p) => p.id === id);
}

// ---------- Sales payroll / commission ----------
// Reps earn a cut of the monthly retainer on every signed deal, paid over the
// first year, plus a flat bonus the first month they sign a batch of deals.
export const COMMISSION_RATE = 0.3; // 30% of the monthly retainer
export const COMMISSION_MONTHS = 12; // ...for the first 12 months of the deal
export const SALES_BONUS_AMOUNT = 1500; // flat bonus...
export const SALES_BONUS_THRESHOLD = 5; // ...for signing this many in one month
export const SALES_BONUS_ONE_TIME = true; // only the first qualifying month counts

export type PayCadence = "monthly" | "biweekly";
export const PAY_CADENCES: { id: PayCadence; label: string; perYear: number }[] = [
  { id: "monthly", label: "Monthly", perYear: 12 },
  { id: "biweekly", label: "Bi-weekly", perYear: 26 },
];
export function payCadenceLabel(id: string | null | undefined): string {
  return PAY_CADENCES.find((c) => c.id === id)?.label ?? "Monthly";
}

// Whole calendar months between a signed date and `to` (0 on the signing day).
export function monthsElapsed(iso: string | null | undefined, to = new Date()): number {
  if (!iso) return 0;
  const d = new Date(iso.replace(" ", "T") + (iso.includes("T") ? "" : "Z"));
  if (isNaN(d.getTime())) return 0;
  let months = (to.getFullYear() - d.getFullYear()) * 12 + (to.getMonth() - d.getMonth());
  if (to.getDate() < d.getDate()) months -= 1;
  return Math.max(0, months);
}

// Commission a single signed retainer has earned so far. A rep starts earning the
// month they sign (month 1), accruing 30% of the monthly value each month up to
// 12 months. One-off builds (no monthly) earn nothing here.
export function dealCommission(
  monthly: number,
  signedIso: string | null | undefined,
  to = new Date(),
): { earnedMonths: number; earned: number; lifetime: number } {
  const m = Number(monthly) || 0;
  if (m <= 0) return { earnedMonths: 0, earned: 0, lifetime: 0 };
  const lifetime = m * COMMISSION_RATE * COMMISSION_MONTHS;
  const earnedMonths = Math.min(COMMISSION_MONTHS, Math.max(1, monthsElapsed(signedIso, to) + 1));
  return { earnedMonths, earned: m * COMMISSION_RATE * earnedMonths, lifetime };
}

// Given the count of a rep's signed deals per calendar month (e.g. {"2026-07": 6}),
// decide whether the one-time 5-in-a-month bonus has been earned, and when.
export function salesBonus(perMonthCounts: Record<string, number>): {
  earned: number;
  month: string | null;
} {
  const months = Object.keys(perMonthCounts).sort(); // chronological
  for (const mo of months) {
    if (perMonthCounts[mo] >= SALES_BONUS_THRESHOLD) {
      return { earned: SALES_BONUS_AMOUNT, month: mo };
    }
  }
  return { earned: 0, month: null };
}

// Preset, colored company tags (Monday-style labels). Fixed set keeps the whole
// team consistent instead of a sprawl of freeform tags.
export type TagInfo = { name: string; color: string };
export const COMPANY_TAGS: TagInfo[] = [
  { name: "Retainer", color: "#2dd4bf" },
  { name: "One-off", color: "#38bdf8" },
  { name: "Referral", color: "#a855f7" },
  { name: "VIP", color: "#f59e0b" },
  { name: "Warm", color: "#f472b6" },
  { name: "Cold", color: "#64748b" },
  { name: "At risk", color: "#ef4444" },
  { name: "Upsell", color: "#22c55e" },
];

export function tagColor(name: string): string {
  return COMPANY_TAGS.find((t) => t.name === name)?.color ?? "#8a978f";
}

// Tags persist as a comma-separated string; these helpers convert to/from an array.
export function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}
export function serializeTags(tags: string[]): string {
  return tags.filter(Boolean).join(",");
}

// Structured reasons for a lost deal so win/loss analytics can group them.
export const LOST_REASONS = [
  "Price / budget",
  "Went with competitor",
  "Timing / not ready",
  "No response / went dark",
  "Scope mismatch",
  "Lost to in-house",
  "Other",
];

// Structured reasons for a won deal so win/loss analytics can group them.
export const WIN_REASONS = [
  "Best price / value",
  "Strong portfolio / fit",
  "Referral / trust",
  "Fast turnaround",
  "Existing relationship",
  "Other",
];

// A deal in an open stage untouched for this many days is "stale".
export const STALE_DAYS = 14;

// A renewal within this many days counts as "coming up" on the dashboard.
export const RENEWAL_SOON_DAYS = 60;

// Labelled links attached to a deal (Figma, proposal, staging URL, contract…).
export type DealLink = { label: string; url: string };

export function parseLinks(raw: string | null | undefined): DealLink[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x) => x && typeof x.url === "string" && x.url.trim())
      .map((x) => ({ label: String(x.label ?? "").trim(), url: String(x.url).trim() }));
  } catch {
    return [];
  }
}

export function serializeLinks(links: DealLink[]): string | null {
  const clean = links.filter((l) => l.url.trim());
  return clean.length ? JSON.stringify(clean) : null;
}

// Prefix a bare domain with https:// so links open correctly.
export function normalizeUrl(url: string): string {
  const u = url.trim();
  if (!u) return u;
  return /^https?:\/\//i.test(u) ? u : `https://${u}`;
}

export function formatMoney(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n || 0);
}

export function daysBetween(iso: string | null | undefined, to = new Date()): number {
  if (!iso) return 0;
  const d = new Date(iso.replace(" ", "T") + (iso.includes("T") ? "" : "Z"));
  if (isNaN(d.getTime())) return 0;
  return Math.floor((to.getTime() - d.getTime()) / 86400000);
}

// Compact "2m / 4h / 3d / Jun 12" style timestamp for feeds and note threads.
export function relativeTime(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return "";
  const d = new Date(iso.replace(" ", "T") + (iso.includes("T") ? "" : "Z"));
  if (isNaN(d.getTime())) return "";
  const sec = Math.floor((now.getTime() - d.getTime()) / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ---------- Record-level access (ownership + sharing) ----------
// Minimal "actor" shape the permission check needs.
export type Actor = { id: string; role: string } | null | undefined;

// Parse a comma-separated shared_with column into a list of user ids.
export function parseSharedIds(shared: string | null | undefined): string[] {
  return (shared ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// Can this user edit a record? Admins always can; the owner always can; anyone
// explicitly shared can; an unowned record is open to all. Everyone else is
// locked out. This is the single source of truth, mirrored on the server.
export function canEditRecord(
  user: Actor,
  ownerId: string | null | undefined,
  sharedWith: string | null | undefined,
): boolean {
  if (!user) return false;
  if (user.role === "admin") return true;
  if (!ownerId) return true;
  if (ownerId === user.id) return true;
  return parseSharedIds(sharedWith).includes(user.id);
}

// Only the owner (or an admin) may hand a record off or change who it's shared with.
export function canAdministerRecord(user: Actor, ownerId: string | null | undefined): boolean {
  if (!user) return false;
  if (user.role === "admin") return true;
  if (!ownerId) return true;
  return ownerId === user.id;
}
