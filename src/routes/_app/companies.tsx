import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import {
  getCompanies,
  getUsers,
  upsertCompany,
  deleteCompany,
} from "../../lib/crm/data";
import { Button, Card, Field, Input, Modal, Select, Textarea, EmptyState, PageHeader, OwnerChip } from "../../components/crm/ui";
import { NotesThread } from "../../components/crm/notes";
import { LEAD_SOURCES, COMPANY_TAGS, tagColor, parseTags, serializeTags } from "../../lib/crm/constants";
import { downloadCsv, stampedName } from "../../lib/crm/csv";
import { toast } from "../../components/crm/toast";

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
      Tags: parseTags(c.tags as string).join(", "),
      Deals: String(c.deal_count ?? 0),
      Owner: String(c.owner_name ?? ""),
      Notes: String(c.notes ?? ""),
    })),
  );
}

// Small colored label chip, shared by the table and the modal preview.
function TagChip({ name }: { name: string }) {
  const color = tagColor(name);
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ color, backgroundColor: color + "22", border: `1px solid ${color}55` }}
    >
      {name}
    </span>
  );
}

export const Route = createFileRoute("/_app/companies")({
  validateSearch: (search: Record<string, unknown>) => ({
    focus: typeof search.focus === "string" ? search.focus : undefined,
  }),
  loader: async () => {
    const [companies, users] = await Promise.all([getCompanies(), getUsers()]);
    return { companies, users };
  },
  component: CompaniesPage,
});

function CompaniesPage() {
  const { companies, users } = Route.useLoaderData();
  const { focus } = Route.useSearch();
  const router = useRouter();
  const navigate = Route.useNavigate();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);

  // Deep-link: a global-search result routes here with ?focus=<id> to auto-open.
  useEffect(() => {
    if (!focus) return;
    const match = (companies as Row[]).find((c) => c.id === focus);
    if (match) {
      setEditing(match);
      setOpen(true);
    }
    navigate({ search: { focus: undefined }, replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  async function onDelete(id: string) {
    if (!confirm("Delete this company?")) return;
    await deleteCompany({ data: { id } });
    toast("Company deleted");
    router.invalidate();
  }

  const rows = useMemo(() => {
    const all = companies as Row[];
    if (!tagFilter) return all;
    return all.filter((c) => parseTags(c.tags as string).includes(tagFilter));
  }, [companies, tagFilter]);

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

      {/* Tag filter row */}
      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        <button
          onClick={() => setTagFilter(null)}
          className={
            "rounded-full px-2.5 py-1 text-xs font-medium transition-colors " +
            (tagFilter === null ? "bg-signal-soft text-signal" : "text-mute hover:bg-surface-2 hover:text-bone")
          }
        >
          All
        </button>
        {COMPANY_TAGS.map((t) => {
          const active = tagFilter === t.name;
          return (
            <button
              key={t.name}
              onClick={() => setTagFilter(active ? null : t.name)}
              className="rounded-full px-2.5 py-1 text-xs font-medium transition-colors"
              style={
                active
                  ? { color: t.color, backgroundColor: t.color + "22", border: `1px solid ${t.color}66` }
                  : { color: "#8a978f", border: "1px solid transparent" }
              }
            >
              {t.name}
            </button>
          );
        })}
      </div>

      <Card className="mt-3 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                <th className="px-4 py-2.5 font-medium">Company</th>
                <th className="px-4 py-2.5 font-medium">Tags</th>
                <th className="px-4 py-2.5 font-medium">Industry</th>
                <th className="px-4 py-2.5 font-medium">City</th>
                <th className="px-4 py-2.5 font-medium">Deals</th>
                <th className="px-4 py-2.5 font-medium">Account owner</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const tags = parseTags(c.tags as string);
                return (
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
                    <td className="px-4 py-2.5">
                      {tags.length ? (
                        <div className="flex flex-wrap gap-1">
                          {tags.map((t) => (
                            <TagChip key={t} name={t} />
                          ))}
                        </div>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-mute">{(c.industry as string) || "—"}</td>
                    <td className="px-4 py-2.5 text-mute">{(c.city as string) || "—"}</td>
                    <td className="px-4 py-2.5 text-mute">{Number(c.deal_count) || 0}</td>
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
        {rows.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title={tagFilter ? `No “${tagFilter}” companies` : "No companies yet"}
              hint={tagFilter ? "Try a different tag or clear the filter." : "Add the businesses you're selling to."}
            />
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
  const [tags, setTags] = useState<string[]>([]);

  // Reset the selected tags whenever the modal opens on a different record.
  useEffect(() => {
    if (open) setTags(parseTags(company?.tags as string));
  }, [open, company]);

  function toggleTag(name: string) {
    setTags((prev) => (prev.includes(name) ? prev.filter((t) => t !== name) : [...prev, name]));
  }

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
        tags: serializeTags(tags) || null,
      },
    });
    setSaving(false);
    toast(company?.id ? "Company updated" : "Company added");
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
        <Field label="Tags">
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {COMPANY_TAGS.map((t) => {
              const on = tags.includes(t.name);
              return (
                <button
                  type="button"
                  key={t.name}
                  onClick={() => toggleTag(t.name)}
                  className="rounded-full px-2.5 py-1 text-xs font-medium transition-all"
                  style={
                    on
                      ? { color: t.color, backgroundColor: t.color + "22", border: `1px solid ${t.color}66` }
                      : { color: "#8a978f", border: "1px solid #222c26" }
                  }
                >
                  {t.name}
                </button>
              );
            })}
          </div>
        </Field>
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
