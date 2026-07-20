import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { getDeals, getProposalLink } from "../../lib/crm/data";
import { toast } from "../../components/crm/toast";
import {
  Button,
  Card,
  Eyebrow,
  OwnerChip,
  Pill,
  StageBadge,
  PageSkeleton,
} from "../../components/crm/ui";
import { NotesThread } from "../../components/crm/notes";
import { Timeline } from "../../components/crm/timeline";
import { formatMoney, relativeTime, stageInfo, daysBetween } from "../../lib/crm/constants";

type Row = Record<string, unknown>;

export const Route = createFileRoute("/_app/deals/$dealId")({
  loader: async ({ params }) => {
    const deals = await getDeals();
    const deal = (deals as Row[]).find((d) => d.id === params.dealId) ?? null;
    return { deal };
  },
  component: DealDetail,
  pendingComponent: () => <PageSkeleton cards={0} rows={6} />,
});

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5">
      <span className="shrink-0 text-xs text-faint">{label}</span>
      <span className="min-w-0 text-right text-sm text-bone">{children}</span>
    </div>
  );
}

function parseLinks(raw: unknown): { label: string; url: string }[] {
  if (!raw || typeof raw !== "string") return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((x) => x && typeof x.url === "string").map((x) => ({ label: String(x.label ?? x.url), url: String(x.url) }));
  } catch {
    return [];
  }
}

// Copies the public /proposal/<token> link. First click also flips the deal to
// proposal 'sent' server-side, which starts the 3-day chaser clock in My Day.
function SendProposalButton({ dealId, status, viewedAt }: { dealId: string; status: string; viewedAt: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const sent = status !== "none";

  async function run() {
    setBusy(true);
    try {
      const { token } = await getProposalLink({ data: { dealId } });
      const url = `${window.location.origin}/proposal/${token}`;
      try {
        await navigator.clipboard.writeText(url);
        toast("📋 Proposal link copied — paste it into your email. You'll get pinged the moment they open it.", "success");
      } catch {
        prompt("Copy your proposal link:", url);
      }
      router.invalidate();
    } catch {
      toast("Couldn't create the proposal link — try again.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button size="sm" onClick={run} disabled={busy} variant={sent ? "outline" : undefined}>
      {busy ? "Working…" : viewedAt ? "Copy proposal link" : sent ? "Copy proposal link" : "📨 Send proposal"}
    </Button>
  );
}

function DealDetail() {
  const { deal } = Route.useLoaderData();
  const { dealId } = Route.useParams();

  if (!deal) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <p className="text-sm font-medium text-bone">This deal couldn't be found.</p>
        <p className="mt-1 text-xs text-mute">It may have been archived or removed.</p>
        <Link to="/pipeline" search={{ focus: undefined, new: undefined }} className="mt-4 inline-block">
          <Button size="sm" variant="outline">← Back to pipeline</Button>
        </Link>
      </div>
    );
  }

  const d = deal as Row;
  const info = stageInfo(d.stage as string);
  const isOpen = info.kind === "open";
  const age = daysBetween(d.stage_changed_at as string);
  const links = parseLinks(d.links);
  const contactName = `${(d.contact_first as string) ?? ""} ${(d.contact_last as string) ?? ""}`.trim();
  const proposal = String(d.proposal_status ?? "none");

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <Link to="/pipeline" search={{ focus: undefined, new: undefined }} className="text-xs text-faint hover:text-bone">
        ← Pipeline
      </Link>

      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-bone">
            {(d.name as string) || "Untitled deal"}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <StageBadge stage={d.stage as string} />
            {isOpen ? <Pill tone={age >= 14 ? "warn" : "neutral"}>{age}d in stage</Pill> : null}
            {proposal !== "none" ? <Pill tone="signal">Proposal {proposal}</Pill> : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <SendProposalButton dealId={dealId} status={proposal} viewedAt={d.proposal_viewed_at as string | null} />
          <Link to="/pipeline" search={{ focus: dealId, new: undefined }}>
            <Button size="sm" variant="outline">Edit</Button>
          </Link>
        </div>
      </div>

      {d.proposal_viewed_at ? (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-signal/40 bg-signal-soft px-3 py-2 text-xs text-bone">
          <span className="h-1.5 w-1.5 rounded-full bg-signal shadow-[0_0_8px_rgba(255,77,28,0.9)]" />
          They opened the proposal {relativeTime(d.proposal_viewed_at as string)} — that&apos;s your window. Call and ask what stood out.
        </div>
      ) : null}

      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card className="p-4">
            <Eyebrow className="mb-2">Details</Eyebrow>
            <DetailRow label="Value">{formatMoney(Number(d.value))}</DetailRow>
            {Number(d.monthly_value) > 0 ? (
              <DetailRow label="Monthly">{formatMoney(Number(d.monthly_value))}/mo</DetailRow>
            ) : null}
            <DetailRow label="Owner"><OwnerChip name={d.owner_name as string} /></DetailRow>
            <DetailRow label="Company">
              {d.company_id ? (
                <Link to="/companies/$companyId" params={{ companyId: d.company_id as string }} search={{ focus: undefined, new: undefined }} className="text-signal hover:underline">
                  {(d.company_name as string) || "View company"}
                </Link>
              ) : <span className="text-faint">—</span>}
            </DetailRow>
            <DetailRow label="Contact">
              {d.contact_id && contactName ? (
                <Link to="/contacts/$contactId" params={{ contactId: d.contact_id as string }} search={{ focus: undefined, new: undefined }} className="text-signal hover:underline">
                  {contactName}
                </Link>
              ) : <span className="text-faint">—</span>}
            </DetailRow>
            <DetailRow label="Next step">{(d.next_step as string) || <span className="text-faint">—</span>}</DetailRow>
            {d.renewal_date ? <DetailRow label="Renews">{String(d.renewal_date).slice(0, 10)}</DetailRow> : null}
            {d.win_reason ? <DetailRow label="Win reason">{d.win_reason as string}</DetailRow> : null}
            {d.lost_reason ? <DetailRow label="Lost reason">{d.lost_reason as string}</DetailRow> : null}
            <DetailRow label="Created">{d.created_at ? relativeTime(d.created_at as string) : "—"}</DetailRow>
          </Card>

          {links.length > 0 ? (
            <Card className="p-4">
              <Eyebrow className="mb-2">Links</Eyebrow>
              <div className="flex flex-wrap gap-2">
                {links.map((l, i) => (
                  <a key={i} href={l.url} target="_blank" rel="noreferrer" className="rounded-md border border-line bg-surface-2 px-2.5 py-1 text-xs text-signal hover:underline">
                    {l.label}
                  </a>
                ))}
              </div>
            </Card>
          ) : null}
        </div>

        <div className="space-y-6 lg:col-span-1">
          <Card className="p-4">
            <Timeline entityType="deal" entityId={dealId} />
          </Card>
          <Card className="p-4">
            <NotesThread entityType="deal" entityId={dealId} />
          </Card>
        </div>
      </div>
    </div>
  );
}
