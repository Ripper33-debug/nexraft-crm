import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { discoverLeads, importDiscoveredLead, type DiscoveredLead } from "../../lib/crm/data";
import { Button, Card, EmptyState, Input, PageHeader, Pill } from "../../components/crm/ui";
import { toast } from "../../components/crm/toast";
import { OPPORTUNITY_BAND_INFO, type OpportunityBand } from "../../lib/crm/constants";

export const Route = createFileRoute("/_app/discover")({
  component: DiscoverPage,
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

function Stars({ rating, reviews }: { rating: number | null; reviews: number | null }) {
  if (!rating) return <span className="text-xs text-faint">No reviews yet</span>;
  return (
    <span className="text-xs text-mute">
      <span className="text-amber-400">{rating.toFixed(1)}★</span>
      {reviews ? <span className="text-faint"> · {reviews} reviews</span> : null}
    </span>
  );
}

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
          <div className="mt-1">
            <Stars rating={lead.rating} reviews={lead.reviews} />
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

function DiscoverPage() {
  const router = useRouter();
  const [businessType, setBusinessType] = useState("");
  const [area, setArea] = useState("");
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [noKey, setNoKey] = useState(false);
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
    if (type) setBusinessType(type);
    setLoading(true);
    setError(null);
    setNoKey(false);
    try {
      const res = await discoverLeads({ data: { businessType: q, area: area.trim() || null, limit: 20 } });
      setSearched(true);
      if (!res.ok) {
        if (res.error === "NO_KEY") setNoKey(true);
        else setError(res.error ?? "Search failed.");
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
        toast(res.duplicate ? "Already in your CRM — linked up." : "Imported into your pipeline.", "success");
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

  return (
    <div className="space-y-5">
      <PageHeader
        title="Discover leads"
        subtitle="Find real local businesses to pitch — the ones with no website yet are your best bets."
      />

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

      {noKey ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-300">
          <span className="font-semibold">Lead discovery is off.</span> To turn it on, add a{" "}
          <code className="rounded bg-black/30 px-1">GOOGLE_PLACES_API_KEY</code> in your Vercel project
          settings (Environment Variables), then redeploy. I'll walk you through getting one.
        </div>
      ) : null}

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
      ) : searched && !loading && !noKey && !error ? (
        <EmptyState
          title="No businesses found"
          hint="Try a broader type (like “restaurants”) or a different city."
        />
      ) : !searched && !noKey ? (
        <EmptyState
          title="Search to find new leads"
          hint="Pick a business type and city above — or tap one of the quick options."
        />
      ) : null}
    </div>
  );
}
