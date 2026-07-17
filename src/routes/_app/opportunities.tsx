import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { getCompanies, getContacts, getUsers, claimCompany } from "../../lib/crm/data";
import {
  Button,
  Card,
  EmptyState,
  PageHeader,
  Pill,
  OwnerChip,
  SummaryCard,
} from "../../components/crm/ui";
import { toast } from "../../components/crm/toast";
import {
  opportunityScore,
  OPPORTUNITY_BAND_INFO,
  relativeTime,
  type OpportunityBand,
} from "../../lib/crm/constants";

type Row = Record<string, unknown>;

export const Route = createFileRoute("/_app/opportunities")({
  loader: async ({ context }) => {
    const [companies, contacts, users] = await Promise.all([
      getCompanies(),
      getContacts(),
      getUsers(),
    ]);
    const me = (context as { user?: { id: string; role: string; name: string; email: string } }).user ?? null;
    return { companies, contacts, users, me };
  },
  component: OpportunitiesPage,
});

type Scored = {
  company: Row;
  score: number;
  band: OpportunityBand;
  reasons: string[];
  ownerId: string | null;
  ownerName: string | null;
};

type Filter = "all" | "pool" | "mine" | "hot";

function bandDot(band: OpportunityBand) {
  const info = OPPORTUNITY_BAND_INFO[band];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
      style={{ backgroundColor: `${info.color}22`, color: info.color }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: info.color }} />
      {info.label}
    </span>
  );
}

function ScoreRing({ score, band }: { score: number; band: OpportunityBand }) {
  const color = OPPORTUNITY_BAND_INFO[band].color;
  return (
    <div
      className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-full border-2 font-bold"
      style={{ borderColor: color, color }}
    >
      <span className="text-lg leading-none">{score}</span>
      <span className="text-[9px] font-medium uppercase tracking-wide text-mute">score</span>
    </div>
  );
}

function OppCard({
  item,
  meId,
  onClaim,
  busy,
}: {
  item: Scored;
  meId: string | null;
  onClaim: (id: string) => void;
  busy: boolean;
}) {
  const c = item.company;
  const id = c.id as string;
  const isMine = item.ownerId && item.ownerId === meId;
  const isPool = !item.ownerId;
  return (
    <Card className="p-4">
      <div className="flex items-start gap-4">
        <ScoreRing score={item.score} band={item.band} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold text-bone">{(c.name as string) || "Untitled"}</span>
            {bandDot(item.band)}
            {(c.industry as string) ? (
              <span className="text-xs text-mute">{c.industry as string}</span>
            ) : null}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {item.reasons.slice(0, 4).map((r, i) => (
              <span
                key={i}
                className="rounded-md bg-surface-2 px-2 py-0.5 text-[11px] text-mute"
              >
                {r}
              </span>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-faint">
              {isPool ? (
                <span className="text-signal">In the open pool</span>
              ) : (
                <OwnerChip name={item.ownerName} />
              )}
              {(c.created_at as string) ? (
                <span className="ml-2 text-faint">· added {relativeTime(c.created_at as string)}</span>
              ) : null}
            </span>
            <div>
              {isMine ? (
                <Pill tone="ok">Yours</Pill>
              ) : isPool ? (
                <Button size="sm" disabled={busy} onClick={() => onClaim(id)}>
                  Claim
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

function OpportunitiesPage() {
  const { companies, contacts, users, me } = Route.useLoaderData();
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const [busyId, setBusyId] = useState<string | null>(null);

  // Which companies have an email on file (via their contacts)?
  const hasEmail = useMemo(() => {
    const set = new Set<string>();
    for (const ct of contacts as Row[]) {
      if ((ct.email as string) && (ct.company_id as string)) set.add(ct.company_id as string);
    }
    return set;
  }, [contacts]);

  const ownerName = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of users as Row[]) m.set(u.id as string, u.name as string);
    return m;
  }, [users]);

  // Score every live, not-yet-won company.
  const scored = useMemo<Scored[]>(() => {
    return (companies as Row[])
      .filter((c) => c.call_outcome !== "signed")
      .map((c) => {
        const ownerId = (c.owner_id as string) ?? null;
        const res = opportunityScore({
          source: c.source as string | null,
          callOutcome: c.call_outcome as string | null,
          industry: c.industry as string | null,
          hasPhone: Boolean(c.phone),
          hasEmail: hasEmail.has(c.id as string),
          createdAt: c.created_at as string | null,
        });
        return {
          company: c,
          score: res.score,
          band: res.band,
          reasons: res.reasons,
          ownerId,
          ownerName: ownerId ? ownerName.get(ownerId) ?? (c.owner_name as string) ?? null : null,
        };
      })
      .sort((a, b) => b.score - a.score);
  }, [companies, hasEmail, ownerName]);

  const counts = useMemo(() => {
    let hot = 0;
    let warm = 0;
    let pool = 0;
    for (const s of scored) {
      if (s.band === "hot") hot++;
      else if (s.band === "warm") warm++;
      if (!s.ownerId) pool++;
    }
    return { hot, warm, pool };
  }, [scored]);

  const visible = useMemo(() => {
    return scored.filter((s) => {
      if (filter === "pool") return !s.ownerId;
      if (filter === "mine") return s.ownerId && me && s.ownerId === me.id;
      if (filter === "hot") return s.band === "hot";
      return true;
    });
  }, [scored, filter, me]);

  async function claim(id: string) {
    setBusyId(id);
    try {
      const res = await claimCompany({ data: { company_id: id } });
      if (res.ok) {
        toast(res.alreadyMine ? "Already yours." : "Claimed — it's in your pipeline now.", "success");
        router.invalidate();
      } else {
        toast(res.error ?? "Couldn't claim that one.", "error");
      }
    } catch {
      toast("Something went wrong claiming that lead.", "error");
    } finally {
      setBusyId(null);
    }
  }

  const tabs: { key: Filter; label: string }[] = [
    { key: "all", label: `All (${scored.length})` },
    { key: "hot", label: `Hot (${counts.hot})` },
    { key: "pool", label: `Open pool (${counts.pool})` },
    { key: "mine", label: "Mine" },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Opportunities"
        subtitle="Every company scored on how likely it is to close — grab the hot ones before anyone else."
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryCard label="Hot leads" value={String(counts.hot)} accent hint="Score 65+" />
        <SummaryCard label="Warm leads" value={String(counts.warm)} hint="Score 40–64" />
        <SummaryCard label="Up for grabs" value={String(counts.pool)} sub="in the open pool" />
      </div>

      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setFilter(t.key)}
            className={
              filter === t.key
                ? "rounded-lg bg-signal-soft px-3 py-1.5 text-xs font-semibold text-signal"
                : "rounded-lg bg-surface-2 px-3 py-1.5 text-xs font-medium text-mute hover:text-bone"
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title="Nothing here yet"
          hint="Add companies (or work the call queue) and they'll show up here ranked by how likely they are to close."
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {visible.map((item) => (
            <OppCard
              key={item.company.id as string}
              item={item}
              meId={me?.id ?? null}
              onClaim={claim}
              busy={busyId === (item.company.id as string)}
            />
          ))}
        </div>
      )}

      <p className="text-xs text-faint">
        Scores use the signals you picked: best-fit industry, full contact info, interest shown on the
        call, and referrals — plus how fresh the lead is. It's a starting read, not a guarantee.
      </p>
    </div>
  );
}
