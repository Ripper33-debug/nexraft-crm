import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import {
  getCompanies,
  getUsers,
  upsertCompany,
  deleteCompany,
} from "../../lib/crm/data";
import { Button, Card, Field, Input, Modal, Select, Textarea, EmptyState, PageHeader, OwnerChip } from "../../components/crm/ui";
import { NotesThread } from "../../components/crm/notes";
import { LEAD_SOURCES } from "../../lib/crm/constants";
import { downloadCsv, stampedName } from "../../lib/crm/csv";

type Row = Record<string, unknown>;

function exportCompanies(rows: Row[]) {
  downloadCsv(
    stampedName("nexraft_companies"),
    rows.map((c) => ({
      Company: String(c.name ?? ""),
      Industry: String(c.industry ?? ""),
      Website: String(c.website ?? ""),
      Phone: String(c.phone ?? ""),
      City: String(c.city ?? ""),
      Source: String(c.source ?? ""),
      Deals: String(c.deal_count ?? 0),
      Owner: String(c.owner_name ?? ""),
      Notes: String(c.notes ?? ""),
    })),
  );
}

export const Route = createFileRoute("/_app/companies")({
  loader: async () => {
    const [companies, users] = await Promise.all([getCompanies(), getUsers()]);
    return { companies, users };
  },
  component: CompaniesPage,
});

function CompaniesPage() {
  const { companies, users } = Route.useLoaderData();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);

  async function onDelete(id: string) {
    if (!confirm("Delete this company?")) return;
    await deleteCompany({ data: { id } });
    router.invalidate();
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <PageHeader
        title="Companies"
        subtitle={`${(companies as Row[]).length} accounts · each has one owner to avoid overlap`}
        actions={
          <>
            <Button variant="outline" onClick={() => exportCompanies(companies as Row[])}>
              Export CSV
            </Button>
            <Button
              onClick={() => {
                setEditing(null);
                setOpen(true);
              }}
            >
              + New company
            </Button>
          </>
        }
      />

      <Card className="mt-5 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                <th className="px-4 py-2.5 font-medium">Company</th>
                <th className="px-4 py-2.5 font-medium">Industry</th>
                <th className="px-4 py-2.5 font-medium">City</th>
                <th className="px-4 py-2.5 font-medium">Source</th>
                <th className="px-4 py-2.5 font-medium">Deals</th>
                <th className="px-4 py-2.5 font-medium">Account owner</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {(companies as Row[]).map((c) => (
                <tr key={c.id as string} className="border-b border-line/60 last:border-0 hover:bg-surface-2/60">
                  <td className="px-4 py-2.5">
                    <button
                      onClick={() => {
                        setEditing(c);
                        setOpen(true);
                      }}
                      className="font-medium text-bone hover:text-signal"
                    >
                      {c.name as string}
                    </button>
                    {c.website ? (
                      <div className="text-xs text-faint">{c.website as string}</div>
                    ) : null}
                  </td>
                  <td className="px-4 py-2.5 text-mute">{(c.industry as string) || "—"}</td>
                  <td className="px-4 py-2.5 text-mute">{(c.city as string) || "—"}</td>
                  <td className="px-4 py-2.5 text-mute">{(c.source as string) || "—"}</td>
                  <td className="px-4 py-2.5 text-mute">{Number(c.deal_count) || 0}</td>
                  <td className="px-4 py-2.5"><OwnerChip name={c.owner_name as string} /></td>
                  <td className="px-4 py-2.5 text-right">
                    <button onClick={() => onDelete(c.id as string)} className="text-xs text-faint hover:text-red-400">
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {(companies as Row[]).length === 0 ? (
          <div className="p-4">
            <EmptyState title="No companies yet" hint="Add the businesses you're selling to." />
          </div>
        ) : null}
      </Card>

      <CompanyModal
        open={open}
        onClose={() => setOpen(false)}
        company={editing}
        users={users as Row[]}
        onSaved={() => {
          setOpen(false);
          router.invalidate();
        }}
      />
    </div>
  );
}

function CompanyModal({
  open,
  onClose,
  company,
  users,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  company: Row | null;
  users: Row[];
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    const fd = new FormData(e.currentTarget);
    await upsertCompany({
      data: {
        id: (company?.id as string) || undefined,
        name: String(fd.get("name") || ""),
        industry: (fd.get("industry") as string) || null,
        website: (fd.get("website") as string) || null,
        phone: (fd.get("phone") as string) || null,
        city: (fd.get("city") as string) || null,
        source: (fd.get("source") as string) || null,
        owner_id: (fd.get("owner_id") as string) || null,
        notes: (fd.get("notes") as string) || null,
      },
    });
    setSaving(false);
    onSaved();
  }
  return (
    <Modal open={open} onClose={onClose} title={company ? "Edit company" : "New company"} wide>
      <form onSubmit={onSubmit} className="space-y-3">
        <Field label="Company name">
          <Input name="name" required defaultValue={(company?.name as string) || ""} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Industry">
            <Input name="industry" defaultValue={(company?.industry as string) || ""} />
          </Field>
          <Field label="Website">
            <Input name="website" defaultValue={(company?.website as string) || ""} placeholder="acme.com" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Phone">
            <Input name="phone" defaultValue={(company?.phone as string) || ""} />
          </Field>
          <Field label="City / Region">
            <Input name="city" defaultValue={(company?.city as string) || ""} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Lead source">
            <Select name="source" defaultValue={(company?.source as string) || ""}>
              <option value="">—</option>
              {LEAD_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Owner">
            <Select name="owner_id" defaultValue={(company?.owner_id as string) || ""}>
              <option value="">—</option>
              {users.map((u) => (
                <option key={u.id as string} value={u.id as string}>
                  {u.name as string}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Notes">
          <Textarea name="notes" defaultValue={(company?.notes as string) || ""} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save company"}
          </Button>
        </div>
      </form>

      {company?.id ? (
        <div className="mt-5 border-t border-line pt-4">
          <NotesThread entityType="company" entityId={company.id as string} />
        </div>
      ) : null}
    </Modal>
  );
}
