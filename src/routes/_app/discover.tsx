import { createFileRoute, useRouter, useRouteContext } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import {
  discoverLeads,
  importDiscoveredLead,
  getDiscoveredPool,
  claimCompany,
  dismissDiscoveredLead,
  redistributePool,
  type DiscoveredLead,
  type PoolLead,
} from "../../lib/crm/data";
import { Button, Card, EmptyState, Input, PageHeader, Pill } from "../../components/crm/ui";
import { toast } from "../../components/crm/toast";
import { OPPORTUNITY_BAND_INFO, type OpportunityBand } from "../../lib/crm/constants";
import { useAutoConfig, useAutoStatus, setConfig } from "../../lib/crm/autodiscover";
import { RadarScope } from "../../components/crm/radar";
import { USStatePicker, stateAbbrFromArea, type USState } from "../../components/crm/state-picker";

export const Route = createFileRoute("/_app/discover")({
  component: DiscoverPage,
  loader: async () => ({ pool: (await getDiscoveredPool()).leads }),
});

// Quick-pick business types that fill the search box in one tap.
const QUICK_TYPES = [
  "Restaurants",
  "Cafes",
  "Dentists",
  "Law firms",
  "Real estate agents",
  "Contractors",
  "Roofers",
  "Plumbers",
  "Salons",
  "Gyms",
  "Auto repair",
  "Chiropractors",
];

// Niches the always-on auto-sweep can't reach well (they hide under generic OSM
// tags), but which are strong web-design prospects: cleaning/janitorial has the
// highest no-website rate, and elective/cash-pay medical has the budgets. These
// presets let a rep mine them by hand.
const NICHE_TYPES = [
  "Cleaning services",
  "Janitorial",
  "Med spas",
  "Weight-loss clinics",
  "IV therapy",
  "Aesthetics clinic",
];

// One-tap combos aimed where the money is: industries that pay real budgets
// for their web presence. Comma-separated types sweep together in one query.
const HIGH_BUDGET_COMBOS = [
  "Med spas, aesthetics clinic",
  "Law firms",
  "Dentists, orthodontists",
  "Roofers, HVAC, plumbers",
  "Real estate agents",
  "Chiropractors, dermatologists",
];

function ScoreBadge({ score, band }: { score: number; band: OpportunityBand }) {
  const color = OPPORTUNITY_BAND_INFO[band].color;
  return (
    <div
      className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-full border-2 font-bold"
      style={{ borderColor: color, color }}
    >
      <span className="text-base leading-none">{score}</span>
    </div>
  );
}

function LeadCard({
  lead,
  imported,
  busy,
  onImport,
}: {
  lead: DiscoveredLead;
  imported: boolean;
  busy: boolean;
  onImport: (l: DiscoveredLead) => void;
}) {
  const inCrm = lead.already_in_crm || imported;
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <ScoreBadge score={lead.score} band={lead.band as OpportunityBand} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold text-bone">{lead.name}</span>
            {!lead.website ? (
              <Pill tone="ok">No website</Pill>
            ) : lead.website_dead === true ? (
              <Pill tone="warn">Site is down</Pill>
            ) : lead.website_issues.length > 0 ? (
              <Pill tone="warn">
                Bad site · {lead.website_issues.length} issue{lead.website_issues.length === 1 ? "" : "s"}
              </Pill>
            ) : lead.website_dead === false ? (
              <Pill tone="neutral">Site live</Pill>
            ) : (
              <Pill tone="neutral">Has site</Pill>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-mute">
            {lead.industry ? <span>{lead.industry}</span> : null}
            {lead.city ? <span className="text-faint">· {lead.city}</span> : null}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {lead.reasons.slice(0, 3).map((r, i) => (
              <span key={i} className="rounded-md bg-surface-2 px-2 py-0.5 text-[11px] text-mute">
                {r}
              </span>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-faint">
              <span>{lead.phone || "No phone found"}</span>
              {lead.email ? (
                <span className="truncate text-emerald-400/90" title={lead.email}>
                  ✉ {lead.email}
                </span>
              ) : null}
            </span>
            {inCrm ? (
              <Pill tone="signal">{imported ? "Imported ✓" : "Already in CRM"}</Pill>
            ) : (
              <Button size="sm" disabled={busy} onClick={() => onImport(lead)}>
                Import to pipeline
              </Button>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

// A lead sitting in the open pool (auto-discovered, unclaimed). Reps claim it —
// which hands them the company + its open "To Call" deal — or wave it off as not
// a fit, which quietly archives it out of the pool.
function PoolLeadCard({
  lead,
  busy,
  onClaim,
  onDismiss,
}: {
  lead: PoolLead;
  busy: boolean;
  onClaim: (l: PoolLead) => void;
  onDismiss: (l: PoolLead) => void;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <ScoreBadge score={lead.score} band={lead.band as OpportunityBand} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold text-bone">{lead.name}</span>
            {!lead.website ? <Pill tone="ok">No website</Pill> : <Pill tone="neutral">Has site</Pill>}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-mute">
            {lead.industry ? <span>{lead.industry}</span> : null}
            {lead.city ? <span className="text-faint">· {lead.city}</span> : null}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {lead.reasons.slice(0, 3).map((r, i) => (
              <span key={i} className="rounded-md bg-surface-2 px-2 py-0.5 text-[11px] text-mute">
                {r}
              </span>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-faint">{lead.phone || "No phone found"}</span>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => onDismiss(lead)}
              >
                Not a fit
              </Button>
              <Button size="sm" disabled={busy} onClick={() => onClaim(lead)}>
                Claim
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

// ==================== Live scan stream ====================
// A decorative "scanning now" ticker beside the radar. While the engine is on it
// rolls candidate business names past — the ones the sweep is looking at right
// now — so the page reads as genuinely live. This is atmosphere, not data: the
// real, actionable finds land in the claimable pool below. The first entry is
// pinned to Brady Boak, our first-ever radar find and the reason this thing exists.
type StreamItem = { key: number; name: string; trade: string; city: string; band: OpportunityBand };

const NAME_PREFIX = [
  "Coastal", "Summit", "Ironwood", "Blue Ridge", "Riverside", "Northgate", "Evergreen",
  "Lakeside", "Redline", "Granite", "Harbor", "Pioneer", "Maple", "Cedar", "Sterling",
  "Vanguard", "Copper", "Highland", "Union", "Liberty", "Frontier", "Meridian", "Cobalt",
  "Timber", "Anchor", "Bayside", "Crestline", "Oakfield", "Silverline", "Trueline",
];
const NAME_TRADE = [
  "Roofing", "Plumbing", "Electric", "HVAC & Air", "Contracting", "Landscaping",
  "Auto Repair", "Dental", "Veterinary", "Chiropractic", "Accounting", "Law Group",
  "Realty", "Salon", "Fitness", "Painting", "Masonry", "Remodeling",
];
const NAME_SUFFIX = ["Co.", "LLC", "Group", "& Sons", "Services", "Partners", "Inc.", ""];
const CITY_BANK = [
  "Fort Myers", "Naples", "Cape Coral", "Tampa", "Sarasota", "Savannah", "Mobile",
  "Baton Rouge", "Charleston", "Knoxville", "Little Rock", "Austin", "Tulsa", "Louisville",
  "Richmond", "Trenton", "Buffalo", "Portland", "Bangor", "Toledo", "Grand Rapids",
  "Toronto", "Ottawa", "Vancouver", "Calgary", "Winnipeg", "Halifax", "Moncton",
];
const STREAM_BANDS: OpportunityBand[] = ["hot", "hot", "hot", "warm", "warm", "cool"];

const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];

function makeStreamItem(key: number, area: string | null, trade: string | null): StreamItem {
  const suffix = pick(NAME_SUFFIX);
  const name = `${pick(NAME_PREFIX)} ${trade ?? pick(NAME_TRADE)}${suffix ? " " + suffix : ""}`;
  const city = (area && area.replace(/,\s*(USA|Canada)$/i, "").trim()) || pick(CITY_BANK);
  return { key, name, trade: trade ?? pick(NAME_TRADE), city, band: pick(STREAM_BANDS) };
}

// The pinned first ping. Brady Boak — a one-man contractor with no website — was
// the very first lead the radar ever surfaced, so he leads every scan.
const BRADY: StreamItem = {
  key: 0,
  name: "Brady Boak",
  trade: "Contracting",
  city: "Fort Myers",
  band: "hot",
};

function ScanStream({
  on,
  paused,
  currentType,
  currentArea,
}: {
  on: boolean;
  paused: boolean;
  currentType: string | null;
  currentArea: string | null;
}) {
  const [items, setItems] = useState<StreamItem[]>([BRADY]);
  const counter = useRef(1);

  useEffect(() => {
    if (!on || paused) return;
    const tick = () => {
      const it = makeStreamItem(counter.current++, currentArea, currentType);
      setItems((prev) => [it, ...prev].slice(0, 7));
    };
    // First ping shortly after switch-on, then a steady roll.
    const first = setTimeout(tick, 600);
    const iv = setInterval(tick, 2200);
    return () => {
      clearTimeout(first);
      clearInterval(iv);
    };
  }, [on, paused, currentType, currentArea]);

  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-faint">
          Live scan
        </span>
        {on && !paused ? (
          <span className="flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-1.5 w-1.5 animate-ping rounded-full bg-signal opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-signal" />
          </span>
        ) : null}
      </div>
      <div className="relative h-[248px] overflow-hidden rounded-lg border border-line/60 bg-sunk/40">
        {on ? (
          <ul className="flex flex-col">
            {items.map((it) => {
              const color = OPPORTUNITY_BAND_INFO[it.band].color;
              return (
                <li
                  key={it.key}
                  className="flex items-center gap-2.5 border-b border-line/40 px-3 py-2"
                  style={{ animation: "nx-blip-in 420ms ease-out both" }}
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}` }}
                  />
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-bone">
                    {it.name}
                  </span>
                  <span className="hidden shrink-0 text-[11px] text-mute sm:inline">{it.trade}</span>
                  <span className="shrink-0 font-mono text-[10px] text-faint">{it.city}</span>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="flex h-full items-center justify-center px-4 text-center text-xs text-faint">
            Start the scan to watch leads come in live.
          </div>
        )}
        {/* fade the bottom so the stream reads as scrolling into view */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-sunk/70 to-transparent" />
      </div>
    </div>
  );
}

// ==================== Live scanner hero ====================
// The whole page leads with this: one big Start/Stop button, the radar, the live
// scan stream, and the region picker. Flip it on and the engine (mounted app-wide
// in the layout) keeps mining no-website businesses into the pool while the CRM
// is open.
function ScannerHero({ area }: { area: string }) {
  const config = useAutoConfig();
  const st = useAutoStatus();

  const selectedAbbr = stateAbbrFromArea(config.area);
  const targetLabel = config.area.replace(/,\s*(USA|Canada)$/i, "").trim();

  // Clicking a region drops the radar there and (if the scan is running) hops it
  // to that region immediately.
  function pickState(s: USState) {
    const wasOn = config.on;
    setConfig({ on: config.on, area: `${s.name}, ${s.country}` });
    if (wasOn) {
      toast(`Radar moving to ${s.name} — it'll sweep there, then roll on.`, "success");
    } else {
      toast(`${s.name} locked in. Hit Start scan to go live.`, "info");
    }
  }

  function toggle() {
    if (!config.on) {
      const a = (config.area || area).trim();
      if (!a) {
        toast("Pick a state or province below first.", "info");
        return;
      }
      setConfig({ on: true, area: a });
      toast("Scan is live — new no-website leads will roll into the pool.", "success");
    } else {
      setConfig({ on: false, area: config.area });
      toast("Scan stopped.", "info");
    }
  }

  const live = config.on && !st.paused;

  return (
    <Card className="overflow-hidden p-0">
      {/* Top bar: the one button. */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line/60 bg-gradient-to-r from-signal-soft/40 to-transparent px-4 py-3 sm:px-5">
        <div className="flex items-center gap-2.5">
          <span
            className={
              "flex h-2.5 w-2.5 rounded-full " + (live ? "bg-signal" : "bg-faint")
            }
            style={live ? { boxShadow: "0 0 8px rgba(249,83,30,0.9)" } : undefined}
          >
            {live ? (
              <span className="absolute inline-flex h-2.5 w-2.5 animate-ping rounded-full bg-signal opacity-60" />
            ) : null}
          </span>
          <div>
            <div className="font-display text-sm font-extrabold uppercase tracking-wide text-bone">
              Lead radar
            </div>
            <div className="text-[11px] text-mute">
              {st.paused ? (
                <span className="text-amber-300">
                  Session limit — {st.imported} found. Reload later to keep going.
                </span>
              ) : config.on ? (
                st.currentType ? (
                  <>
                    Sweeping <span className="text-signal">{st.currentType}</span>
                    {st.currentArea ? <> · {st.currentArea}</> : null} · {st.imported} found ·{" "}
                    {st.assigned} auto-assigned
                  </>
                ) : (
                  <>Warming up… · {st.imported} found</>
                )
              ) : (
                <>Idle · target {targetLabel || "none set"}</>
              )}
            </div>
          </div>
        </div>
        <Button
          variant={config.on ? "outline" : "primary"}
          onClick={toggle}
          className="min-w-[140px] px-5 py-2.5 text-sm"
        >
          {config.on ? "Stop scan" : "Start scan"}
        </Button>
      </div>

      {/* Body: radar + live stream side by side. */}
      <div className="grid grid-cols-1 gap-5 p-4 sm:px-5 md:grid-cols-[260px_1fr] md:items-start">
        <div className="justify-self-center">
          <RadarScope
            on={config.on}
            currentType={st.currentType}
            currentArea={st.currentArea}
            progress={st.progress}
            imported={st.imported}
            paused={st.paused}
          />
        </div>
        <ScanStream
          on={config.on}
          paused={st.paused}
          currentType={st.currentType}
          currentArea={st.currentArea}
        />
      </div>

      {/* Region picker: US states + Canadian provinces. */}
      <div className="border-t border-line/60 px-4 py-3 sm:px-5">
        <div className="mb-2 flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-faint">
            Target region
          </span>
          <span className="text-[11px] text-mute">
            — pick where to start; it mines the whole state/province, then rolls on
            {config.on && st.currentArea ? (
              <>
                {" "}· now on <span className="text-signal">{st.currentArea}</span>
              </>
            ) : null}
          </span>
        </div>
        <USStatePicker
          selected={selectedAbbr}
          scanning={config.on ? stateAbbrFromArea(st.currentArea) : null}
          onPick={pickState}
        />
        {st.lastError ? (
          <div className="mt-2 text-[11px] text-faint">Last hiccup: {st.lastError}</div>
        ) : null}
      </div>
    </Card>
  );
}

function DiscoverPage() {
  const router = useRouter();
  const { pool } = Route.useLoaderData();
  const savedArea = useAutoConfig().area;
  const [poolBusyId, setPoolBusyId] = useState<string | null>(null);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [businessType, setBusinessType] = useState("");
  const [area, setArea] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const seeded = useRef(false);
  // Seed the area box once (after client hydrate): a previously saved center if
  // there is one, otherwise SWFL as a sensible starting point. Never clobbers
  // anything the user has started typing.
  useEffect(() => {
    if (!seeded.current && !area) {
      setArea(savedArea || "Fort Myers, FL");
      seeded.current = true;
    }
  }, [savedArea, area]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leads, setLeads] = useState<DiscoveredLead[]>([]);
  const [imported, setImported] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);

  async function search(type?: string) {
    const q = (type ?? businessType).trim();
    if (!q) {
      toast("Type a business type to search for.", "info");
      return;
    }
    if (!area.trim()) {
      toast("Add a city or area — e.g. Springfield, IL.", "info");
      return;
    }
    if (type) setBusinessType(type);
    setLoading(true);
    setError(null);
    try {
      const res = await discoverLeads({ data: { businessType: q, area: area.trim(), limit: 20 } });
      setSearched(true);
      if (!res.ok) {
        setError(res.error ?? "Search failed.");
        setLeads([]);
      } else {
        setLeads(res.leads);
      }
    } catch {
      setError("Something went wrong reaching the search service.");
      setLeads([]);
    } finally {
      setLoading(false);
    }
  }

  async function importLead(l: DiscoveredLead) {
    setBusyId(l.place_id);
    try {
      const res = await importDiscoveredLead({
        data: {
          name: l.name,
          industry: l.industry,
          website: l.website,
          phone: l.phone,
          email: l.email,
          city: l.city,
        },
      });
      if (res.ok) {
        setImported((prev) => new Set(prev).add(l.place_id));
        toast(res.duplicate ? "Already in your CRM — linked up." : "Added to the open pool — claim it above.", "success");
        router.invalidate();
      } else {
        toast("Couldn't import that one.", "error");
      }
    } catch {
      toast("Something went wrong importing that lead.", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function claimLead(l: PoolLead) {
    setPoolBusyId(l.id);
    try {
      const res = await claimCompany({ data: { company_id: l.id } });
      if (res.ok) {
        setRemoved((prev) => new Set(prev).add(l.id));
        toast(`${l.name} is yours — it's in your pipeline now.`, "success");
        router.invalidate();
      } else {
        toast(res.error ?? "Couldn't claim that one.", "error");
        router.invalidate();
      }
    } catch {
      toast("Something went wrong claiming that lead.", "error");
    } finally {
      setPoolBusyId(null);
    }
  }

  async function dismissLead(l: PoolLead) {
    setPoolBusyId(l.id);
    try {
      const res = await dismissDiscoveredLead({ data: { company_id: l.id } });
      if (res.ok) {
        setRemoved((prev) => new Set(prev).add(l.id));
        toast(`Cleared ${l.name} from the pool.`, "info");
        router.invalidate();
      } else {
        toast(res.error ?? "Couldn't remove that one.", "error");
        router.invalidate();
      }
    } catch {
      toast("Something went wrong removing that lead.", "error");
    } finally {
      setPoolBusyId(null);
    }
  }

  const visiblePool = pool.filter((l) => !removed.has(l.id));

  // Admin-only: sweep the whole pool at once — phone leads go to reps, the rest
  // get junked. Gated on role so reps never see the button.
  const { user } = useRouteContext({ from: "/_app" }) as { user?: { role?: string } };
  const isAdmin = user?.role === "admin";
  const [distributing, setDistributing] = useState(false);

  async function distributePool() {
    if (
      !confirm(
        `Distribute all ${visiblePool.length} pooled leads? Ones with a phone number go to your reps; ones with no phone are moved to the trash (recoverable).`,
      )
    )
      return;
    setDistributing(true);
    try {
      const res = await redistributePool();
      if (res.ok) {
        toast(`Assigned ${res.assigned} to reps · junked ${res.junked} with no phone.`, "success");
        router.invalidate();
      } else {
        toast("Couldn't distribute the pool.", "error");
      }
    } catch {
      toast("Something went wrong distributing the pool.", "error");
    } finally {
      setDistributing(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Discover leads"
        subtitle="Flip on the radar and watch no-website businesses roll in — the ones that need exactly what we sell. Free, no setup."
      />

      <ScannerHero area={area} />

      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-bone">Fresh leads — claim yours</h2>
            <p className="mt-0.5 text-xs text-mute">
              No-website businesses the radar has dropped into the open pool. Claiming one moves it
              into your pipeline as a “To Call”. First come, first served.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isAdmin && visiblePool.length > 0 ? (
              <Button variant="outline" onClick={distributePool} disabled={distributing}>
                {distributing ? "Distributing…" : "Distribute to reps"}
              </Button>
            ) : null}
            {visiblePool.length > 0 ? (
              <Pill tone="signal">{visiblePool.length} waiting</Pill>
            ) : null}
          </div>
        </div>
        {visiblePool.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {visiblePool.map((l) => (
              <PoolLeadCard
                key={l.id}
                lead={l}
                busy={poolBusyId === l.id}
                onClaim={claimLead}
                onDismiss={dismissLead}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            title="No unclaimed leads right now"
            hint="Hit Start scan above, or run a manual search below — new finds land here for the team to claim."
          />
        )}
      </Card>

      {/* Manual search, tucked away so the page stays visual-first. */}
      <Card className="p-0">
        <button
          type="button"
          onClick={() => setManualOpen((v) => !v)}
          aria-expanded={manualOpen}
          className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
        >
          <div>
            <span className="text-sm font-semibold text-bone">Search by hand</span>
            <span className="ml-2 text-xs text-mute">Target a specific type + city yourself</span>
          </div>
          <span className="font-mono text-xs text-faint">{manualOpen ? "Hide ▲" : "Open ▼"}</span>
        </button>

        {manualOpen ? (
          <div className="border-t border-line/60 p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-mute">Business type</span>
                <Input
                  value={businessType}
                  placeholder="e.g. dentists — or combos: roofers, hvac, plumbers"
                  onChange={(e) => setBusinessType(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && search()}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-mute">City / area</span>
                <Input
                  value={area}
                  placeholder="e.g. Springfield, IL"
                  onChange={(e) => setArea(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && search()}
                />
              </label>
              <Button onClick={() => search()} disabled={loading}>
                {loading ? "Searching…" : "Find leads"}
              </Button>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {QUICK_TYPES.map((t) => (
                <button
                  key={t}
                  onClick={() => search(t)}
                  disabled={loading}
                  className="rounded-full bg-surface-2 px-2.5 py-1 text-xs text-mute hover:text-bone disabled:opacity-50"
                >
                  {t}
                </button>
              ))}
            </div>

            {/* High-budget hunts: one-tap combos for the industries that pay. */}
            <div className="mt-3 border-t border-line/60 pt-3">
              <div className="mb-1.5 flex items-center gap-1.5">
                <span className="font-mono text-[10px] uppercase tracking-wider text-faint">
                  Where the money is
                </span>
                <span className="text-[11px] text-faint">
                  — industries with real web budgets; combos sweep together in one search
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {HIGH_BUDGET_COMBOS.map((t) => (
                  <button
                    key={t}
                    onClick={() => search(t)}
                    disabled={loading}
                    className="rounded-full border border-signal/30 bg-signal-soft px-2.5 py-1 text-xs text-signal hover:bg-signal-soft/70 disabled:opacity-50"
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            {/* Hard-to-reach niches the auto-sweep can't mine well — search by hand. */}
            <div className="mt-3 border-t border-line/60 pt-3">
              <div className="mb-1.5 flex items-center gap-1.5">
                <span className="font-mono text-[10px] uppercase tracking-wider text-faint">
                  Hard-to-find niches
                </span>
                <span className="text-[11px] text-faint">— the auto-sweep skips these; mine them by hand</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {NICHE_TYPES.map((t) => (
                  <button
                    key={t}
                    onClick={() => search(t)}
                    disabled={loading}
                    className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-300 hover:bg-amber-500/20 disabled:opacity-50"
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            {error ? (
              <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-300">
                <span className="font-semibold">Search hit a snag.</span> {error}
              </div>
            ) : null}

            {leads.length > 0 ? (
              <div className="mt-4 space-y-3">
                <div className="text-xs text-faint">
                  {leads.length} found · ranked by fit. Importing drops a lead into the open pool as a
                  “To Call”, ready for anyone to claim.
                </div>
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {leads.map((l) => (
                    <LeadCard
                      key={l.place_id}
                      lead={l}
                      imported={imported.has(l.place_id)}
                      busy={busyId === l.place_id}
                      onImport={importLead}
                    />
                  ))}
                </div>
              </div>
            ) : searched && !loading && !error ? (
              <div className="mt-4">
                <EmptyState
                  title="No businesses found"
                  hint="Try a broader type (like “restaurants”) or double-check the city spelling."
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </Card>
    </div>
  );
}
