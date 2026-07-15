import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import {
  getContacts,
  getCompanies,
  getUsers,
  upsertContact,
  deleteContact,
} from "../../lib/crm/data";
import { Button, Card, Field, Input, Modal, Select, Textarea, EmptyState, PageHeader, OwnerChip, Pill } from "../../components/crm/ui";

type Row = Record<string, unknown>;

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
  loader: async () => {
    const [contacts, companies, users] = await Promise.all([getContacts(), getCompanies(), getUsers()]);
    return { contacts, companies, users };
  },
  component: ContactsPage,
});

function ContactsPage() {
  const { contacts, companies, users } = Route.useLoaderData();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);

  async function onDelete(id: string) {
    if (!confirm("Delete this contact?")) return;
    await deleteContact({ data: { id } });
    router.invalidate();
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <PageHeader
        title="Contacts"
        subtitle={`${(contacts as Row[]).length} people · overlap flags show when someone else owns the account`}
        actions={
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
                    <td className="px-4 py-2.5 text-right">
                      <button onClick={() => onDelete(c.id as string)} className="text-xs text-faint hover:text-red-400">
                        Delete
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

      <ContactModal
        open={open}
        onClose={() => setOpen(false)}
        contact={editing}
        companies={companies as Row[]}
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
  users,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  contact: Row | null;
  companies: Row[];
  users: Row[];
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    const fd = new FormData(e.currentTarget);
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
    setSaving(false);
    onSaved();
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
    </Modal>
  );
}
