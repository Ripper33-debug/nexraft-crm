import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import {
  getContacts,
  getCompanies,
  getUsers,
  upsertContact,
  archiveContact,
} from "../../lib/crm/data";
import { Button, Card, Field, Input, Modal, Select, Textarea, EmptyState, PageHeader, OwnerChip, Pill } from "../../components/crm/ui";
import { NotesThread } from "../../components/crm/notes";
import { ArchivedPanel } from "../../components/crm/archived";
import { downloadCsv, stampedName } from "../../lib/crm/csv";
import { relativeTime } from "../../lib/crm/constants";
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
  }),
  loader: async () => {
    const [contacts, companies, users] = await Promise.all([getContacts(), getCompanies(), getUsers()]);
    return { contacts, companies, users };
  },
  component: ContactsPage,
});

function ContactsPage() {
  const { contacts, companies, users } = Route.useLoaderData();
  const { focus } = Route.useSearch();
  const router = useRouter();
  const navigate = Route.useNavigate();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);

  // Deep-link from global search: ?focus=<id> auto-opens the matching contact.
  useEffect(() => {
    if (!focus) return;
    const match = (contacts as Row[]).find((c) => c.id === focus);
    if (match) {
      setEditing(match);
      setOpen(true);
    }
    navigate({ search: { focus: undefined }, replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  async function onArchive(id: string) {
    if (!confirm("Archive this contact? You can restore it anytime.")) return;
    try {
      await archiveContact({ data: { id } });
      toast("Contact archived");
      router.invalidate();
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
                    <td className="px-4 py-2.5 text-right">
                      <button onClick={() => onArchive(c.id as string)} className="text-xs text-faint hover:text-red-400">
                        Archive
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {(contacts as Row[]).length === 0 ? (
          <div className="p-4">
            <EmptyState title="No contacts yet" hint="Add the people you talk to at each company." />
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
        onSaved={() => {
          setOpen(false);
          router.invalidate();
        }}
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
}: {
  open: boolean;
  onClose: () => void;
  contact: Row | null;
  companies: Row[];
  existing: Row[];
  users: Row[];
  onSaved: () => void;
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
      <form onSubmit={onSubmit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name">
            <Input name="first_name" required defaultValue={(contact?.first_name as string) || ""} />
          </Field>
          <Field label="Last name">
            <Input name="last_name" defaultValue={(contact?.last_name as string) || ""} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
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
        <div className="grid grid-cols-2 gap-3">
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
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
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
