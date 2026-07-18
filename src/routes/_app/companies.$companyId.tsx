import { createFileRoute, Link } from "@tanstack/react-router";

import { getCompanies, getContacts, getDeals } from "../../lib/crm/data";
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

export const Route = createFileRoute("/_app/companies/$companyId")({
  loader: async ({ params }) => {
    const [companies, contacts, deals] = await Promise.all([
      getCompanies(),
      getContacts(),
      getDeals(),
    ]);
    const company = (companies as Row[]).find((c) => c.id === params.companyId) ?? null;
    const theirContacts = (contacts as Row[]).filter((c) => c.company_id === params.companyId);
    const theirDeals = (deals as Row[]).filter((d) => d.company_id === params.companyId);
    return { company, contacts: theirContacts, deals: theirDeals };
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

function CompanyDetail() {
  const { company, contacts, deals } = Route.useLoaderData();
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
        <Link to="/companies" search={{ focus: companyId, new: undefined }}>
          <Button size="sm" variant="outline">Edit</Button>
        </Link>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card className="p-4">
            <Eyebrow className="mb-2">Details</Eyebrow>
            <DetailRow label="Owner"><OwnerChip name={c.owner_name as string} /></DetailRow>
            <DetailRow label="Website">
              {website ? (
                <a href={website.startsWith("http") ? website : `https://${website}`} target="_blank" rel="noreferrer" className="text-signal hover:underline">
                  {website}
                </a>
              ) : <span className="text-faint">—</span>}
            </DetailRow>
            <DetailRow label="Phone">{(c.phone as string) || <span className="text-faint">—</span>}</DetailRow>
            <DetailRow label="Source">{(c.source as string) || <span className="text-faint">—</span>}</DetailRow>
            <DetailRow label="Added">{c.created_at ? relativeTime(c.created_at as string) : "—"}</DetailRow>
          </Card>

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
