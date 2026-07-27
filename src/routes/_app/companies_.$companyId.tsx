import { createFileRoute, Link, useRouter, useRouteContext } from "@tanstack/react-router";
import { useState } from "react";

import { getCompanies, getContacts, getDeals, researchCompany, setCompanyReferredBy, type ResearchDossier } from "../../lib/crm/data";
import { toast } from "../../components/crm/toast";
import {
  Button,
  Card,
  Eyebrow,
  OwnerChip,
  Pill,
  StageBadge,
  PageSkeleton,
  EmailedBadge,
} from "../../components/crm/ui";
import { NotesThread } from "../../components/crm/notes";
import { CallMode } from "../../components/crm/call-mode";
import { ResearchPanel } from "../../components/crm/research-panel";
import { Timeline } from "../../components/crm/timeline";
import { formatMoney, relativeTime, stageInfo } from "../../lib/crm/constants";

type Row = Record<string, unknown>;

export const Route = createFileRoute("/_app/companies_/$companyId")({
  loader: async ({ params }) => {
    const [companies, contacts, deals] = await Promise.all([
      getCompanies(),
      getContacts(),
      getDeals(),
    ]);
    const company = (companies as Row[]).find((c) => c.id === params.companyId) ?? null;
    const theirContacts = (contacts as Row[]).filter((c) => c.company_id === params.companyId);
    const theirDeals = (deals as Row[]).filter((d) => d.company_id === params.companyId);
    // Referral picker candidates: signed clients + won-deal companies — the
    // people who would actually send business our way.
    const referrers = (companies as Row[])
      .filter((c) => c.id !== params.companyId && (c.call_outcome === "signed" || Number(c.won_deals) > 0))
      .map((c) => ({ id: c.id as string, name: c.name as string }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { company, contacts: theirContacts, deals: theirDeals, referrers };
  },
  component: CompanyDetail,
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

// "Referred by" control inside the Details card: pick which existing client
// sent this lead. Setting it flips source to Referral server-side and the
// referrer's page starts showing a thank-them tally.
function ReferredByRow({ company, referrers }: { company: Row; referrers: { id: string; name: string }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const current = (company.referred_by_company_id as string | null) ?? "";

  async function change(value: string) {
    if (busy) return;
    setBusy(true);
    try {
      await setCompanyReferredBy({
        data: { companyId: company.id as string, referredById: value || null },
      });
      toast(value ? "🤝 Marked as a referral — source updated." : "Referral link removed.");
      void router.invalidate();
    } catch {
      toast("Couldn't save the referral — try again.", "error");
    } finally {
      setBusy(false);
    }
  }

  if (referrers.length === 0 && !current) return null;
  return (
    <DetailRow label="Referred by">
      <select
        value={current}
        disabled={busy}
        onChange={(e) => void change(e.target.value)}
        className="max-w-[220px] rounded-md border border-line bg-ink px-2 py-1 text-sm text-bone focus:border-signal/60 focus:outline-none disabled:opacity-60"
      >
        <option value="">— nobody / unknown —</option>
        {referrers.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
        {current && !referrers.some((r) => r.id === current) ? (
          <option value={current}>{(company.referred_by_name as string) ?? "Unknown company"}</option>
        ) : null}
      </select>
    </DetailRow>
  );
}

// Guided next step: one banner that answers "what do I do with this company
// RIGHT NOW?" based on the last call outcome — so a rep never lands on a
// record and has to guess where the flow continues.
function NextStepBar({
  c,
  deals,
  hasEmail,
  onCall,
}: {
  c: Row;
  deals: Row[];
  hasEmail: boolean;
  onCall: () => void;
}) {
  const outcome = (c.call_outcome as string | null) ?? null;
  const openDeal = deals.find((d) => !d.archived_at && d.stage !== "Launched" && d.stage !== "Lost") ?? null;

  const step = (() => {
    if (outcome === "signed") {
      return {
        icon: "🎉",
        text: "They signed — onboarding lives in Projects.",
        cta: (
          <Link to="/projects">
            <Button size="sm" variant="outline">Open Projects →</Button>
          </Link>
        ),
      };
    }
    if (outcome === "interested") {
      return {
        icon: "🔥",
        text: "They said YES. Get the proposal out today, while it's hot.",
        cta: openDeal ? (
          <Link to="/deals/$dealId" params={{ dealId: openDeal.id as string }}>
            <Button size="sm">Open the deal →</Button>
          </Link>
        ) : (
          <Link to="/pipeline" search={{ focus: undefined, new: true }}>
            <Button size="sm">Create the deal →</Button>
          </Link>
        ),
      };
    }
    if (outcome === "maybe") {
      return {
        icon: "⏳",
        text: "They said maybe — set a reminder so this never goes cold.",
        cta: (
          <Link to="/activities" search={{ focus: undefined, new: true }}>
            <Button size="sm" variant="outline">Set a reminder →</Button>
          </Link>
        ),
      };
    }
    if (outcome === "not_interested") {
      return {
        icon: "↩",
        text: "They passed. Shake it off — the next call is waiting.",
        cta: (
          <Link to="/calls">
            <Button size="sm" variant="outline">Back to the queue →</Button>
          </Link>
        ),
      };
    }
    if (outcome === "no_answer") {
      return {
        icon: "📵",
        text: hasEmail
          ? "No answer last time. Call again — or fire off the quick email above."
          : "No answer last time. Give them another ring.",
        cta: (
          <Button size="sm" onClick={onCall}>
            Call again
          </Button>
        ),
      };
    }
    // Never called yet.
    if (c.phone) {
      return {
        icon: "☎",
        text: "Haven't called them yet — that's the next step.",
        cta: (
          <Button size="sm" onClick={onCall}>
            Call now
          </Button>
        ),
      };
    }
    return {
      icon: "🔍",
      text: "No phone on file — add one so you can start the call.",
      cta: (
        <Link to="/companies" search={{ focus: c.id as string, new: undefined }}>
          <Button size="sm" variant="outline">Add a phone →</Button>
        </Link>
      ),
    };
  })();

  return (
    <Card className="mt-5 flex flex-wrap items-center justify-between gap-3 border-signal/30 bg-signal-soft/60 px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <span aria-hidden className="text-lg">{step.icon}</span>
        <div className="min-w-0">
          <Eyebrow>Next step</Eyebrow>
          <p className="text-sm font-medium text-bone">{step.text}</p>
        </div>
      </div>
      <div className="shrink-0">{step.cta}</div>
    </Card>
  );
}

function CompanyDetail() {
  const { company, contacts, deals, referrers } = Route.useLoaderData();
  const { companyId } = Route.useParams();
  const router = useRouter();
  const { user } = useRouteContext({ from: "/_app" }) as { user?: { name?: string } };
  // "Work the account from one page": call + email actions live right in the
  // header so a rep never has to hop to Calls or Outreach mid-conversation.
  const [calling, setCalling] = useState(false);

  if (!company) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <p className="text-sm font-medium text-bone">This company couldn't be found.</p>
        <p className="mt-1 text-xs text-mute">It may have been archived or removed.</p>
        <Link to="/companies" search={{ focus: undefined, new: undefined }} className="mt-4 inline-block">
          <Button size="sm" variant="outline">← Back to companies</Button>
        </Link>
      </div>
    );
  }

  const c = company as Row;
  const tags = String(c.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  const website = (c.website as string) || "";

  // Quick email: first linked contact with an address, else the first email the
  // research dig found. Pre-fills the AI-drafted email when a dossier has one.
  let quickEmail: { to: string; href: string } | null = null;
  {
    const contactEmail = (contacts as Row[]).map((ct) => (ct.email as string) || "").find(Boolean) ?? null;
    let dossier: ResearchDossier | null = null;
    try {
      dossier = c.research ? (JSON.parse(c.research as string) as ResearchDossier) : null;
    } catch {
      dossier = null;
    }
    const to = contactEmail ?? dossier?.emails?.[0] ?? null;
    if (to) {
      const rep = user?.name ?? "";
      const subject = dossier?.ai?.email_subject?.trim() || `Quick idea for ${(c.name as string) || "your business"}`;
      const body =
        dossier?.ai?.email_body?.replace(/\{\{REP_NAME\}\}/g, rep).trim() ||
        [
          "Hi,",
          "",
          `I came across ${(c.name as string) || "your business"} and had a couple of quick ideas for your website that I think you'd like.`,
          "",
          "Is there a good time this week for a 5-minute chat?",
          "",
          rep ? `Thanks,\n${rep}` : "Thanks!",
        ].join("\n");
      quickEmail = { to, href: `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}` };
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <Link
        to="/companies"
        search={{ focus: undefined, new: undefined }}
        className="text-xs text-faint hover:text-bone"
      >
        ← Companies
      </Link>

      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-bone">
            {(c.name as string) || "Untitled company"}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-mute">
            {c.industry ? <span>{c.industry as string}</span> : null}
            {c.city ? <span className="text-faint">· {c.city as string}</span> : null}
            {tags.map((t) => (
              <Pill key={t} tone="neutral">{t}</Pill>
            ))}
            {/* Sits right beside the ✉ Email button, which is the whole point:
                the history is in front of you at the moment you'd click it. */}
            <EmailedBadge company={c} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => setCalling(true)} title="Open Call Mode — script, timer, and one-tap logging">
            📞 Call
          </Button>
          {quickEmail ? (
            <a href={quickEmail.href} title={`Opens a ready-to-send email to ${quickEmail.to}`}>
              <Button size="sm" variant="outline">✉ Email</Button>
            </a>
          ) : null}
          <Link to="/companies" search={{ focus: companyId, new: undefined }}>
            <Button size="sm" variant="outline">Edit</Button>
          </Link>
        </div>
      </div>

      <CallMode
        open={calling}
        onClose={() => setCalling(false)}
        subject={c}
        kind="company"
        deals={deals as Row[]}
        onLogged={() => router.invalidate()}
      />

      <NextStepBar c={c} deals={deals as Row[]} hasEmail={!!quickEmail} onCall={() => setCalling(true)} />

      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card className="p-4">
            <Eyebrow className="mb-2">Details</Eyebrow>
            <DetailRow label="Owner"><OwnerChip name={c.owner_name as string} /></DetailRow>
            <DetailRow label="Website">
              {website ? (
                <span className="inline-flex items-center gap-2">
                  <a href={website.startsWith("http") ? website : `https://${website}`} target="_blank" rel="noreferrer" className="text-signal hover:underline">
                    {website}
                  </a>
                  {c.website_status === "dead" ? (
                    <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-medium text-red-600">Site down</span>
                  ) : c.website_status === "live" ? (
                    <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-600">Live</span>
                  ) : null}
                </span>
              ) : <span className="text-faint">—</span>}
            </DetailRow>
            <DetailRow label="Phone">
              {c.phone ? (
                <a href={`tel:${(c.phone as string).replace(/[^\d+]/g, "")}`} className="text-signal hover:underline" title="Tap to call">
                  {c.phone as string}
                </a>
              ) : (
                <span className="text-faint">—</span>
              )}
            </DetailRow>
            <DetailRow label="Source">{(c.source as string) || <span className="text-faint">—</span>}</DetailRow>
            <ReferredByRow company={c} referrers={referrers} />
            <DetailRow label="Added">{c.created_at ? relativeTime(c.created_at as string) : "—"}</DetailRow>
            {Number(c.referrals_made) > 0 ? (
              <p className="mt-2 rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-600">
                🤝 Has sent {Number(c.referrals_made)} referral{Number(c.referrals_made) === 1 ? "" : "s"} our
                way — worth a thank-you (free month?).
              </p>
            ) : null}
          </Card>

          <ResearchPanel key={companyId} company={c} />

          <Card className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <Eyebrow>Deals ({deals.length})</Eyebrow>
            </div>
            {deals.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-faint">No deals for this company yet.</div>
            ) : (
              <ul className="divide-y divide-line/60">
                {(deals as Row[]).map((d) => (
                  <li key={d.id as string}>
                    <Link to="/deals/$dealId" params={{ dealId: d.id as string }} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-surface-2/60">
                      <div className="min-w-0">
                        <div className="truncate text-sm text-bone">{d.name as string}</div>
                        <div className="text-xs text-faint">{formatMoney(Number(d.value))}{stageInfo(d.stage as string).kind === "open" && Number(d.monthly_value) > 0 ? ` · ${formatMoney(Number(d.monthly_value))}/mo` : ""}</div>
                      </div>
                      <StageBadge stage={d.stage as string} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <Eyebrow>Contacts ({contacts.length})</Eyebrow>
            </div>
            {contacts.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-faint">No contacts linked yet.</div>
            ) : (
              <ul className="divide-y divide-line/60">
                {(contacts as Row[]).map((ct) => (
                  <li key={ct.id as string}>
                    <Link to="/contacts/$contactId" params={{ contactId: ct.id as string }} search={{ focus: undefined, new: undefined }} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-surface-2/60">
                      <div className="min-w-0">
                        <div className="truncate text-sm text-bone">{`${ct.first_name as string} ${(ct.last_name as string) ?? ""}`.trim()}</div>
                        <div className="truncate text-xs text-faint">
                          {(ct.title as string) || "—"}
                          {ct.email ? ` · ${ct.email as string}` : ""}
                        </div>
                      </div>
                      <span className="text-faint">→</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-6 lg:col-span-1">
          <Card className="p-4">
            <Timeline entityType="company" entityId={companyId} />
          </Card>
          <Card className="p-4">
            <NotesThread entityType="company" entityId={companyId} />
          </Card>
        </div>
      </div>
    </div>
  );
}
