// Pure constants shared by client and server. No server-only imports here.

export type StageInfo = {
  name: string;
  prob: number; // win probability as a fraction
  kind: "open" | "won" | "lost";
  color: string; // hex for charts / badges
};

// Pipeline tuned for a web-design studio (Nexraft builds websites).
// "To Call" is the entry stage: every new company lands here automatically so
// reps have a ready-to-work queue and nothing slips through the cracks.
export const STAGES: StageInfo[] = [
  { name: "To Call", prob: 0.05, kind: "open", color: "#94a3b8" },
  { name: "Lead", prob: 0.1, kind: "open", color: "#64748b" },
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

// ---------- Open-pipeline estimate range ----------
// Most companies enter the pipeline before their scope (and therefore price) is
// known — they sit in "To Call" with a $0 deal. Rather than show those as $0, we
// estimate what they *could* be worth using the studio's price band: a low-end
// Starter build/retainer through a high-end Pro build/retainer. This gives Barry
// a realistic "if these all closed" range instead of an undercount.
const STARTER = PRICING_PACKAGES.find((p) => p.id === "starter")!;
const PRO = PRICING_PACKAGES.find((p) => p.id === "pro")!;

export const ESTIMATE_LOW_BUILD = STARTER.build; // 1500
export const ESTIMATE_HIGH_BUILD = PRO.build; // 4000
export const ESTIMATE_LOW_MONTHLY = STARTER.monthly; // 299
export const ESTIMATE_HIGH_MONTHLY = PRO.monthly; // 599

export type EstimateRange = { low: number; high: number };

// One-time build range for the open pipeline. `known` is the summed value of
// deals that already have a price; `unpriced` is how many open deals still sit
// at $0. Each unpriced deal contributes the Starter→Pro band.
export function pipelineValueRange(known: number, unpriced: number): EstimateRange {
  const k = Number(known) || 0;
  const u = Math.max(0, Number(unpriced) || 0);
  return { low: k + u * ESTIMATE_LOW_BUILD, high: k + u * ESTIMATE_HIGH_BUILD };
}

// Monthly-retainer (MRR) range for the open pipeline, same idea as above.
export function pipelineMrrRange(known: number, unpriced: number): EstimateRange {
  const k = Number(known) || 0;
  const u = Math.max(0, Number(unpriced) || 0);
  return { low: k + u * ESTIMATE_LOW_MONTHLY, high: k + u * ESTIMATE_HIGH_MONTHLY };
}

// Render a money range as "low – high" (single value if the ends match).
export function formatRange(low: number, high: number): string {
  return low === high ? formatMoney(low) : `${formatMoney(low)} – ${formatMoney(high)}`;
}

// Convenience: render an EstimateRange directly.
export function formatEstimate(r: EstimateRange): string {
  return formatRange(r.low, r.high);
}

// ---------- Opportunity scoring (heuristic "AI" lead rating) ----------
// A transparent, rules-based score of how likely a company is to close, so reps
// can focus on the hottest leads. This is deliberately explainable — every point
// is tied to a signal Barry picked (best-fit industry, full contact info, showed
// interest on the call, referral). No external AI/data provider needed; a later
// phase can layer real AI write-ups on top of these same signals.

// The industries a web-design studio tends to win most. Matching is loose
// (case-insensitive substring) so "Family Dental" or "Joe's Dentistry" both hit
// "dent". Tunable later per Barry without touching the scoring math.
export const BEST_FIT_INDUSTRIES: string[] = [
  "restaurant",
  "cafe",
  "coffee",
  "bakery",
  "dental",
  "dentist",
  "medical",
  "clinic",
  "chiropract",
  "law",
  "legal",
  "attorney",
  "real estate",
  "realtor",
  "contractor",
  "construction",
  "roofing",
  "plumb",
  "hvac",
  "landscap",
  "salon",
  "spa",
  "barber",
  "fitness",
  "gym",
  "yoga",
  "retail",
  "boutique",
  "auto",
];

// Does a company's industry text fall in our best-fit set? Single-word keywords
// are stems matched against the START of each word (so "plumb" catches
// "plumbing" and "dentist" catches "dentistry"), which avoids false positives
// where a keyword hides mid-word — e.g. "spa" inside "aero-spa-ce". Multi-word
// keywords like "real estate" fall back to a plain substring match.
export function isBestFitIndustry(industry: string | null | undefined): boolean {
  const s = (industry ?? "").toLowerCase().trim();
  if (!s) return false;
  const words = s.split(/[^a-z]+/).filter(Boolean);
  return BEST_FIT_INDUSTRIES.some((k) =>
    k.includes(" ") ? s.includes(k) : words.some((w) => w.startsWith(k)),
  );
}

export type OpportunityBand = "hot" | "warm" | "cool";

export type OpportunitySignals = {
  source?: string | null; // lead source (Referral scores high)
  callOutcome?: string | null; // interested / maybe / no_answer / not_interested / null
  industry?: string | null; // for best-fit match
  hasPhone?: boolean;
  hasEmail?: boolean;
  createdAt?: string | null; // for freshness
  lastActivityIso?: string | null; // most recent touch, if known
};

export type OpportunityScore = {
  score: number; // 0-100
  band: OpportunityBand;
  reasons: string[]; // human-readable "why", best first
};

export const OPPORTUNITY_HOT_MIN = 65;
export const OPPORTUNITY_WARM_MIN = 40;

export function opportunityBand(score: number): OpportunityBand {
  if (score >= OPPORTUNITY_HOT_MIN) return "hot";
  if (score >= OPPORTUNITY_WARM_MIN) return "warm";
  return "cool";
}

export const OPPORTUNITY_BAND_INFO: Record<
  OpportunityBand,
  { label: string; color: string }
> = {
  hot: { label: "Hot", color: "#f97316" },
  warm: { label: "Warm", color: "#eab308" },
  cool: { label: "Cool", color: "#64748b" },
};

// Pure, deterministic scorer. Starts at a neutral base and adds/subtracts points
// for each signal, then clamps to 0-100. Reasons explain the biggest movers so
// the board can show a plain-English "why" next to every company.
export function opportunityScore(sig: OpportunitySignals): OpportunityScore {
  let score = 30; // neutral base
  const reasons: string[] = [];

  // 1) Referral / word-of-mouth — the strongest signal for a local studio.
  if ((sig.source ?? "").toLowerCase() === "referral") {
    score += 25;
    reasons.push("Referral / word-of-mouth");
  }

  // 2) Where they are in the call queue.
  const outcome = (sig.callOutcome ?? "").toLowerCase();
  if (outcome === "interested") {
    score += 30;
    reasons.push("Showed interest on the call");
  } else if (outcome === "maybe") {
    score += 15;
    reasons.push("Warm on the call (maybe)");
  } else if (outcome === "no_answer") {
    score += 5;
    reasons.push("Tried — no answer yet");
  } else if (outcome === "not_interested") {
    score -= 25;
    reasons.push("Said not interested");
  }

  // 3) Best-fit industry.
  if (isBestFitIndustry(sig.industry)) {
    score += 12;
    reasons.push("In a best-fit industry");
  }

  // 4) Reachability — full contact info means a rep can actually work it.
  if (sig.hasPhone && sig.hasEmail) {
    score += 14;
    reasons.push("Full contact info on file");
  } else if (sig.hasEmail) {
    score += 10;
    reasons.push("Has an email on file");
  } else if (sig.hasPhone) {
    score += 8;
    reasons.push("Has a phone number on file");
  } else {
    reasons.push("No contact info yet");
  }

  // 5) Freshness — new leads are worth jumping on; stale untouched ones cool off.
  const ageDays = daysBetween(sig.createdAt);
  if (sig.createdAt) {
    if (ageDays <= 14) {
      score += 5;
      reasons.push("Fresh lead (under 2 weeks)");
    } else if (ageDays > 60 && !outcome) {
      score -= 5;
      reasons.push("Gone cold (60+ days, no contact)");
    }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, band: opportunityBand(score), reasons };
}

// ---------- Discovery scoring (Phase 3: new leads from Google Places) ----------
// Rates a freshly-discovered local business on how promising it is as a Nexraft
// target. The dominant signal is "no website yet" — a business without a site is
// the clearest possible buyer for a web studio. Same 0-100 / hot-warm-cool shape
// as opportunityScore so the two boards read consistently.
export type DiscoverySignals = {
  hasWebsite: boolean;
  industry?: string | null; // Google's primary type text, e.g. "Dental clinic"
  rating?: number | null; // 0-5 Google rating
  reviews?: number | null; // number of Google reviews
  hasPhone?: boolean;
  // true = we probed the listed URL and it did NOT respond (dead site — nearly
  // as strong a buyer signal as no site at all). false = probed and alive.
  // null/undefined = not probed, so scoring falls back to URL presence alone.
  websiteDead?: boolean | null;
};

export function discoveryScore(sig: DiscoverySignals): OpportunityScore {
  let score = 30;
  const reasons: string[] = [];

  // 1) The buyer signal: no website means they need exactly what we sell. A
  //    listed-but-dead website is almost as good — they once paid for a site,
  //    so they value having one, and right now they have nothing.
  if (!sig.hasWebsite) {
    score += 32;
    reasons.push("No website yet — prime target");
  } else if (sig.websiteDead === true) {
    score += 28;
    reasons.push("Website is down — prime redesign target");
  } else {
    reasons.push("Already has a website (redesign play)");
  }

  // 2) Best-fit industry.
  if (isBestFitIndustry(sig.industry)) {
    score += 15;
    reasons.push("In a best-fit industry");
  }

  // 3) Established & active: good rating with real review volume. Only applied
  //    when we actually have review data. Sources without reviews (e.g.
  //    OpenStreetMap) pass null here and skip this block entirely, so they're
  //    scored on the signals we do have rather than wrongly penalised.
  const reviewsKnown = sig.reviews !== null && sig.reviews !== undefined;
  const rating = Number(sig.rating) || 0;
  const reviews = Number(sig.reviews) || 0;
  if (reviewsKnown) {
    if (reviews >= 50 && rating >= 4.0) {
      score += 16;
      reasons.push(`Well-reviewed (${rating.toFixed(1)}★, ${reviews} reviews)`);
    } else if (reviews >= 10) {
      score += 9;
      reasons.push(`Active listing (${rating ? rating.toFixed(1) + "★, " : ""}${reviews} reviews)`);
    } else if (reviews === 0) {
      score -= 5;
      reasons.push("No reviews yet — may be inactive");
    }
  }

  // 4) Reachable by phone (fits the call-first flow).
  if (sig.hasPhone) {
    score += 8;
    reasons.push("Phone number on file");
  } else {
    reasons.push("No phone found");
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, band: opportunityBand(score), reasons };
}

// ---------- Estimated deal value ----------
// Dollar value stamped on freshly discovered deals so pipeline totals mean
// something instead of everything sitting at $0. Reps refine the real number once
// they qualify the lead. Uses Nexraft's real managed-website plans (see the
// Internal Pricing Guide): Business is the default recommendation for most
// prospects, Starter for the simplest ones. Pro is reserved for premium/complex
// sites a rep qualifies by hand, so the radar never auto-estimates a Pro build.
export function planForBand(band: OpportunityBand): PricingPackage {
  const id = band === "cool" ? "starter" : "business";
  return pricingPackage(id) ?? PRICING_PACKAGES[1];
}

export function estimateDealValue(band: OpportunityBand): { value: number; monthly: number } {
  const plan = planForBand(band);
  return { value: plan.build, monthly: plan.monthly };
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
  // `lifetime` is the projected maximum (all 12 months), used as a "what this
  // deal is worth to the rep" ceiling — not what's been earned yet.
  const lifetime = Math.round(m * COMMISSION_RATE * COMMISSION_MONTHS);
  const earnedMonths = Math.min(COMMISSION_MONTHS, Math.max(1, monthsElapsed(signedIso, to) + 1));
  // Round to whole dollars: 30% of e.g. $399 is $119.70, and carrying those
  // cents through the payroll sums leaves fractional "owed" balances that can
  // never be paid off cleanly. Commissions are reconciled in whole dollars.
  const earned = Math.round(m * COMMISSION_RATE * earnedMonths);
  return { earnedMonths, earned, lifetime };
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

// ---------------- lead auto-assign balancing ----------------

// A rep eligible for auto-assignment plus their current open-deal load.
export type AssigneeLoad = { id: string; name: string; open_deals: number };

// In-memory least-loaded pick with random tie-break — mirrors the SQL
// `ORDER BY open_deals ASC, random() LIMIT 1` the per-lead balancer uses.
// Callers batch-assigning should bump the winner's `open_deals` after each
// pick so a large batch spreads evenly across the team.
export function pickLeastLoaded(reps: AssigneeLoad[]): AssigneeLoad | null {
  if (reps.length === 0) return null;
  const min = Math.min(...reps.map((r) => r.open_deals));
  const lightest = reps.filter((r) => r.open_deals === min);
  return lightest[Math.floor(Math.random() * lightest.length)];
}

// ---------------- duplicate detection ----------------
// Pure helpers behind the "Duplicates" cleanup panels. The server loads the
// active records and these group them by normalized identity keys; the UI then
// offers a merge for each group. Kept here (not data.ts) so they're testable.

// Company identity: letters+digits of the name ("Joe's Pizza" == "Joes Pizza Inc"
// is NOT collapsed — suffixes count — but case/punctuation/spacing differences are).
export function companyNameKey(name: string | null | undefined): string {
  return (name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Phone identity: digits only, ignoring a leading US country code so
// "+1 (555) 123-4567" matches "555-123-4567".
export function phoneKey(phone: string | null | undefined): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

// Contact identity: email is the strongest signal; fall back to phone.
export function emailKey(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

export type DupeRecord = { id: string };

// Group records by one or more identity keys. A record can join at most one
// group (first key that matches wins) so merge suggestions never overlap.
// Returns only groups with 2+ members, largest first.
export function groupDuplicates<T extends DupeRecord>(
  records: T[],
  keysOf: (r: T) => string[],
): T[][] {
  const byKey = new Map<string, T[]>();
  const placed = new Set<string>();
  for (const r of records) {
    for (const key of keysOf(r)) {
      if (!key) continue;
      if (placed.has(r.id)) break;
      const bucket = byKey.get(key);
      if (bucket) {
        bucket.push(r);
        placed.add(r.id);
      } else {
        byKey.set(key, [r]);
      }
    }
  }
  const groups: T[][] = [];
  const seen = new Set<string>();
  for (const bucket of byKey.values()) {
    if (bucket.length < 2) continue;
    const fresh = bucket.filter((r) => !seen.has(r.id));
    if (fresh.length < 2) continue;
    for (const r of fresh) seen.add(r.id);
    groups.push(fresh);
  }
  groups.sort((a, b) => b.length - a.length);
  return groups;
}
