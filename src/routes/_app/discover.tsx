import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import {
  discoverLeads,
  importDiscoveredLead,
  getDiscoveredPool,
  claimCompany,
  dismissDiscoveredLead,
  type DiscoveredLead,
  type PoolLead,
} from "../../lib/crm/data";
import { Button, Card, EmptyState, Input, PageHeader, Pill } from "../../components/crm/ui";
import { toast } from "../../components/crm/toast";
import { OPPORTUNITY_BAND_INFO, type OpportunityBand } from "../../lib/crm/constants";
import { useAutoConfig, useAutoStatus, setConfig } from "../../lib/crm/autodiscover";
import { RadarScope } from "../../components/crm/radar";

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
            <span className="text-xs text-faint">{lead.phone || "No phone found"}</span>
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

// The always-on prospecting panel: flip it on with an area and the engine (mounted
// app-wide in the layout) keeps importing new no-website businesses while the CRM
// is open.
function AutoPanel({ area }: { area: string }) {
  const config = useAutoConfig();
  const st = useAutoStatus();

  function toggle() {
    if (!config.on) {
      const a = area.trim();
      if (!a) {
        toast("Type a city or area first, then switch auto-discover on.", "info");
        return;
      }
      setConfig({ on: true, area: a });
      toast("Auto-discover is on — it'll keep finding leads while the CRM is open.", "success");
    } else {
      setConfig({ on: false, area: config.area });
      toast("Auto-discover paused.", "info");
    }
  }

  return (
    <Card className="overflow-hidden p-0">
      <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-[1fr_auto] sm:items-center">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-bone">Auto-discover</span>
            {config.on ? <Pill tone="ok">On</Pill> : <Pill tone="neutral">Off</Pill>}
            <button
              onClick={toggle}
              role="switch"
              aria-checked={config.on}
              className={
                "relative ml-1 h-6 w-11 shrink-0 rounded-full transition-colors " +
                (config.on ? "bg-signal" : "bg-surface-2")
              }
            >
              <span
                className={
                  "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all " +
                  (config.on ? "left-[22px]" : "left-0.5")
                }
              />
            </button>
          </div>
          <p className="mt-1.5 text-xs text-mute">
            Radar scan out from{" "}
            <span className="text-bone">{config.on ? config.area : area.trim() || "your center"}</span>{" "}
            — starts tight, then rings wider each pass. Most new finds (~90%) are auto-assigned
            round-robin to the team; the rest land in the claimable pool below.
          </p>

          <div className="mt-3 text-xs">
            {st.paused ? (
              <span className="text-amber-300">
                Reached this session's limit — {st.imported} found ({st.assigned} auto-assigned).
                Reload the CRM later to keep going.
              </span>
            ) : config.on ? (
              st.currentType ? (
                <span className="text-mute">
                  <span className="text-signal">Scanning {st.currentType}…</span> · ~{st.radiusKm} km
                  out · {st.imported} found · {st.assigned} auto-assigned
                </span>
              ) : (
                <span className="text-mute">
                  Starting up… · {st.imported} found · {st.assigned} auto-assigned
                </span>
              )
            ) : (
              <span className="text-faint">Flip it on to start the sweep.</span>
            )}
            {st.lastError ? <div className="mt-1 text-faint">Last hiccup: {st.lastError}</div> : null}
          </div>
        </div>

        <div className="w-full justify-self-center sm:w-[260px]">
          <RadarScope
            on={config.on}
            currentType={st.currentType}
            radiusKm={st.radiusKm}
            imported={st.imported}
            paused={st.paused}
          />
        </div>
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

  return (
    <div className="space-y-5">
      <PageHeader
        title="Discover leads"
        subtitle="Find real local businesses to pitch — the ones with no website yet are your best bets. Free, no setup."
      />

      <AutoPanel area={area} />

      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-bone">Fresh leads — claim yours</h2>
            <p className="mt-0.5 text-xs text-mute">
              No-website businesses the radar has dropped into the open pool. Claiming one moves it
              into your pipeline as a “To Call”. First come, first served.
            </p>
          </div>
          {visiblePool.length > 0 ? (
            <Pill tone="signal">{visiblePool.length} waiting</Pill>
          ) : null}
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
            hint="Flip on auto-discover above, or run a manual search below — new finds land here for the team to claim."
          />
        )}
      </Card>

      <Card className="p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-mute">Business type</span>
            <Input
              value={businessType}
              placeholder="e.g. dentists"
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
      </Card>

      {error ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-300">
          <span className="font-semibold">Search hit a snag.</span> {error}
        </div>
      ) : null}

      {leads.length > 0 ? (
        <>
          <div className="text-xs text-faint">
            {leads.length} found · ranked by fit. Importing drops a lead into the open pool as a “To
            Call”, ready for anyone to claim.
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
        </>
      ) : searched && !loading && !error ? (
        <EmptyState
          title="No businesses found"
          hint="Try a broader type (like “restaurants”) or double-check the city spelling."
        />
      ) : !searched ? (
        <EmptyState
          title="Search to find new leads"
          hint="Pick a business type and city above — or tap one of the quick options."
        />
      ) : null}
    </div>
  );
}
