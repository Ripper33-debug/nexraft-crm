import { createFileRoute, Link } from "@tanstack/react-router";

import { getContacts, getDeals } from "../../lib/crm/data";
import {
  Button,
  Card,
  Eyebrow,
  OwnerChip,
  PageSkeleton,
  StageBadge,
} from "../../components/crm/ui";
import { NotesThread } from "../../components/crm/notes";
import { Timeline } from "../../components/crm/timeline";
import { formatMoney, relativeTime } from "../../lib/crm/constants";

type Row = Record<string, unknown>;

export const Route = createFileRoute("/_app/contacts/$contactId")({
  loader: async ({ params }) => {
    const [contacts, deals] = await Promise.all([getContacts(), getDeals()]);
    const contact = (contacts as Row[]).find((c) => c.id === params.contactId) ?? null;
    const theirDeals = (deals as Row[]).filter((d) => d.contact_id === params.contactId);
    return { contact, deals: theirDeals };
  },
  component: ContactDetail,
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

function ContactDetail() {
  const { contact, deals } = Route.useLoaderData();
  const { contactId } = Route.useParams();

  if (!contact) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <p className="text-sm font-medium text-bone">This contact couldn't be found.</p>
        <p className="mt-1 text-xs text-mute">They may have been archived or removed.</p>
        <Link to="/contacts" search={{ focus: undefined, new: undefined }} className="mt-4 inline-block">
          <Button size="sm" variant="outline">← Back to contacts</Button>
        </Link>
      </div>
    );
  }

  const c = contact as Row;
  const fullName = `${(c.first_name as string) ?? ""} ${(c.last_name as string) ?? ""}`.trim();

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <Link to="/contacts" search={{ focus: undefined, new: undefined }} className="text-xs text-faint hover:text-bone">
        ← Contacts
      </Link>

      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-bone">
            {fullName || "Unnamed contact"}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-mute">
            {c.title ? <span>{c.title as string}</span> : null}
            {c.company_id ? (
              <Link to="/companies/$companyId" params={{ companyId: c.company_id as string }} search={{ focus: undefined, new: undefined }} className="text-signal hover:underline">
                {(c.company_name as string) || "their company"}
              </Link>
            ) : c.company_name ? <span className="text-faint">{c.company_name as string}</span> : null}
          </div>
        </div>
        <Link to="/contacts" search={{ focus: contactId, new: undefined }}>
          <Button size="sm" variant="outline">Edit</Button>
        </Link>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card className="p-4">
            <Eyebrow className="mb-2">Details</Eyebrow>
            <DetailRow label="Owner"><OwnerChip name={c.owner_name as string} /></DetailRow>
            <DetailRow label="Email">
              {c.email ? (
                <a href={`mailto:${c.email as string}`} className="text-signal hover:underline">{c.email as string}</a>
              ) : <span className="text-faint">—</span>}
            </DetailRow>
            <DetailRow label="Phone">{(c.phone as string) || <span className="text-faint">—</span>}</DetailRow>
            <DetailRow label="Added">{c.created_at ? relativeTime(c.created_at as string) : "—"}</DetailRow>
          </Card>

          <Card className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <Eyebrow>Deals ({deals.length})</Eyebrow>
            </div>
            {deals.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-faint">No deals tied to this contact yet.</div>
            ) : (
              <ul className="divide-y divide-line/60">
                {(deals as Row[]).map((d) => (
                  <li key={d.id as string}>
                    <Link to="/deals/$dealId" params={{ dealId: d.id as string }} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-surface-2/60">
                      <div className="min-w-0">
                        <div className="truncate text-sm text-bone">{d.name as string}</div>
                        <div className="text-xs text-faint">{formatMoney(Number(d.value))}</div>
                      </div>
                      <StageBadge stage={d.stage as string} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-6 lg:col-span-1">
          <Card className="p-4">
            <Timeline entityType="contact" entityId={contactId} />
          </Card>
          <Card className="p-4">
            <NotesThread entityType="contact" entityId={contactId} />
          </Card>
        </div>
      </div>
    </div>
  );
}
