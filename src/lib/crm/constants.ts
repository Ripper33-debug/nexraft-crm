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
// Owner's ask (2026-07-22): board reads To Call → Lost → Proposal →
// Negotiation, with Lost sitting right next to To Call so reps see the "no"s
// while they dial. The old Lead/Discovery stages are gone — a one-time task in
// data.ts moves any deals still parked there back to To Call.
export const STAGES: StageInfo[] = [
  { name: "To Call", prob: 0.05, kind: "open", color: "#94a3b8" },
  { name: "Lost", prob: 0.0, kind: "lost", color: "#ef4444" },
  { name: "Proposal", prob: 0.5, kind: "open", color: "#6366f1" },
  { name: "Negotiation", prob: 0.7, kind: "open", color: "#a855f7" },
  { name: "In Build", prob: 0.9, kind: "open", color: "#f59e0b" },
  { name: "Launched", prob: 1.0, kind: "won", color: "#22c55e" },
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

// Industries that pay real money for websites — elective/cash-pay medical,
// legal, trades with big ticket jobs, property. A lead here isn't just a fit,
// it's a fit with budget, so scoring gives these an extra bump on top of the
// best-fit bonus and the Discover page surfaces them as one-tap presets.
export const HIGH_BUDGET_INDUSTRIES: string[] = [
  "med spa",
  "medspa",
  "aesthetic",
  "botox",
  "cosmetic",
  "dermatol",
  "surgeon",
  "weight loss",
  "iv therapy",
  "law",
  "legal",
  "attorney",
  "lawyer",
  "injury",
  "dentist",
  "dental",
  "orthodont",
  "implant",
  "chiropract",
  "veterinary",
  "optometr",
  "roof",
  "hvac",
  "plumb",
  "electrician",
  "remodel",
  "real estate",
  "realtor",
  "estate agent",
];

export function isHighBudgetIndustry(industry: string | null | undefined): boolean {
  const s = (industry ?? "").toLowerCase().trim();
  if (!s) return false;
  const words = s.split(/[^a-z]+/).filter(Boolean);
  return HIGH_BUDGET_INDUSTRIES.some((k) =>
    k.includes(" ") ? s.includes(k) : words.some((w) => w.startsWith(k)),
  );
}

// ---------- Social presence (pure OSM-tag analysis) ----------
// A business that keeps a Facebook or Instagram page but has no real website is
// the easiest sell there is: they're already marketing-minded — they just poured
// the effort into a platform they don't own. Pure so the parsing is testable;
// the tags come straight off the OpenStreetMap element in data.ts.
export type SocialPresence = { platforms: string[]; url: string | null };

const SOCIAL_TAG_MAP: { tags: string[]; label: string; base: string }[] = [
  { tags: ["contact:facebook", "facebook"], label: "Facebook", base: "https://www.facebook.com/" },
  { tags: ["contact:instagram", "instagram"], label: "Instagram", base: "https://www.instagram.com/" },
];

export function parseSocials(tags: Record<string, string>): SocialPresence {
  const platforms: string[] = [];
  let url: string | null = null;
  for (const def of SOCIAL_TAG_MAP) {
    const raw = def.tags.map((t) => (tags[t] ?? "").trim()).find(Boolean);
    if (!raw) continue;
    platforms.push(def.label);
    if (!url) {
      // OSM stores either a full URL or a bare handle/page name.
      url = /^https?:\/\//i.test(raw) ? raw : def.base + raw.replace(/^@/, "");
    }
  }
  return { platforms, url };
}

// ---------- "What converts for you" industry matching ----------
// Fuzzy-match a discovered lead's industry label against the list of industries
// Nexraft has actually converted before (won deals / interested call outcomes).
// Labels vary ("Dental clinic" vs "Dentist office"), so a match is: equal after
// normalising, or one contains the other. Tiny fragments are ignored so "spa"
// can't accidentally claim "spare parts".
export function industryMatchesAny(
  industry: string | null | undefined,
  list: string[] | null | undefined,
): boolean {
  const s = (industry ?? "").toLowerCase().trim();
  if (!s || !list || list.length === 0) return false;
  return list.some((raw) => {
    const k = (raw ?? "").toLowerCase().trim();
    if (k.length < 4 || s.length < 4) return k === s;
    return k === s || s.includes(k) || k.includes(s);
  });
}

// ---------- Website quality audit (pure HTML analysis) ----------
// Given the homepage HTML of a prospect's site, find the problems a rep can
// pitch against — and any contact info hiding in the page. Pure function so the
// grading rules are unit-testable; the fetching lives server-side in data.ts.
//
// Every issue string is written to be said out loud on a sales call.
export type SiteAnalysis = { issues: string[]; email: string | null; phone: string | null };

const PARKED_MARKERS = [
  "this domain is parked",
  "domain is parked",
  "buy this domain",
  "this domain is for sale",
  "hugedomains",
  "sedoparking",
  "parked free, courtesy of",
  "under construction",
  "coming soon",
  "future home of",
];

// Fingerprints of DIY site builders. Seeing one means the business built (or
// paid a nephew to build) a template site — the classic Nexraft upgrade pitch.
const BUILDER_MARKERS: Array<[string, string]> = [
  ["wixstatic.com", "Wix"],
  ["wix.com", "Wix"],
  ["parastorage.com", "Wix"],
  ["godaddysites", "GoDaddy's builder"],
  ["websitebuilder.godaddy", "GoDaddy's builder"],
  ["secureserver.net", "GoDaddy's builder"],
  ["weebly", "Weebly"],
  ["jimdo", "Jimdo"],
  ["site123", "Site123"],
  ["webnode", "Webnode"],
  ["strikingly", "Strikingly"],
  ["blogspot", "Blogger"],
  ["wordpress.com", "WordPress.com"],
  ["squarespace", "Squarespace"],
];

// Emails that aren't really a way to reach the owner.
const EMAIL_JUNK = [
  "example.",
  "sentry",
  "wixpress",
  "godaddy",
  "no-reply",
  "noreply",
  "donotreply",
  "@sentry",
  "schema.org",
  "yourdomain",
  "email.com",
  "domain.com",
];

export function analyzeSiteHtml(html: string, opts?: { https?: boolean }): SiteAnalysis {
  const h = (html ?? "").slice(0, 200_000);
  const lower = h.toLowerCase();
  const issues: string[] = [];

  // Parked / placeholder pages: technically "live", practically nothing there.
  if (PARKED_MARKERS.some((m) => lower.includes(m))) {
    issues.push("Placeholder page — no real site behind the domain");
  }

  // DIY builder fingerprint (first match wins; the list is ordered so asset
  // domains beat generic ones).
  const builder = BUILDER_MARKERS.find(([marker]) => lower.includes(marker));
  if (builder) issues.push(`Built on ${builder[1]} — DIY template site`);

  // No viewport meta = the page doesn't adapt to phones, where most local
  // searches happen. The single most pitchable defect there is.
  if (!/<meta[^>]+name=["']?viewport/i.test(h)) {
    issues.push("Not mobile-friendly — no viewport tag");
  }

  // A copyright line stuck years in the past screams "nobody maintains this".
  // Take the NEWEST year mentioned so ranges like © 2008–2021 read as 2021.
  const yearMatches = [
    ...h.matchAll(/(?:©|&copy;|&#169;|copyright)\s*(?:\d{4}\s*[-–]\s*)?((?:19|20)\d{2})/gi),
  ].map((m) => parseInt(m[1], 10));
  if (yearMatches.length > 0) {
    const newest = Math.max(...yearMatches);
    const current = new Date().getFullYear();
    if (newest <= current - 2) issues.push(`Copyright stuck in ${newest} — site looks abandoned`);
  }

  // Caller tells us the https attempt failed and we fell back to plain http.
  if (opts?.https === false) {
    issues.push("No HTTPS — browsers show \u201cNot secure\u201d");
  }

  // ---- Contact extraction (same page, zero extra requests) ----
  // Prefer an explicit mailto: link; otherwise the first plausible address in
  // the page text that isn't tooling noise or an image filename.
  let email: string | null = null;
  const mailto = h.match(/mailto:([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i);
  if (mailto) {
    email = mailto[1];
  } else {
    const candidates = h.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
    email =
      candidates.find((e) => {
        const l = e.toLowerCase();
        if (l.length > 60) return false;
        if (/\.(png|jpe?g|gif|webp|svg|css|js|woff2?)$/.test(l)) return false;
        return !EMAIL_JUNK.some((j) => l.includes(j));
      }) ?? null;
  }
  if (email) email = email.toLowerCase();

  // Phone: only trust explicit tel: links — free-text number sniffing produces
  // too much junk (zips, prices, years).
  let phone: string | null = null;
  const tel = h.match(/href=["']tel:([+0-9()\-.\s]{7,20})["']/i);
  if (tel) phone = tel[1].trim();

  return { issues, email, phone };
}

// ---------- Need signal: "why are we calling this business at all?" ----------
// Every cold call needs a specific, TRUE, observable reason in the first seven
// seconds — otherwise the rep opens with "we build websites" and gets an instant
// brush-off. leadNeed() reads what the research pass already saved and turns it
// into (a) a rank the call queue can sort/filter by and (b) the exact sentence
// the rep leads with. Pure and unit-tested: the queue, the score and the call
// script all read the same answer, so a rep never sees "call this one" without
// a reason on the card.
//
// Rank is 0-100. Above NEED_CALL_MIN we have something real to say. Anything at
// or below NEED_UNKNOWN_RANK means "we haven't found a reason yet", and
// good_site (0) means we found the opposite: their site is fine, so cold-calling
// them burns a dial and trains the rep to expect a no.
export type NeedKey =
  | "just_down"
  | "no_site"
  | "site_unverified"
  | "domain_expired"
  | "site_down"
  | "facebook_only"
  | "placeholder"
  | "builder"
  | "abandoned"
  | "not_mobile"
  | "no_https"
  | "thin_site"
  | "new_business"
  | "unknown"
  | "good_site";

export type LeadNeed = {
  key: NeedKey;
  rank: number; // 0-100, higher = call sooner
  label: string; // short chip for a list row, e.g. "No website"
  line: string; // the opener, said out loud. "" when we have no fact.
  worthCalling: boolean; // false = no visible reason to interrupt their day
};

export const NEED_CALL_MIN = 40; // at/above this we have a real reason
export const NEED_UNKNOWN_RANK = 20;

export type NeedSignals = {
  website?: string | null;
  research?: string | null; // raw companies.research JSON
  tags?: string | null;
  siteDownAt?: string | null; // companies.site_down_at
  createdAt?: string | null;
};

type ParsedResearch = {
  siteStatus?: string;
  angles?: string[];
  // Present only on dossiers written after the site probe existed. Its presence
  // is the ONLY proof that "no website" was ever actually checked — see
  // siteWasChecked below.
  siteProbe?: { checked?: string[]; found?: string | null; at?: string } | null;
};

/**
 * True when a dossier's "no website" claim was earned by an actual check.
 *
 * This matters because of how the old research code was written: `siteStatus`
 * was INITIALISED to "none" and only moved off that value if a website was
 * already on file. Nothing ever went looking. So every company researched
 * before the probe existed carries siteStatus "none" whether or not it has a
 * website, and there are thousands of them.
 *
 * Trusting that flag would have kept the exact bug we set out to kill: a rep
 * opening with "I noticed you don't have a website" to an owner who does. So
 * the flag alone is not enough — the dossier has to carry the probe's working
 * out too. Old dossiers fall back to site_unverified, which asks instead of
 * asserting, and get promoted the moment the background re-check reaches them.
 */
export function siteWasChecked(research: ParsedResearch | null | undefined): boolean {
  return Boolean(research?.siteProbe);
}

function parseResearch(raw: string | null | undefined): ParsedResearch | null {
  if (!raw) return null;
  try {
    const r = JSON.parse(raw) as ParsedResearch;
    return r && typeof r === "object" ? r : null;
  } catch {
    return null;
  }
}

// Turn one audit angle into a spoken opener. The angle strings come from
// analyzeSiteHtml/extractCompanyIntel above, so this stays in lockstep with them.
function needFromAngle(angle: string): { key: NeedKey; rank: number; label: string; line: string } | null {
  const a = angle.toLowerCase();
  if (a.includes("placeholder") || a.includes("parked")) {
    return {
      key: "placeholder",
      rank: 74,
      label: "Placeholder page",
      line: "I pulled up the web address on your listing and there's just a placeholder page behind it — nothing about the business.",
    };
  }
  if (a.includes("built on")) {
    const builder = angle.match(/Built on ([^—]+?)\s*—/i)?.[1]?.trim();
    return {
      key: "builder",
      rank: 68,
      label: builder ? `DIY ${builder} site` : "DIY template site",
      line: builder
        ? `Your site's running on ${builder} — the free template shows, and that's the first thing a customer comparing you to the next guy sees.`
        : "Your site's on a DIY template builder — it shows, and that's what a customer compares you on.",
    };
  }
  if (a.includes("copyright stuck")) {
    const year = angle.match(/(19|20)\d{2}/)?.[0];
    return {
      key: "abandoned",
      rank: 62,
      label: year ? `Site stuck in ${year}` : "Site looks abandoned",
      line: year
        ? `The footer on your site still says ${year} — anyone checking you out wonders if you're still open.`
        : "Your site looks abandoned — anyone checking you out wonders if you're still trading.",
    };
  }
  if (a.includes("mobile-friendly") || a.includes("viewport")) {
    return {
      key: "not_mobile",
      rank: 58,
      label: "Not mobile-friendly",
      line: "I opened your site on my phone and it doesn't fit the screen — and that's where nearly everyone finds you.",
    };
  }
  if (a.includes("https") || a.includes("not secure")) {
    return {
      key: "no_https",
      rank: 54,
      label: "No HTTPS",
      line: "Your site loads without a padlock, so Chrome puts a \u201cNot secure\u201d warning in front of it before anyone reads a word.",
    };
  }
  if (a.includes("no online booking")) {
    return {
      key: "thin_site",
      rank: 50,
      label: "No online booking",
      line: "There's no way to book you on your site — every appointment has to come through the phone.",
    };
  }
  if (a.includes("no contact form")) {
    return {
      key: "thin_site",
      rank: 50,
      label: "No contact form",
      line: "There's no contact form on your site — if someone's looking at 10pm, they've got nothing to do but leave.",
    };
  }
  if (a.includes("testimonial") || a.includes("review")) {
    return {
      key: "thin_site",
      rank: 48,
      label: "No reviews shown",
      line: "Your site doesn't show a single review — you've got happy customers and nobody comparing you can see them.",
    };
  }
  return null;
}

// Strict cousin of daysBetween: null when there's no date or the date is
// junk, instead of 0. Anything the rep says out loud with a timeframe in it
// ("went down a couple of days ago", "you just registered") is gated on this.
function daysSince(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null;
  const d = new Date(iso.replace(" ", "T") + (iso.includes("T") ? "" : "Z"));
  if (isNaN(d.getTime())) return null;
  return Math.floor((now.getTime() - d.getTime()) / 86400000);
}

// Highest-need signal wins. Order below IS the priority order.
export function leadNeed(sig: NeedSignals, now: Date = new Date()): LeadNeed {
  const tags = parseTags(sig.tags).map((t) => t.toLowerCase());
  const research = parseResearch(sig.research);
  const angles = (research?.angles ?? []).filter((a) => typeof a === "string");
  const hasSite = Boolean((sig.website ?? "").trim());

  // 1) It broke on our watch. Nothing beats calling the day their site dies.
  // daysBetween() reports 0 for a missing OR unparseable date, and 0 days ago
  // reads as "it just broke" — so a junk timestamp would put a claim in the
  // rep's mouth that isn't true. Every dated claim below is gated on a date we
  // could actually parse.
  const downDays = daysSince(sig.siteDownAt, now);
  if (downDays !== null && downDays >= 0 && downDays <= 7) {
    return {
      key: "just_down",
      rank: 96,
      label: "Site just went down",
      line: "Your website stopped loading a couple of days ago — I checked again right before I called. Did you know it was down?",
      worthCalling: true,
    };
  }

  // 2) Nothing there at all — but ONLY if somebody actually looked.
  //
  // This block used to fire on `!hasSite` alone, and that was the single most
  // expensive bug in the lead engine. A company's `website` is empty whenever
  // OpenStreetMap simply never recorded one, which is the majority case: in a
  // live sample of Cape Coral, 64% of named businesses had no website tag, and
  // among the ones the radar would have imported were Ross, 7-Eleven, and a
  // local electrician whose site (aaaeinc.com) has existed for years. Every one
  // of those got handed to a rep as "no website" with a confident opener
  // asserting it. An owner who HAS a website hears a stranger state something
  // obviously false about their business and hangs up — which is exactly the
  // wall of instant brush-offs the team was hitting.
  //
  // So sitelessness is now a claim that has to be earned. It takes BOTH a
  // siteStatus of "none" AND evidence the probe actually ran — because the old
  // code defaulted siteStatus to "none" without ever looking, so the flag on
  // its own means nothing on any dossier written before today. An unchecked
  // blank falls through to site_unverified below, which asks instead of asserts.
  if (research?.siteStatus === "none" && siteWasChecked(research)) {
    return {
      key: "no_site",
      rank: 92,
      label: "No website",
      // Still phrased as a confirmation, not a pronouncement. Our check is good,
      // not omniscient — and "am I right?" costs nothing when we're right and
      // saves the call when we're wrong.
      line: "I went looking for a website for you before I called and couldn't find one anywhere — am I right that you don't have one yet?",
      worthCalling: true,
    };
  }

  // 2b) No website on file, and nobody has checked whether that's true.
  //
  // Worth a call — a good share of these really are siteless — but the rep must
  // not walk in claiming it. The opener asks, so a wrong guess costs one polite
  // sentence instead of the whole call, and the answer tells us which it was.
  if (!hasSite) {
    return {
      key: "site_unverified",
      // Sits below every need we've actually confirmed and above the ones we've
      // only inferred, so a rep spends the morning on leads where we know why
      // we're calling and gets to the guesses afterwards.
      rank: 64,
      label: "No website found",
      line: "I couldn't find a website for you when I looked — do you have one, or is the Google listing all that's out there?",
      worthCalling: true,
    };
  }

  // 3) They had one and it's gone. They've already paid for a site once.
  if (research?.siteStatus === "dead") {
    const expired = angles.some((a) => /expired|domain (is )?gone/i.test(a));
    return expired
      ? {
          key: "domain_expired",
          rank: 88,
          label: "Domain expired",
          line: "The web address on your listing doesn't exist anymore — the domain lapsed, so whatever you had is gone.",
          worthCalling: true,
        }
      : {
          key: "site_down",
          rank: 86,
          label: "Website is down",
          line: "I tried your website before calling and it doesn't load at all — anyone who clicks it from Google gets an error.",
          worthCalling: true,
        };
  }

  // 4) Marketing-minded but siteless — they already believe in being found.
  if (tags.includes("facebook-only")) {
    return {
      key: "facebook_only",
      rank: 80,
      label: "Social only, no site",
      line: "Your Facebook page comes up first, and it's active — but there's no website behind it, so everything you post has nowhere to land.",
      worthCalling: true,
    };
  }

  // 5) Live but broken: the audit angles, strongest first.
  let best: { key: NeedKey; rank: number; label: string; line: string } | null = null;
  for (const a of angles) {
    const m = needFromAngle(a);
    if (m && (!best || m.rank > best.rank)) best = m;
  }
  if (best) return { ...best, worthCalling: true };

  // 6) Brand new business — no research yet, but "just opened" is a real reason.
  const age = daysSince(sig.createdAt, now);
  if (tags.includes("new-business") && age !== null && age >= 0 && age <= 45) {
    return {
      key: "new_business",
      rank: 46,
      label: "Just opened",
      line: "I saw you just registered the business — congratulations. I only called because most people are three months in before they get found online, and it costs them the first season.",
      worthCalling: true,
    };
  }

  // 7) Researched, live, no defects found: nothing honest to open with.
  if (research && research.siteStatus === "live") {
    return {
      key: "good_site",
      rank: 0,
      label: "Site looks fine",
      line: "",
      worthCalling: false,
    };
  }

  // 8) Never researched. Callable, but it goes behind everything with a reason.
  return {
    key: "unknown",
    rank: NEED_UNKNOWN_RANK,
    label: "Not researched yet",
    line: "",
    worthCalling: false,
  };
}

// ---------- Reading the book at a glance ----------
// leadNeed labels are deliberately specific ("DIY Wix site", "Site stuck in
// 2016"), which is right on a call card and useless for counting. These are the
// stable buckets: one row per NeedKey, ordered the way a rep should work them,
// so the Companies page can say "you have 38 with no website and 400 nobody has
// looked at" instead of one vague good/weak split.
export const NEED_GROUPS: { key: NeedKey; label: string; blurb: string }[] = [
  { key: "just_down", label: "Site just went down", blurb: "Broke in the last week — call today, they already know." },
  { key: "no_site", label: "No website at all", blurb: "Checked and confirmed — nothing behind the listing. The easiest true opener we own." },
  { key: "domain_expired", label: "Domain expired", blurb: "They paid for a site once and let it lapse — the budget existed." },
  { key: "site_down", label: "Website is down", blurb: "The link on their listing throws an error for every customer who clicks it." },
  { key: "facebook_only", label: "Social only, no site", blurb: "Already posting and promoting — no website for any of it to land on." },
  { key: "placeholder", label: "Placeholder page", blurb: "Domain resolves to a parked or coming-soon page." },
  { key: "builder", label: "DIY builder site", blurb: "Free template — the fix is visible in ten seconds on the call." },
  { key: "site_unverified", label: "No website found", blurb: "Nothing on file, but nobody has looked. Ask on the call — never claim it." },
  { key: "abandoned", label: "Looks abandoned", blurb: "Stale footer year — customers wonder if they're still open." },
  { key: "not_mobile", label: "Not mobile-friendly", blurb: "Doesn't fit a phone screen, which is where nearly everyone finds them." },
  { key: "no_https", label: "No HTTPS", blurb: "Chrome shows a Not secure warning before anyone reads a word." },
  { key: "thin_site", label: "Thin site", blurb: "Live, but no booking, no contact form, or no reviews shown." },
  { key: "new_business", label: "Just opened", blurb: "Registered in the last 45 days — the reason to call is timing, not defects." },
  { key: "unknown", label: "Not researched yet", blurb: "No reason to call found yet. Research these before anyone dials them." },
  { key: "good_site", label: "Nothing wrong found", blurb: "Live, modern, no defects. Nothing honest to open with — hardest calls in the book." },
];

export function needGroupLabel(key: NeedKey): string {
  return NEED_GROUPS.find((g) => g.key === key)?.label ?? key;
}

// ---------- The first seven seconds ----------
// A cold call is won or lost before the rep finishes their second sentence. The
// team's nos were nearly all instant brush-offs, which is what happens when the
// opener is "we build websites for local businesses" — that's about us, it's
// true of a hundred callers, and the only honest answer is "not interested".
//
// So every opener here is: who I am + permission + ONE true fact about THEIR
// business + a question they can answer without committing to anything. The
// fact comes from leadNeed, so the rep is never guessing.
export type CallOpener = { hook: string; fact: string; ask: string };

export function callOpener(opts: {
  company: string;
  repFirst?: string | null;
  need?: LeadNeed | null;
  industry?: string | null;
  city?: string | null;
}): CallOpener {
  const rep = (opts.repFirst ?? "").trim();
  const company = (opts.company ?? "").trim() || "your business";
  const where = (opts.city ?? "").trim();
  // Name yourself, admit it's a cold call, and cap it. Asking for twenty
  // seconds and meaning it disarms the reflex "no" far better than pretending
  // this is anything other than what it is.
  const hook =
    `Hi — is that ${company}? My name's ${rep || "…"}, I'm with Nexraft${where ? ` over in ${where}` : ""}. ` +
    `This is a cold call — give me twenty seconds and then tell me to get lost if you want.`;

  const fact =
    opts.need?.line ||
    `I only called because of what shows up when someone searches for ${
      (opts.industry ?? "").trim() ? `a ${(opts.industry ?? "").trim().toLowerCase()}` : "a business like yours"
    }${where ? ` in ${where}` : ""} — and right now it isn't you.`;

  const asks: Partial<Record<NeedKey, string>> = {
    just_down: "Were you aware, or has nobody told you yet?",
    site_down: "Did you know, or is that news?",
    domain_expired: "Was that on purpose, or did it just lapse on you?",
    no_site: "Is that deliberate, or just one of those things that never got done?",
    // Nobody has checked this one, so the ask has to leave room for a yes —
    // a rep who barrels on as if it's settled gets caught out.
    site_unverified: "Have I got that right, or is there one I just couldn't find?",
    facebook_only: "Was a proper website ever on the list, or has Facebook been enough so far?",
    placeholder: "Is someone meant to be building that, or has it been sat like that a while?",
    builder: "Did you put that together yourself?",
    abandoned: "Is anyone actually looking after it these days?",
    not_mobile: "Do you get many people finding you on their phone?",
    no_https: "Has anyone mentioned that warning to you?",
    thin_site: "How are people getting hold of you at the moment — all through the phone?",
    new_business: "Have you sorted the website side yet, or is that still on the list?",
  };
  const ask =
    (opts.need ? asks[opts.need.key] : null) ??
    "When someone looks you up before they call — what do you want them to find?";

  return { hook, fact, ask };
}

// ---------- Second, third and fourth dial (the callback ladder) ----------
//
// Almost nobody picks up first time, and almost nobody buys on the first
// conversation either. Before this, a no-answer was a dead end: the company
// left the call queue and never came back, so every lead got exactly one ring.
// This gives it four.
//
// The gaps widen on purpose — two days, then four, then a week. Close enough
// that the reason we're calling is still true (a dead site does get fixed), far
// enough apart that four dials spread over a fortnight instead of pestering
// someone twice in an afternoon.
export const CALLBACK_DAYS = [2, 4, 7] as const;
// When the ladder runs out we don't delete anything — we park it a month out.
// A business that ignored four calls in June may well answer in July, and a
// company with NO date scheduled reads as "due now" everywhere else in the app,
// which would jam the queue forever.
export const CALLBACK_PARK_DAYS = 30;
export const CALLBACK_MAX_ATTEMPTS = CALLBACK_DAYS.length + 1; // 4 dials total

// Days to wait before dial number `attempts + 1`. `attempts` is the number of
// no-answers recorded so far, INCLUDING the one just logged.
export function callbackDelayDays(attempts: number): number {
  const n = Math.max(1, Math.floor(attempts || 1));
  return CALLBACK_DAYS[n - 1] ?? CALLBACK_PARK_DAYS;
}

// The timestamp to store in companies.next_call_at after a no-answer. Always
// returns a date — never null — so a company can never sit permanently due.
export function nextCallbackAt(attempts: number, now: Date = new Date()): string {
  return new Date(now.getTime() + callbackDelayDays(attempts) * 86400000).toISOString();
}

// Is a scheduled callback ready to dial? A missing or unreadable date means it
// was never scheduled (legacy row), which counts as ready.
export function callbackDue(nextCallAt: string | null | undefined, now: Date = new Date()): boolean {
  if (!nextCallAt) return true;
  const t = new Date(nextCallAt.replace(" ", "T") + (nextCallAt.includes("T") ? "" : "Z")).getTime();
  if (isNaN(t)) return true;
  return t <= now.getTime();
}

// When the next dial lands, in words. relativeTime() only looks backwards
// ("3d ago") and would call a future date "just now", so callbacks need their
// own forward-facing wording.
export function callbackWhen(nextCallAt: string | null | undefined, now: Date = new Date()): string {
  if (callbackDue(nextCallAt, now)) return "due now";
  const d = new Date(String(nextCallAt).replace(" ", "T") + (String(nextCallAt).includes("T") ? "" : "Z"));
  const days = Math.ceil((d.getTime() - now.getTime()) / 86400000);
  if (days <= 1) return "tomorrow";
  if (days <= 14) return `in ${days} days`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Plain-English pill for the queue, e.g. "2nd try" — a rep should see at a
// glance that this is not a fresh name.
export function callbackLabel(attempts: number): string {
  const n = Math.max(1, Math.floor(attempts || 1)) + 1;
  if (n >= CALLBACK_MAX_ATTEMPTS) return "Last try";
  return n === 2 ? "2nd try" : n === 3 ? "3rd try" : `${n}th try`;
}

// ---------- Why they said no ----------
//
// A "no" with no reason attached teaches us nothing, and a week of them looks
// exactly like bad luck. Written down, the same week usually says something
// specific and fixable: everyone we rang was happy with their site (wrong
// list), or nobody would put us through (wrong time of day), or every single
// one balked at the price (wrong opener).
//
// Presets, not a text box, and eight of them at most — a rep between calls will
// tap a button but will not write a sentence, and free text can't be counted.
// `coach` is what we'd do differently if this reason keeps winning; it's shown
// under the tally so the count turns into a decision.
export type NoReasonKey =
  | "happy_with_site"
  | "has_someone"
  | "no_budget"
  | "wrong_person"
  | "brushed_off"
  | "diy"
  | "winding_down"
  | "other";

export const NO_REASONS: { key: NoReasonKey; label: string; coach: string }[] = [
  {
    key: "happy_with_site",
    label: "Happy with their site",
    coach:
      "We're calling businesses whose sites are fine. Work the 'no website' and 'site down' piles on Companies before anything else.",
  },
  {
    key: "has_someone",
    label: "Already has someone",
    coach:
      "Not a dead end — ask who looks after it and when they last heard from them. Neglected retainers are the easiest switch we get.",
  },
  {
    key: "no_budget",
    label: "Can't afford it",
    coach:
      "Lead with the $299/mo plan and no upfront build cost, or the free report card. Price shouldn't come up before they've agreed there's a problem.",
  },
  {
    key: "wrong_person",
    label: "Wrong person / gatekeeper",
    coach:
      "Ask for the owner by name and try before 9am or after 5pm — that's when they answer their own phone.",
  },
  {
    key: "brushed_off",
    label: "Wouldn't talk at all",
    coach:
      "The first seven seconds are doing the damage. Open with what's wrong with THEIR site and a question, never with who we are.",
  },
  {
    key: "diy",
    label: "Doing it themselves",
    coach:
      "Offer the free report card. Half of DIY sites fail on mobile or speed, and seeing that in writing changes the conversation.",
  },
  {
    key: "winding_down",
    label: "Closing / retiring",
    coach: "Nothing to fix — archive them so nobody rings them again.",
  },
  { key: "other", label: "Something else", coach: "" },
];

export function noReasonLabel(key: string | null | undefined): string {
  return NO_REASONS.find((r) => r.key === key)?.label ?? "Not recorded";
}

export function noReasonCoach(key: string | null | undefined): string {
  return NO_REASONS.find((r) => r.key === key)?.coach ?? "";
}

export function isNoReason(key: string | null | undefined): key is NoReasonKey {
  return NO_REASONS.some((r) => r.key === key);
}

// Count the nos by reason, commonest first. Pure so the tally card and any
// report can share one answer.
export function tallyNoReasons(
  rows: { call_outcome?: string | null; no_reason?: string | null }[],
): { key: NoReasonKey; label: string; count: number; coach: string }[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (r.call_outcome !== "not_interested") continue;
    if (!isNoReason(r.no_reason)) continue;
    counts.set(r.no_reason, (counts.get(r.no_reason) ?? 0) + 1);
  }
  return NO_REASONS.filter((r) => (counts.get(r.key) ?? 0) > 0)
    .map((r) => ({ key: r.key, label: r.label, count: counts.get(r.key) ?? 0, coach: r.coach }))
    .sort((a, b) => b.count - a.count);
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
  // The reason we'd call them at all (see leadNeed above). Passing it is what
  // separates "a business" from "a business that visibly needs us".
  need?: LeadNeed | null;
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

  // 2b) THE signal: do they visibly need what we sell? A business whose site is
  // down, expired or missing is a different animal from one with a perfectly
  // good site — and until 2026-07-26 they scored identically here, which is how
  // reps ended up dialling businesses with nothing wrong and hearing "we're all
  // set" all day. Need outweighs every other signal on the board.
  if (sig.need) {
    if (sig.need.key === "good_site") {
      score -= 30;
      reasons.push("Site's already fine — nothing to open the call with");
    } else if (sig.need.key === "unknown") {
      score -= 8;
      reasons.push("No reason to call found yet — needs research");
    } else {
      score += Math.round(sig.need.rank * 0.3); // 92 → +28, 46 → +14
      reasons.unshift(sig.need.label);
    }
  }

  // 3) Best-fit industry.
  if (isBestFitIndustry(sig.industry)) {
    score += 12;
    reasons.push("In a best-fit industry");
  }

  // 3b) High-value trades (law, med spas, roofing, HVAC…) — one customer is
  // worth thousands to them, so they actually spend on their web presence.
  // Owner's call (2026-07-21): these float to the top of every call list.
  // Discover scoring already had this bump; now the main book does too.
  if (isHighBudgetIndustry(sig.industry)) {
    score += 10;
    reasons.push("High-value trade — real web budget");
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
  // true = the listed site is dead AND its domain no longer resolves in DNS at
  // all — the domain expired or was dropped. The strongest "they need a new
  // site" signal a dead site can carry: whatever they had is gone for good.
  domainExpired?: boolean | null;
  // Pitchable defects found by analyzeSiteHtml (outdated, DIY builder, not
  // mobile-friendly, ...). Only meaningful when the site was fetched and alive.
  websiteIssues?: string[] | null;
  // Social platforms the business maintains (from OSM tags) — e.g. ["Facebook"].
  // Marketing-minded but siteless is the easiest pitch we have.
  socials?: string[] | null;
  // true = this lead's industry matches one Nexraft has already converted
  // (won a deal or got an "interested" on the phone). Evidence beats hunches.
  provenIndustry?: boolean;
};

// ---------------------------------------------------------------------------
// Chains and franchises
// ---------------------------------------------------------------------------
// A national chain is not a prospect. Ross doesn't buy a website from a studio
// in Cape Coral, and putting one in front of a rep costs a real dial and a
// little bit of their faith in the queue.
//
// The tell is OpenStreetMap's `brand` tag — but it can't be used bluntly,
// because plenty of genuine local businesses carry one. In the Cape Coral
// sample "Karry's Automotive" is tagged brand=Goodyear and "De Bono's Stop and
// Go" is tagged brand=Sunoco; both are exactly the independent operator we want
// to call. What separates them from Ross is simple: a chain's NAME IS its
// brand. "Ross" is branded Ross, "7-Eleven" is branded 7-Eleven. Karry's is not
// branded Karry's.
//
// So: brand tag + the name matches the brand = chain. Brand tag + a name of
// their own = a local business flying someone's flag, and we keep it.
const CHAIN_NAMES = [
  "walmart", "target", "costco", "kroger", "publix", "safeway", "aldi", "lidl",
  "7 eleven", "circle k", "wawa", "sheetz", "speedway", "racetrac", "quiktrip",
  "cvs", "walgreens", "rite aid", "dollar general", "dollar tree", "family dollar",
  "mcdonalds", "burger king", "wendys", "taco bell", "kfc", "subway", "chipotle",
  "starbucks", "dunkin", "dominos", "pizza hut", "papa johns", "chick fil a",
  "arbys", "sonic drive in", "popeyes", "jimmy johns", "panera bread", "five guys",
  "home depot", "lowes", "ace hardware", "autozone", "oreilly auto parts",
  "advance auto parts", "napa auto parts", "pep boys", "firestone", "midas",
  "jiffy lube", "valvoline", "discount tire", "tire kingdom",
  "planet fitness", "la fitness", "anytime fitness", "orangetheory", "crunch fitness",
  "great clips", "supercuts", "sport clips", "sally beauty", "ulta beauty",
  "jcpenney", "macys", "kohls", "ross", "marshalls", "tj maxx", "burlington",
  "bealls", "gnc", "gamestop", "best buy", "staples", "office depot",
  "ups store", "fedex office", "h&r block", "jackson hewitt",
  "enterprise rent a car", "hertz", "avis", "budget rent a car",
  "bank of america", "wells fargo", "chase bank", "truist", "regions bank",
  "state farm", "allstate", "geico", "progressive insurance", "farmers insurance",
  "keller williams", "re max", "century 21", "coldwell banker", "berkshire hathaway",
  "petsmart", "petco", "tractor supply", "harbor freight", "michaels", "hobby lobby",
  // Added after checking the list against a live Cape Coral pull — every one of
  // these was sitting in the siteless results and would have gone to a rep.
  "hair cuttery", "applebees", "cicis", "little caesars", "outback steakhouse",
  "hooters", "perkins", "bob evans", "rita's italian ice", "party city",
  "hallmark", "homegoods", "pet supermarket", "sherwin williams", "liberty tax",
  "western union", "fifth third bank", "bb&t", "capital bank", "sunoco",
  "shell", "mobil", "marathon", "chevron", "exxon", "bp", "citgo",
  "united states post office", "us post office", "goodwill", "salvation army",
  "at&t", "verizon", "t mobile", "sprint", "xfinity", "spectrum",
];

/** Loose comparison key for business names: letters and digits only, lowercased. */
export function nameKey(s: string | null | undefined): string {
  return String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// Words a chain bolts onto its own name to describe one outlet. A name that is
// a chain name plus nothing but these (and digits) is still that chain: "Pizza
// Hut Express", "AT&T Express Outlet", "Bank of America Financial Center",
// "Walgreens 4821". All drawn from a live sample of Cape Coral rather than
// imagined — every one of these was a real listing the first version let past.
// Kept deliberately short. Only words nobody would name an independent business
// after belong here: "Ross Market" would be a real local shop, so "market" is
// out, while nobody opens a business called "Outlet". Every entry below earned
// its place by appearing in the Cape Coral sample.
const OUTLET_WORDS = [
  "express", "outlet", "store", "supercenter", "supermarket",
  "center", "centre", "financial", "branch", "atm", "kiosk", "location",
  "drivethru", "drivethrough",
];
const OUTLET_TAIL = new RegExp(`^(?:${OUTLET_WORDS.join("|")}|[0-9]+|#)*$`);

// True when `name` is `key` followed by nothing meaningful — a number, an
// outlet descriptor, or both. "rossiter roofing" must never be caught by
// "ross", which is why the tail is checked instead of just accepting any prefix.
function isSameBusinessName(name: string, key: string): boolean {
  if (!key) return false;
  if (name === key) return true;
  if (!name.startsWith(key)) return false;
  return OUTLET_TAIL.test(name.slice(key.length));
}

/**
 * True when this listing is a national chain or franchise outlet rather than an
 * independent business we could sell to.
 *
 * A branch manager can't buy a website — that's decided at head office — so
 * every one of these is a call that could never close, and they were reaching
 * the top of the queue because head office hadn't bothered to tell
 * OpenStreetMap about the corporate site.
 */
export function looksLikeChain(sig: {
  name?: string | null;
  brand?: string | null;
  operator?: string | null;
}): boolean {
  const name = nameKey(sig.name);
  if (!name) return false;

  // A curated list of names that are chains wherever they appear.
  for (const c of CHAIN_NAMES) {
    if (isSameBusinessName(name, nameKey(c))) return true;
  }

  // The brand tell: their name IS the brand they carry. `brand` in OSM means a
  // chain, so self-naming here is a reliable signal on its own — it catches
  // franchises we never listed, like Firehouse Subs.
  //
  // Crucially this does NOT fire for a business that merely stocks a brand:
  // Karry's Automotive sells Goodyear tyres and De Bono's Stop and Go sells
  // Sunoco fuel, and both are exactly the independent local businesses we're
  // hunting for. Their names are their own.
  if (isSameBusinessName(name, nameKey(sig.brand))) return true;

  // `operator` is different and needs a tighter test. Plenty of independents
  // list themselves as their own operator — Coral Palace Arcade 777 is operated
  // by "Coral Palace Arcade" — and the first version threw those away. So an
  // operator only counts as evidence when the operator is itself a chain we
  // recognise, which is what "Bank of America Financial Center" looks like.
  const operator = nameKey(sig.operator);
  if (operator && CHAIN_NAMES.some((c) => nameKey(c) === operator)) {
    if (isSameBusinessName(name, operator)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Guessing a business's website so we can check whether they really lack one
// ---------------------------------------------------------------------------
const DOMAIN_STOPWORDS = new Set([
  "the", "and", "of", "a", "an", "for", "at", "in", "on", "&",
  "inc", "llc", "l l c", "ltd", "co", "corp", "corporation", "company",
  "pllc", "pa", "pc", "lp", "llp",
]);

/**
 * Plausible domains for a business name, best guess first. Used to check whether
 * a business we think is siteless actually has a site we simply never recorded.
 *
 * Two shapes, because small businesses use both: the whole name run together
 * (Abacus Hair Design -> abacushairdesign.com) and the initials (All American
 * Air & Elec Inc -> aaaeinc.com, which is their real domain — a name-only guess
 * would have missed it and left us calling them to say they have no website).
 */
export function candidateDomains(name: string | null | undefined, limit = 6): string[] {
  const raw = String(name ?? "").toLowerCase();
  if (!raw.trim()) return [];
  const words = raw
    .replace(/[^a-z0-9&\s-]/g, " ")
    .split(/[\s-]+/)
    .filter(Boolean);
  const meaningful = words.filter((w) => !DOMAIN_STOPWORDS.has(w));
  if (meaningful.length === 0) return [];

  const joined = meaningful.join("").replace(/[^a-z0-9]/g, "");
  const initials = meaningful.map((w) => w[0]).join("").replace(/[^a-z0-9]/g, "");
  // Keep the legal suffix on the initials form: "aaae" alone is a coin toss,
  // "aaaeinc" is a real pattern for exactly this kind of company.
  const suffix = words.find((w) => ["inc", "llc", "co", "corp"].includes(w)) ?? "";

  const stems: string[] = [];
  const push = (s: string) => {
    if (s.length >= 4 && s.length <= 40 && !stems.includes(s)) stems.push(s);
  };
  push(joined);
  if (meaningful.length > 2) push(meaningful.slice(0, 2).join(""));
  if (initials.length >= 3) {
    if (suffix) push(initials + suffix);
    push(initials);
  }

  const out: string[] = [];
  for (const stem of stems) {
    for (const tld of [".com", ".net"]) {
      if (out.length < limit) out.push(stem + tld);
    }
  }
  return out.slice(0, limit);
}

/**
 * Does a fetched page actually belong to this business? Guarding on this is what
 * keeps a parked domain or an unrelated company from being recorded as their
 * site — which would swap one wrong claim for another.
 */
export function pageProvesBusiness(
  html: string | null | undefined,
  sig: { name?: string | null; phone?: string | null },
): boolean {
  const text = String(html ?? "").toLowerCase();
  if (!text) return false;

  // A phone match is conclusive: nobody else prints their number.
  const digits = String(sig.phone ?? "").replace(/\D/g, "").slice(-10);
  if (digits.length === 10 && text.replace(/\D/g, "").includes(digits)) return true;

  // Otherwise every distinctive word of the name has to appear. "All American
  // Air" needs all, american and air — any one alone proves nothing.
  const words = String(sig.name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !DOMAIN_STOPWORDS.has(w));
  if (words.length === 0) return false;
  return words.every((w) => text.includes(w));
}

export function discoveryScore(sig: DiscoverySignals): OpportunityScore {
  let score = 30;
  const reasons: string[] = [];

  // 1) The buyer signal: no website means they need exactly what we sell. A
  //    listed-but-dead website is almost as good — they once paid for a site,
  //    so they value having one, and right now they have nothing.
  if (!sig.hasWebsite) {
    score += 32;
    reasons.push("No website yet — prime target");
  } else if (sig.websiteDead === true && sig.domainExpired === true) {
    // Domain gone from DNS entirely: they once paid for a site and the whole
    // thing lapsed. Slots between "no site" (32) and "server down" (28) — the
    // old site is unrecoverable, so this is effectively a no-site lead that has
    // already proven it will pay for web work.
    score += 30;
    reasons.push("Domain expired — their old site is gone for good");
  } else if (sig.websiteDead === true) {
    score += 28;
    reasons.push("Website is down — prime redesign target");
  } else if (sig.websiteIssues && sig.websiteIssues.length > 0) {
    // Alive but bad: every audited defect is a line the rep can open with.
    // Caps just under the dead-site bonus — a broken-but-up site still beats a
    // healthy one by a mile.
    score += Math.min(26, 8 + sig.websiteIssues.length * 6);
    reasons.push(...sig.websiteIssues.slice(0, 3));
  } else {
    reasons.push("Already has a website (redesign play)");
  }

  // 1b) Marketing-minded but siteless: they keep a Facebook/Instagram page yet
  //     have no (working) website. They already believe in being found online —
  //     the easiest close in the deck. Only fires when the site signal says
  //     there's nothing real behind the business (no site, or a dead one).
  if (
    sig.socials &&
    sig.socials.length > 0 &&
    (!sig.hasWebsite || sig.websiteDead === true)
  ) {
    score += 12;
    reasons.push(`On ${sig.socials.join(" & ")} but no real website — already marketing-minded`);
  }

  // 2) Best-fit industry.
  if (isBestFitIndustry(sig.industry)) {
    score += 15;
    reasons.push("In a best-fit industry");
  }

  // 2b) Budget: industries known to spend real money on their web presence.
  if (isHighBudgetIndustry(sig.industry)) {
    score += 10;
    reasons.push("High-budget industry — real web spend");
  }

  // 2c) Proven for Nexraft specifically: this industry has already produced a
  //     won deal or an interested call for the team. Track record > theory.
  if (sig.provenIndustry) {
    score += 8;
    reasons.push("Industry that's converted for Nexraft before");
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

// ---------- "You've already emailed these people" ----------
//
// The CRM has counted email touches since the beginning and stamped the date
// on every send — and showed it on exactly one screen. So the answer to "have
// I written to this lot before?" existed the whole time and was invisible
// everywhere a rep actually decides to write. Barry nearly sent a second cold
// email to a company he'd already emailed, and only caught it by remembering.
//
// This is the one shared shape every screen renders, so the Companies list,
// the company page, the call queue and the composer can't drift apart or
// disagree. It NEVER blocks anything — sending again is often the right call,
// and a follow-up is a different email from a first touch. It just makes sure
// nobody finds out from the reply.
export type EmailHistory = {
  touches: number;
  /** "3× emailed · last 4d ago" — ready to drop into a pill. */
  label: string;
  /** Sent in the last 14 days: writing again today needs a moment's thought. */
  recent: boolean;
  /** The three-touch sequence is finished; a fourth is a decision, not a step. */
  exhausted: boolean;
  /** One line saying what to do about it, for the composer. "" when nothing to say. */
  advice: string;
};

export const EMAIL_RECENT_DAYS = 14;
export const EMAIL_SEQUENCE_LENGTH = 3;

export function emailHistory(
  c: { email_touches?: number | null; last_emailed_at?: string | null } | null | undefined,
  now = new Date(),
): EmailHistory | null {
  const touches = Math.max(0, Number(c?.email_touches) || 0);
  // Never emailed is the common case and deserves no chrome at all — a badge
  // on every row would be noise, and noise is what gets ignored.
  if (touches <= 0) return null;
  const last = c?.last_emailed_at ?? null;
  const ago = last ? relativeTime(last, now) : "";
  const days = last ? daysBetween(last, now) : Number.POSITIVE_INFINITY;
  const recent = Number.isFinite(days) && days <= EMAIL_RECENT_DAYS;
  const exhausted = touches >= EMAIL_SEQUENCE_LENGTH;
  const label = `${touches}× emailed${ago ? ` · last ${ago}` : ""}`;
  const advice = exhausted
    ? `You've sent all ${EMAIL_SEQUENCE_LENGTH} in the sequence${ago ? ` (last ${ago})` : ""}. A fourth is worth sending only if you've got something new to say — otherwise call them.`
    : recent
      ? `You emailed them ${ago}. If this is the next one in the sequence, carry on — if it's a fresh cold email, they'll notice.`
      : "";
  return { touches, label, recent, exhausted, advice };
}

// ---------- Record-level access (ownership + sharing) ----------
// Minimal "actor" shape the permission check needs.
export type Actor = { id: string; role: string } | null | undefined;

// Owner's ask (2026-07-22): "give Nick Besser access to everyone else's
// companies." Rather than hardcode one person, this is a proper Manager
// level: managers see and can edit the whole team's book — companies,
// contacts, deals, activities — like an admin does, but the Admin pages
// (Team, Payroll, Billing) and the bulk admin tools stay admin-only.
export function hasTeamScope(role: string | null | undefined): boolean {
  return role === "admin" || role === "manager";
}

// Parse a comma-separated shared_with column into a list of user ids.
export function parseSharedIds(shared: string | null | undefined): string[] {
  return (shared ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// Can this user edit a record? Admins and managers always can; the owner
// always can; anyone explicitly shared can; an unowned record is open to all.
// Everyone else is locked out. This is the single source of truth, mirrored
// on the server.
export function canEditRecord(
  user: Actor,
  ownerId: string | null | undefined,
  sharedWith: string | null | undefined,
): boolean {
  if (!user) return false;
  if (hasTeamScope(user.role)) return true;
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

// ---------- Company research (deep-dive intel extraction) ----------
// Pure functions: given already-fetched HTML pages, distill a call-ready
// dossier — what the business does, who runs it, how to reach them, and what
// to pitch. Kept network-free so it's unit-testable; the crawling lives in
// data.ts next to the other fetch helpers.

export type CompanyIntel = {
  summary: string | null; // plain-English "what they do" line
  services: string[]; // offerings pulled from nav / headings
  established: number | null; // "since 1998" style year
  serviceArea: string | null; // "serving Greater Austin" phrase
  people: string[]; // owner / founder names when stated
  emails: string[];
  phones: string[];
  socials: string[]; // profile URLs, one per platform
  angles: string[]; // pitchable defects + gaps for the call
  pagesCrawled: number;
};

// Nav labels that are navigation chrome, not services.
const NON_SERVICE_LINKS = [
  "home", "about", "about us", "contact", "contact us", "blog", "news",
  "gallery", "portfolio", "reviews", "testimonials", "faq", "faqs", "careers",
  "jobs", "privacy", "privacy policy", "terms", "sitemap", "login", "log in",
  "sign in", "search", "menu", "our team", "team", "locations", "shop", "cart",
];

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#0?39;|&rsquo;|&apos;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#0?39;|&rsquo;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .trim();
}

const SOCIAL_HOSTS: [RegExp, string][] = [
  [/facebook\.com\/(?!sharer|share|plugins)[A-Za-z0-9_.\-/%]{2,}/i, "facebook"],
  [/instagram\.com\/[A-Za-z0-9_.\-/%]{2,}/i, "instagram"],
  [/linkedin\.com\/(?:company|in)\/[A-Za-z0-9_.\-/%]{2,}/i, "linkedin"],
  [/(?:twitter|x)\.com\/(?!intent|share)[A-Za-z0-9_/%]{2,}/i, "x"],
  [/youtube\.com\/(?:@|channel\/|c\/|user\/)[A-Za-z0-9_.\-/%]{2,}/i, "youtube"],
  [/tiktok\.com\/@[A-Za-z0-9_.\-/%]{2,}/i, "tiktok"],
];

export function extractCompanyIntel(
  pages: { url: string; html: string }[],
  opts?: { https?: boolean },
): CompanyIntel {
  const capped = pages.map((p) => ({ url: p.url, html: (p.html ?? "").slice(0, 200_000) }));
  const all = capped.map((p) => p.html).join("\n");
  const home = capped[0]?.html ?? "";

  // Summary: meta description beats og:description beats first meaty paragraph.
  let summary: string | null = null;
  const meta =
    all.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{40,300})["']/i) ??
    all.match(/<meta[^>]+content=["']([^"']{40,300})["'][^>]+name=["']description["']/i) ??
    all.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{40,300})["']/i);
  if (meta) {
    summary = decodeEntities(meta[1]);
  } else {
    for (const p of capped) {
      const paras = [...p.html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => stripTags(m[1]));
      const meaty = paras.find((t) => t.length >= 80 && t.length <= 400 && !/cookie|javascript/i.test(t));
      if (meaty) { summary = meaty; break; }
    }
  }

  // Services: nav/menu link labels plus h2/h3 headings, minus chrome words.
  const labels = new Set<string>();
  const anchorTexts = [...all.matchAll(/<a[^>]*>([\s\S]*?)<\/a>/gi)].map((m) => stripTags(m[1]));
  const headingTexts = [...all.matchAll(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi)].map((m) => stripTags(m[1]));
  for (const t of [...anchorTexts, ...headingTexts]) {
    const clean = t.replace(/\s+/g, " ").trim();
    if (clean.length < 4 || clean.length > 42) continue;
    if (NON_SERVICE_LINKS.includes(clean.toLowerCase())) continue;
    if (/\d{3}/.test(clean)) continue; // phone-ish / address-ish
    if (!/^[A-Za-z][A-Za-z0-9&' \-/]+$/.test(clean)) continue;
    // Keep only labels that read like offerings.
    if (
      /(repair|install|service|cleaning|removal|design|remodel|landscap|roofing|plumbing|electric|hvac|heating|cooling|inspection|maintenance|grooming|catering|treatment|therapy|coaching|training|photography|marketing|towing|painting|flooring|fencing|welding|moving|storage|detailing|restoration|excavat|paving|septic|window|gutter|siding|masonry|concrete|drywall|insulation|pressure wash|junk|handyman|lawn|tree|pest|pool|spa|salon|barber|massage|nail|tattoo|dental|chiropract|veterinar|auto|tire|brake|oil change|locksmith|security|solar|garage door|appliance|computer|it support|web|seo|bookkeep|tax|legal|insurance|real estate|property)/i.test(clean)
    ) {
      labels.add(clean);
    }
    if (labels.size >= 8) break;
  }

  const text = stripTags(all);

  // Established year: earliest credible "since/established" year.
  const estYears = [...text.matchAll(/(?:since|established(?:\s+in)?|est\.?|founded(?:\s+in)?|serving[^.]{0,60}since)\s+((?:19|20)\d{2})/gi)]
    .map((m) => parseInt(m[1], 10))
    .filter((y) => y >= 1900 && y <= new Date().getFullYear());
  const established = estYears.length ? Math.min(...estYears) : null;

  // Service area: "serving X" / "proudly serving X".
  let serviceArea: string | null = null;
  const area = text.match(/(?:proudly\s+)?serving\s+(?:the\s+)?([A-Z][A-Za-z ,'&-]{3,60}?)(?:\s+(?:area|region|since|and surrounding|for)\b|[.!])/);
  if (area) serviceArea = area[1].replace(/\s+/g, " ").trim();

  // People: only names the site explicitly ties to ownership.
  const people = [...new Set(
    [...text.matchAll(/(?:[Oo]wner|[Ff]ounder|[Ff]ounded [Bb]y|[Oo]wned(?:\s+and\s+operated)?\s+[Bb]y|[Oo]wner[-\s][Oo]perator)[,:\s]+([A-Z][a-z]{2,15}\s[A-Z][a-z]{2,20})/g)]
      .map((m) => m[1]),
  )].slice(0, 2);

  // Contacts: every plausible email (junk-filtered) + every tel: link.
  const emails = [...new Set(
    (all.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [])
      .map((e) => e.toLowerCase())
      .filter((l) => l.length <= 60 && !/\.(png|jpe?g|gif|webp|svg|css|js|woff2?)$/.test(l) && !EMAIL_JUNK.some((j) => l.includes(j))),
  )].slice(0, 3);
  const phones = [...new Set(
    [...all.matchAll(/href=["']tel:([+0-9()\-.\s]{7,20})["']/gi)].map((m) => m[1].trim()),
  )].slice(0, 3);

  // Socials: one profile URL per platform.
  const socials: string[] = [];
  const seenPlatforms = new Set<string>();
  for (const href of [...all.matchAll(/href=["'](https?:\/\/[^"']+)["']/gi)].map((m) => m[1])) {
    for (const [re, platform] of SOCIAL_HOSTS) {
      if (seenPlatforms.has(platform)) continue;
      if (re.test(href)) {
        seenPlatforms.add(platform);
        socials.push(href.split("?")[0]);
      }
    }
  }

  // Pitch angles: homepage defects + gaps a web agency can sell against.
  const angles = [...analyzeSiteHtml(home, opts).issues];
  const lowerAll = all.toLowerCase();
  if (!/calendly|acuity|booksy|square\s*appointments|setmore|book\s*(?:now|online|an?\s+appointment)|schedule\s*(?:now|online)/i.test(all)) {
    angles.push("No online booking — customers can't schedule without calling");
  }
  if (!/testimonial|review|"ratingvalue"|stars?\s+on\s+google/i.test(lowerAll)) {
    angles.push("No testimonials or reviews shown — missing easy trust signals");
  }
  if (!/<form[\s>]/i.test(all)) {
    angles.push("No contact form — the only way in is phone or email");
  }

  return {
    summary,
    services: [...labels],
    established,
    serviceArea,
    people,
    emails,
    phones,
    socials,
    angles,
    pagesCrawled: capped.length,
  };
}

// Pick the internal pages worth a second fetch: about / services / contact.
export function pickResearchLinks(homeHtml: string, baseUrl: string, max = 3): string[] {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return [];
  }
  const wanted = /about|service|contact|team|our[-_]story|company|meet/i;
  const out: string[] = [];
  const seen = new Set<string>([base.href.replace(/\/$/, "")]);
  for (const m of (homeHtml ?? "").slice(0, 200_000).matchAll(/<a[^>]+href=["']([^"'#]+)["']/gi)) {
    let u: URL;
    try {
      u = new URL(m[1], base);
    } catch {
      continue;
    }
    if (u.hostname !== base.hostname) continue;
    if (!wanted.test(u.pathname)) continue;
    if (/\.(pdf|jpe?g|png|gif|webp|svg|zip|mp4)$/i.test(u.pathname)) continue;
    const key = (u.origin + u.pathname).replace(/\/$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(u.href);
    if (out.length >= max) break;
  }
  return out;
}

// ---------- Public site report card ----------
// The free "grade my website" tool on /report: a business owner types in their
// own URL and email, and gets an honest letter grade built from the same audit
// engine the reps use. Pure and deterministic so it's unit-testable — the
// server passes in the audit result, this just turns it into a grade.

export type SiteReportGrade = {
  score: number; // 0-100
  letter: "A" | "B" | "C" | "D" | "F";
  headline: string;
};

export function gradeLetter(score: number): SiteReportGrade["letter"] {
  if (score >= 90) return "A";
  if (score >= 75) return "B";
  if (score >= 60) return "C";
  if (score >= 40) return "D";
  return "F";
}

export function gradeSiteReport(
  status: "live" | "dead",
  issues: string[],
  domainExpired: boolean,
): SiteReportGrade {
  if (status === "dead") {
    return {
      score: 5,
      letter: "F",
      headline: domainExpired
        ? "Your domain has expired — your website is gone."
        : "Your website is down right now — customers can't see it.",
    };
  }
  // Live: start near-perfect and deduct per defect. Weights mirror how much
  // each one actually costs a local business in lost customers.
  let score = 95;
  for (const issue of issues) {
    const l = issue.toLowerCase();
    if (l.includes("placeholder")) score -= 50;
    else if (l.includes("mobile")) score -= 30;
    else if (l.includes("https")) score -= 20;
    else if (l.includes("built on")) score -= 15;
    else if (l.includes("copyright")) score -= 15;
    else score -= 10;
  }
  score = Math.max(15, Math.min(95, score));
  const letter = gradeLetter(score);
  const headline =
    letter === "A"
      ? "Looking sharp — your website is in good shape."
      : letter === "B"
        ? "Solid foundation, but a few things are costing you customers."
        : letter === "C"
          ? "Your website is working against you in a few important ways."
          : "Your website is likely losing you customers every week.";
  return { score, letter, headline };
}

// Plain-English explanation of what each defect costs the owner — shown on the
// public report card, so it has to speak to a business owner, not a developer.
export function explainSiteIssue(issue: string): string {
  const l = issue.toLowerCase();
  if (l.includes("placeholder"))
    return "Visitors see an empty placeholder instead of your business. Every click that lands here is wasted.";
  if (l.includes("mobile"))
    return "Most people find local businesses on their phone. A site that doesn't adapt to phones sends them straight to a competitor.";
  if (l.includes("https"))
    return "Browsers stamp your site \u201cNot secure\u201d before anyone sees it. That warning alone turns visitors away.";
  if (l.includes("built on"))
    return "Template builders look like templates. Customers comparing you against a professionally built competitor can tell.";
  if (l.includes("copyright"))
    return "An old copyright year signals nobody's home. Customers wonder if you're still in business.";
  return "This is hurting how your site performs for real customers.";
}

// ---------- Lead engine master switch ----------
// Barry paused all automatic lead intake on 2026-07-20 (team had enough to
// work), then turned it back ON on 2026-07-21 after the weak-lead prune
// thinned the book. This constant is only the DEFAULT — once an admin uses
// the Discover-page toggle, the app_settings row wins, so flipping intake
// on/off day-to-day is a UI click, not a deploy.
export const LEAD_ENGINE_PAUSED = false;
