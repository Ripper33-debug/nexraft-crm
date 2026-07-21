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
} from "../../components/crm/ui";
import { NotesThread } from "../../components/crm/notes";
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

// Command Deck intel panel: shows the saved research dossier and lets a rep
// (re)run the dig on demand. The server does the crawling; this just renders
// whatever came back and refreshes the route so the note thread catches up.
function ResearchPanel({ company }: { company: Row }) {
  const router = useRouter();
  const { user } = useRouteContext({ from: "/_app" }) as { user?: { name?: string; role?: string } };
  const [busy, setBusy] = useState(false);
  const [dossier, setDossier] = useState<ResearchDossier | null>(() => {
    try {
      return company.research ? (JSON.parse(company.research as string) as ResearchDossier) : null;
    } catch {
      return null;
    }
  });

  const run = async () => {
    setBusy(true);
    try {
      const res = await researchCompany({ data: { id: company.id as string } });
      setDossier(res.dossier);
      toast("🔎 Research done — findings saved to notes.");
      void router.invalidate();
    } catch {
      toast("Research failed — try again in a moment.");
    } finally {
      setBusy(false);
    }
  };

  const d = dossier;
  return (
    <Card className="relative p-4">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute right-0 top-0 h-2.5 w-2.5 border-r-2 border-t-2 border-signal"
      />
      <div className="flex items-center justify-between gap-3">
        <Eyebrow>Intel</Eyebrow>
        <div className="flex items-center gap-3">
          {d ? (
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-faint">
              {relativeTime(d.researched_at)}
            </span>
          ) : null}
          <Button size="sm" variant="outline" onClick={run} disabled={busy}>
            {busy ? "Digging…" : d ? "↻ Re-research" : "🔎 Research"}
          </Button>
        </div>
      </div>
      {!d ? (
        <p className="mt-3 text-sm text-faint">
          {busy
            ? "Reading their website, hunting contacts, checking reputation…"
            : "No dossier yet. Run research to pull what they do, who runs it, contacts, and pitch angles straight off their website."}
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          {d.summary ? <p className="text-sm leading-relaxed text-mute">{d.summary}</p> : null}
          {d.services.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {d.services.map((s) => (
                <Pill key={s} tone="neutral">{s}</Pill>
              ))}
            </div>
          ) : null}
          <div className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {d.established ? (
              <div><span className="text-faint">Since </span><span className="text-bone">{d.established}</span></div>
            ) : null}
            {d.serviceArea ? (
              <div><span className="text-faint">Serves </span><span className="text-bone">{d.serviceArea}</span></div>
            ) : null}
            {d.people.length > 0 ? (
              <div><span className="text-faint">Owner </span><span className="text-bone">{d.people.join(", ")}</span></div>
            ) : null}
            {d.rating !== null ? (
              <div>
                <span className="text-signal">{"★".repeat(Math.round(d.rating))}</span>
                <span className="ml-1.5 text-bone">{d.rating}</span>
                <span className="text-faint"> · {d.reviews ?? 0} reviews ({d.ratingSource})</span>
              </div>
            ) : null}
          </div>
          {d.emails.length > 0 || d.phones.length > 0 ? (
            <div className="font-mono text-xs text-mute">
              {[...d.emails, ...d.phones].join(" · ")}
            </div>
          ) : null}
          {d.socials.length > 0 ? (
            <div className="flex flex-wrap gap-3 text-xs">
              {d.socials.map((s) => (
                <a key={s} href={s} target="_blank" rel="noreferrer" className="text-signal hover:underline">
                  {s.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]}
                </a>
              ))}
            </div>
          ) : null}
          {d.angles.length > 0 ? (
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint">Pitch angles</div>
              <ul className="mt-1.5 space-y-1">
                {d.angles.map((a) => (
                  <li key={a} className="flex gap-2 text-sm text-mute">
                    <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 bg-signal" />
                    <span>{a}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {d.ai ? (
            <div className="rounded-lg border border-signal/25 bg-signal-soft/40 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-signal">AI call brief</div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    const body = (d.ai?.email_body ?? "").replace(/\{\{REP_NAME\}\}/g, user?.name ?? "");
                    const text = `Subject: ${d.ai?.email_subject ?? ""}\n\n${body}`;
                    try {
                      await navigator.clipboard.writeText(text);
                      toast("✉ Email draft copied — paste it into Outreach or Gmail.", "success");
                    } catch {
                      prompt("Copy the drafted email:", text);
                    }
                  }}
                >
                  Copy email draft
                </Button>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-bone">{d.ai.brief}</p>
              <div className="mt-3 border-t border-line/60 pt-2">
                <div className="text-xs text-faint">Drafted email · {d.ai.email_subject}</div>
                <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-mute">
                  {d.ai.email_body.replace(/\{\{REP_NAME\}\}/g, user?.name ?? "")}
                </p>
              </div>
            </div>
          ) : user?.role === "admin" ? (
            <p className="text-xs text-faint">
              No AI brief on this dossier — add OPENROUTER_API_KEY (or ANTHROPIC_API_KEY) in Vercel and hit ↻ Re-research to get a
              call-ready brief and a drafted email written about this business.
            </p>
          ) : null}
        </div>
      )}
    </Card>
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

function CompanyDetail() {
  const { company, contacts, deals, referrers } = Route.useLoaderData();
  const { companyId } = Route.useParams();

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
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/companies" search={{ focus: companyId, new: undefined }}>
            <Button size="sm" variant="outline">Edit</Button>
          </Link>
        </div>
      </div>

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
                    <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-medium text-red-400">Site down</span>
                  ) : c.website_status === "live" ? (
                    <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-400">Live</span>
                  ) : null}
                </span>
              ) : <span className="text-faint">—</span>}
            </DetailRow>
            <DetailRow label="Phone">{(c.phone as string) || <span className="text-faint">—</span>}</DetailRow>
            <DetailRow label="Source">{(c.source as string) || <span className="text-faint">—</span>}</DetailRow>
            <ReferredByRow company={c} referrers={referrers} />
            <DetailRow label="Added">{c.created_at ? relativeTime(c.created_at as string) : "—"}</DetailRow>
            {Number(c.referrals_made) > 0 ? (
              <p className="mt-2 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-400">
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
