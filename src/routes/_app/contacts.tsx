import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import {
  getContacts,
  getCompanies,
  getDeals,
  getUsers,
  upsertContact,
  archiveContact,
  restoreContact,
  importContacts,
} from "../../lib/crm/data";
import { Button, Card, Field, Input, Modal, Select, Textarea, EmptyState, PageHeader, OwnerChip, Pill, PageSkeleton } from "../../components/crm/ui";
import { NotesThread } from "../../components/crm/notes";
import { CallMode } from "../../components/crm/call-mode";
import { RecordAccessButton } from "../../components/crm/record-access";
import { ArchivedPanel } from "../../components/crm/archived";
import { ImportCsvButton } from "../../components/crm/csv-import";
import { downloadCsv, stampedName } from "../../lib/crm/csv";
import { relativeTime, canEditRecord } from "../../lib/crm/constants";
import { toast } from "../../components/crm/toast";

type Row = Record<string, unknown>;

function exportContacts(rows: Row[]) {
  downloadCsv(
    stampedName("nexraft_contacts"),
    rows.map((c) => ({
      "First name": String(c.first_name ?? ""),
      "Last name": String(c.last_name ?? ""),
      Company: String(c.company_name ?? ""),
      Title: String(c.title ?? ""),
      Email: String(c.email ?? ""),
      Phone: String(c.phone ?? ""),
      Owner: String(c.owner_name ?? ""),
      "Last contacted": c.last_contacted ? String(c.last_contacted).slice(0, 10) : "",
      Notes: String(c.notes ?? ""),
    })),
  );
}

// Flags a contact that two teammates might both be working.
function overlapWarning(c: Row): string | null {
  const ownerId = (c.owner_id as string) || null;
  const companyOwnerId = (c.company_owner_id as string) || null;
  const companyOwner = (c.company_owner_name as string) || null;
  if (Number(c.email_dupes) > 0) return "Duplicate email on another contact";
  if (ownerId && companyOwnerId && ownerId !== companyOwnerId && companyOwner)
    return `Account owned by ${companyOwner}`;
  if (!ownerId && companyOwner) return `Account owned by ${companyOwner}`;
  return null;
}

export const Route = createFileRoute("/_app/contacts")({
  validateSearch: (search: Record<string, unknown>) => ({
    focus: typeof search.focus === "string" ? search.focus : undefined,
    new: search.new === true || search.new === "true" ? true : undefined,
  }),
  loader: async () => {
    const [contacts, companies, users, deals] = await Promise.all([getContacts(), getCompanies(), getUsers(), getDeals()]);
    return { contacts, companies, users, deals };
  },
  component: ContactsPage,
  pendingComponent: () => <PageSkeleton cards={0} rows={8} />,
});

function ContactsPage() {
  const { contacts, companies, users, deals } = Route.useLoaderData();
  const { user: me } = Route.useRouteContext();
  const { focus, new: newParam } = Route.useSearch();
  const router = useRouter();
  const navigate = Route.useNavigate();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [calling, setCalling] = useState<Row | null>(null);

  // Deep-link from global search: ?focus=<id> auto-opens the matching contact.
  useEffect(() => {
    if (!focus) return;
    const match = (contacts as Row[]).find((c) => c.id === focus);
    if (match) {
      setEditing(match);
      setOpen(true);
    }
    navigate({ search: (prev) => ({ ...prev, focus: undefined }), replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  // Quick-create deep link (?new=true) from the command palette.
  useEffect(() => {
    if (!newParam) return;
    setEditing(null);
    setOpen(true);
    navigate({ search: (prev) => ({ ...prev, new: undefined }), replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newParam]);

  async function onArchive(id: string) {
    try {
      await archiveContact({ data: { id } });
      router.invalidate();
      toast("Contact archived", "info", {
        label: "Undo",
        onClick: async () => {
          try {
            await restoreContact({ data: { id } });
            router.invalidate();
            toast("Contact restored");
          } catch {
            toast("Couldn't restore — try again", "error");
          }
        },
      });
    } catch {
      toast("Couldn't archive — try again", "error");
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <PageHeader
        title="Contacts"
        subtitle={`${(contacts as Row[]).length} people · overlap flags show when someone else owns the account`}
        actions={
          <>
            <ImportCsvButton
              label="Import contacts from CSV"
              fields={[
                { key: "first_name", label: "First name", required: true, aliases: ["first name", "first_name", "first", "name"] },
                { key: "last_name", label: "Last name", aliases: ["last name", "last_name", "last", "surname"] },
                { key: "email", label: "Email", aliases: ["email", "e-mail"] },
                { key: "phone", label: "Phone", aliases: ["phone", "telephone", "tel", "mobile"] },
                { key: "title", label: "Title", aliases: ["title", "job title", "role"] },
                { key: "company_name", label: "Company", aliases: ["company", "company name", "account"] },
              ]}
              sampleHint="Only a First name is required. A matching Company name links the contact to that account."
              onImport={(rows) => importContacts({ data: { rows: rows as { first_name: string }[] } })}
              onDone={() => router.invalidate()}
            />
            <Button variant="outline" onClick={() => exportContacts(contacts as Row[])}>
              Export CSV
            </Button>
            <Button
              onClick={() => {
                setEditing(null);
                setOpen(true);
              }}
            >
              + New contact
            </Button>
          </>
        }
      />

      <Card className="mt-5 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                <th className="px-4 py-2.5 font-medium">Name</th>
                <th className="px-4 py-2.5 font-medium">Company</th>
                <th className="px-4 py-2.5 font-medium">Title</th>
                <th className="px-4 py-2.5 font-medium">Email</th>
                <th className="px-4 py-2.5 font-medium">Phone</th>
                <th className="px-4 py-2.5 font-medium">Owner</th>
                <th className="px-4 py-2.5 font-medium">Last contacted</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {(contacts as Row[]).map((c) => {
                const warn = overlapWarning(c);
                return (
                  <tr key={c.id as string} className="border-b border-line/60 last:border-0 hover:bg-surface-2/60">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            setEditing(c);
                            setOpen(true);
                          }}
                          className="font-medium text-bone hover:text-signal"
                        >
                          {`${c.first_name as string} ${(c.last_name as string) || ""}`.trim()}
                        </button>
                        {warn ? (
                          <span title={warn}>
                            <Pill tone="warn">⚠ Overlap</Pill>
                          </span>
                        ) : null}
                      </div>
                      {warn ? <div className="text-xs text-amber-400/80">{warn}</div> : null}
                    </td>
                    <td className="px-4 py-2.5 text-mute">{(c.company_name as string) || "—"}</td>
                    <td className="px-4 py-2.5 text-mute">{(c.title as string) || "—"}</td>
                    <td className="px-4 py-2.5 text-mute">{(c.email as string) || "—"}</td>
                    <td className="px-4 py-2.5 text-mute">{(c.phone as string) || "—"}</td>
                    <td className="px-4 py-2.5"><OwnerChip name={c.owner_name as string} /></td>
                    <td className="px-4 py-2.5 text-mute">
                      {c.last_contacted ? relativeTime(c.last_contacted as string) : <span className="text-faint">Never</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-3">
                        <button
                          onClick={() => setCalling(c)}
                          className="inline-flex items-center gap-1 text-xs font-medium text-mute transition-colors hover:text-signal"
                          title={c.phone ? `Call ${c.first_name}` : "Open call mode"}
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
                          </svg>
                          Call
                        </button>
                        <RecordAccessButton
                          entity="contact"
                          record={{ id: c.id as string, owner_id: (c.owner_id as string) ?? null, owner_name: (c.owner_name as string) ?? null, shared_with: (c.shared_with as string) ?? null }}
                          users={users as { id: string; name: string; email?: string; role?: string }[]}
                          me={me}
                          onDone={() => router.invalidate()}
                        />
                        {canEditRecord(me, (c.owner_id as string) ?? null, (c.shared_with as string) ?? null) ? (
                          <button onClick={() => onArchive(c.id as string)} className="text-xs text-faint hover:text-red-400">
                            Archive
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {(contacts as Row[]).length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="No contacts yet"
              hint="Add the people you talk to at each company — the decision-makers you'll be calling and emailing."
              action={
                <Button
                  onClick={() => {
                    setEditing(null);
                    setOpen(true);
                  }}
                >
                  + New contact
                </Button>
              }
            />
          </div>
        ) : null}
      </Card>

      <ArchivedPanel entity="contact" onRestored={() => router.invalidate()} />

      <ContactModal
        open={open}
        onClose={() => setOpen(false)}
        contact={editing}
        companies={companies as Row[]}
        existing={contacts as Row[]}
        users={users as Row[]}
        canEdit={!editing || canEditRecord(me, (editing.owner_id as string) ?? null, (editing.shared_with as string) ?? null)}
        onSaved={() => {
          setOpen(false);
          router.invalidate();
        }}
      />

      <CallMode
        open={!!calling}
        onClose={() => setCalling(null)}
        subject={calling}
        kind="contact"
        deals={deals as Row[]}
        onLogged={() => router.invalidate()}
      />
    </div>
  );
}

function ContactModal({
  open,
  onClose,
  contact,
  companies,
  existing,
  users,
  onSaved,
  canEdit = true,
}: {
  open: boolean;
  onClose: () => void;
  contact: Row | null;
  companies: Row[];
  existing: Row[];
  users: Row[];
  onSaved: () => void;
  canEdit?: boolean;
}) {
  const [saving, setSaving] = useState(false);
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const email = ((fd.get("email") as string) || "").trim();

    // Duplicate guard: warn if this email already belongs to another contact.
    if (!contact?.id && email) {
      const clash = existing.find((c) => String(c.email ?? "").trim().toLowerCase() === email.toLowerCase());
      if (clash && !confirm(`${email} is already on ${String(clash.first_name ?? "another contact")}. Add anyway?`)) return;
    }

    setSaving(true);
    try {
    await upsertContact({
      data: {
        id: (contact?.id as string) || undefined,
        first_name: String(fd.get("first_name") || ""),
        last_name: (fd.get("last_name") as string) || null,
        company_id: (fd.get("company_id") as string) || null,
        title: (fd.get("title") as string) || null,
        email: (fd.get("email") as string) || null,
        phone: (fd.get("phone") as string) || null,
        owner_id: (fd.get("owner_id") as string) || null,
        notes: (fd.get("notes") as string) || null,
      },
    });
      toast(contact?.id ? "Contact updated" : "Contact added");
      onSaved();
    } catch {
      toast("Couldn't save — please try again", "error");
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal open={open} onClose={onClose} title={contact ? "Edit contact" : "New contact"} wide>
      {!canEdit ? (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-line-strong bg-surface-2/60 px-3 py-2 text-xs text-mute">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0 text-faint">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <span>
            {contact?.owner_name ? `Owned by ${contact.owner_name as string}.` : "You don't own this record."} You have
            view-only access — ask the owner to hand it off or share edit access to make changes.
          </span>
        </div>
      ) : null}
      <form onSubmit={onSubmit} className="space-y-3">
        <fieldset disabled={!canEdit} className={canEdit ? "space-y-3" : "space-y-3 opacity-60"}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="First name">
            <Input name="first_name" required defaultValue={(contact?.first_name as string) || ""} />
          </Field>
          <Field label="Last name">
            <Input name="last_name" defaultValue={(contact?.last_name as string) || ""} />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Company">
            <Select name="company_id" defaultValue={(contact?.company_id as string) || ""}>
              <option value="">—</option>
              {companies.map((c) => (
                <option key={c.id as string} value={c.id as string}>
                  {c.name as string}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Title">
            <Input name="title" defaultValue={(contact?.title as string) || ""} />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Email">
            <Input name="email" type="email" defaultValue={(contact?.email as string) || ""} />
          </Field>
          <Field label="Phone">
            <Input name="phone" defaultValue={(contact?.phone as string) || ""} />
          </Field>
        </div>
        <Field label="Owner">
          <Select name="owner_id" defaultValue={(contact?.owner_id as string) || ""}>
            <option value="">—</option>
            {users.map((u) => (
              <option key={u.id as string} value={u.id as string}>
                {u.name as string}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Notes">
          <Textarea name="notes" defaultValue={(contact?.notes as string) || ""} />
        </Field>
        </fieldset>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving || !canEdit}>
            {saving ? "Saving…" : "Save contact"}
          </Button>
        </div>
      </form>

      {contact?.id ? (
        <div className="mt-5 border-t border-line pt-4">
          <NotesThread entityType="contact" entityId={contact.id as string} />
        </div>
      ) : null}
    </Modal>
  );
}
