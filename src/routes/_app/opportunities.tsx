import { createFileRoute, useRouter, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  getCompanies,
  getContacts,
  getUsers,
  getCompanyBriefs,
  generateMissingBriefs,
  claimCompany,
} from "../../lib/crm/data";
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
    const [companies, contacts, users, briefs] = await Promise.all([
      getCompanies(),
      getContacts(),
      getUsers(),
      getCompanyBriefs(),
    ]);
    const me = (context as { user?: { id: string; role: string; name: string; email: string } }).user ?? null;
    return { companies, contacts, users, briefs, me };
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

const BRIEF_LABELS: Record<string, string> = {
  fit: "Fit",
  chance: "Chance",
  approach: "Approach",
  "watch-outs": "Watch-outs",
  "watch outs": "Watch-outs",
  watchouts: "Watch-outs",
};
const BRIEF_LABEL_COLOR: Record<string, string> = {
  Fit: "#2dd4bf",
  Chance: "#eab308",
  Approach: "#38bdf8",
  "Watch-outs": "#f472b6",
};

// Render the AI write-up. If it came back in the expected "Label: text" shape we
// style each section; otherwise we just show the raw text so nothing is lost.
function AiBrief({ text }: { text: string }) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const sections: { label: string; body: string }[] = [];
  for (const line of lines) {
    const m = line.match(/^([A-Za-z -]+):\s*(.*)$/);
    const key = m ? m[1].trim().toLowerCase() : "";
    if (m && BRIEF_LABELS[key]) {
      sections.push({ label: BRIEF_LABELS[key], body: m[2].trim() });
    } else if (sections.length) {
      sections[sections.length - 1].body += ` ${line}`;
    } else {
      sections.push({ label: "", body: line });
    }
  }
  return (
    <div className="mt-3 space-y-1.5 rounded-lg border border-line bg-ink/30 p-3">
      <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-faint">
        <span className="h-1.5 w-1.5 rounded-full bg-signal" /> AI read
      </div>
      {sections.map((s, i) => (
        <p key={i} className="text-xs leading-relaxed text-mute">
          {s.label ? (
            <span
              className="font-semibold"
              style={{ color: BRIEF_LABEL_COLOR[s.label] ?? "#e7e5e4" }}
            >
              {s.label}:{" "}
            </span>
          ) : null}
          {s.body}
        </p>
      ))}
    </div>
  );
}

function OppCard({
  item,
  meId,
  brief,
  briefPending,
  onClaim,
  busy,
}: {
  item: Scored;
  meId: string | null;
  brief: string | null;
  briefPending: boolean;
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
          {brief ? (
            <AiBrief text={brief} />
          ) : briefPending ? (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-dashed border-line bg-ink/20 p-3 text-xs text-faint">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-signal border-t-transparent" />
              Writing AI read…
            </div>
          ) : null}
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

type AiStatus = "idle" | "working" | "done" | "nokey" | "error";

function OpportunitiesPage() {
  const { companies, contacts, users, briefs, me } = Route.useLoaderData();
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [aiStatus, setAiStatus] = useState<AiStatus>("idle");
  const [aiError, setAiError] = useState<string | null>(null);
  const startedRef = useRef(false);

  // Cached AI briefs keyed by company.
  const briefMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of briefs as Row[]) {
      if (b.company_id && b.brief) m.set(b.company_id as string, b.brief as string);
    }
    return m;
  }, [briefs]);

  // Background filler: generate briefs for any company that doesn't have a
  // current one, a few at a time, refreshing the board as they land. Runs once
  // per mount; stops early (and tells the user) if there's no API key or the API
  // errors. Only missing/stale briefs ever hit the paid API.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    let cancelled = false;
    (async () => {
      for (let i = 0; i < 60 && !cancelled; i++) {
        let res;
        try {
          res = await generateMissingBriefs({ data: { limit: 4 } });
        } catch {
          setAiStatus("error");
          setAiError("Couldn't reach the AI service.");
          return;
        }
        if (!res.ok && res.error === "NO_KEY") {
          setAiStatus("nokey");
          return;
        }
        if (!res.ok) {
          setAiStatus("error");
          setAiError(res.error ?? "The AI service returned an error.");
          if (res.generated > 0) router.invalidate();
          return;
        }
        if (res.generated > 0 && !cancelled) {
          setAiStatus("working");
          await router.invalidate();
        }
        if (res.remaining === 0) {
          if (!cancelled) setAiStatus("done");
          return;
        }
        setAiStatus("working");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        actions={
          <Link to="/discover">
            <Button size="sm" variant="outline">
              + Find new leads
            </Button>
          </Link>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryCard label="Hot leads" value={String(counts.hot)} accent hint="Score 65+" />
        <SummaryCard label="Warm leads" value={String(counts.warm)} hint="Score 40–64" />
        <SummaryCard label="Up for grabs" value={String(counts.pool)} sub="in the open pool" />
      </div>

      {aiStatus === "nokey" ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-300">
          <span className="font-semibold">AI reads are off.</span> To turn them on, add an{" "}
          <code className="rounded bg-black/30 px-1">ANTHROPIC_API_KEY</code> in your Vercel project
          settings (Environment Variables), then redeploy. Everything else here works without it.
        </div>
      ) : aiStatus === "error" ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-300">
          <span className="font-semibold">AI reads hit a snag.</span> {aiError} The scores and board
          still work — I'll retry next time you open this page.
        </div>
      ) : aiStatus === "working" ? (
        <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-4 py-2.5 text-xs text-mute">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-signal border-t-transparent" />
          Writing AI reads for your companies… they'll appear as they're ready.
        </div>
      ) : null}

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
          {visible.map((item) => {
            const cid = item.company.id as string;
            const brief = briefMap.get(cid) ?? null;
            return (
              <OppCard
                key={cid}
                item={item}
                meId={me?.id ?? null}
                brief={brief}
                briefPending={!brief && (aiStatus === "working" || aiStatus === "idle")}
                onClaim={claim}
                busy={busyId === cid}
              />
            );
          })}
        </div>
      )}

      <p className="text-xs text-faint">
        Scores use the signals you picked: best-fit industry, full contact info, interest shown on the
        call, and referrals — plus how fresh the lead is. It's a starting read, not a guarantee.
      </p>
    </div>
  );
}
