import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import {
  getCompanies,
  getDeals,
  getUsers,
  upsertCompany,
  archiveCompany,
  restoreCompany,
  importCompanies,
} from "../../lib/crm/data";
import { Button, Card, Field, Input, Modal, Select, Textarea, EmptyState, PageHeader, OwnerChip } from "../../components/crm/ui";
import { NotesThread } from "../../components/crm/notes";
import { CallMode } from "../../components/crm/call-mode";
import { RecordAccessButton } from "../../components/crm/record-access";
import { ArchivedPanel } from "../../components/crm/archived";
import { ImportCsvButton } from "../../components/crm/csv-import";
import { LEAD_SOURCES, COMPANY_TAGS, tagColor, parseTags, serializeTags, canEditRecord } from "../../lib/crm/constants";
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
    new: search.new === true || search.new === "true" ? true : undefined,
  }),
  loader: async () => {
    const [companies, users, deals] = await Promise.all([getCompanies(), getUsers(), getDeals()]);
    return { companies, users, deals };
  },
  component: CompaniesPage,
});

function CompaniesPage() {
  const { companies, users, deals } = Route.useLoaderData();
  const { user: me } = Route.useRouteContext();
  const { focus, new: newParam } = Route.useSearch();
  const router = useRouter();
  const navigate = Route.useNavigate();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [ownerFilter, setOwnerFilter] = useState<string>("");
  const [callFilter, setCallFilter] = useState<string>("");
  const [calling, setCalling] = useState<Row | null>(null);

  // Deep-link: a global-search result routes here with ?focus=<id> to auto-open.
  useEffect(() => {
    if (!focus) return;
    const match = (companies as Row[]).find((c) => c.id === focus);
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
      await archiveCompany({ data: { id } });
      router.invalidate();
      toast("Company archived", "info", {
        label: "Undo",
        onClick: async () => {
          try {
            await restoreCompany({ data: { id } });
            router.invalidate();
            toast("Company restored");
          } catch {
            toast("Couldn't restore — try again", "error");
          }
        },
      });
    } catch {
      toast("Couldn't archive — try again", "error");
    }
  }

  const rows = useMemo(() => {
    let all = companies as Row[];
    if (tagFilter) all = all.filter((c) => parseTags(c.tags as string).includes(tagFilter));
    if (ownerFilter) {
      all = ownerFilter === "__none__"
        ? all.filter((c) => !c.owner_id)
        : all.filter((c) => c.owner_id === ownerFilter);
    }
    if (callFilter === "need") all = all.filter((c) => Number(c.deal_count) === 0 && !c.call_outcome);
    else if (callFilter === "interested") all = all.filter((c) => c.call_outcome === "interested");
    else if (callFilter === "not_interested") all = all.filter((c) => c.call_outcome === "not_interested");
    return all;
  }, [companies, tagFilter, ownerFilter, callFilter]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <PageHeader
        title="Companies"
        subtitle={`${(companies as Row[]).length} accounts · each has one owner to avoid overlap`}
        actions={
          <>
            <ImportCsvButton
              label="Import companies from CSV"
              fields={[
                { key: "name", label: "Company", required: true, aliases: ["company", "name", "company name"] },
                { key: "industry", label: "Industry", aliases: ["industry"] },
                { key: "website", label: "Website", aliases: ["website", "url", "site"] },
                { key: "phone", label: "Phone", aliases: ["phone", "telephone", "tel"] },
                { key: "city", label: "City", aliases: ["city", "location"] },
                { key: "source", label: "Source", aliases: ["source", "lead source"] },
              ]}
              sampleHint="Only a Company name is required. Extra columns are ignored."
              onImport={(rows) => importCompanies({ data: { rows: rows as { name: string }[] } })}
              onDone={() => router.invalidate()}
            />
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

        {/* Owner + call-status filters */}
        <div className="ml-auto flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-faint">Call</span>
          <Select
            value={callFilter}
            onChange={(e) => setCallFilter(e.target.value)}
            className="h-8 w-auto min-w-[8rem] py-1 text-xs"
          >
            <option value="">All</option>
            <option value="need">Need to call</option>
            <option value="interested">Interested</option>
            <option value="not_interested">Not interested</option>
          </Select>
          <span className="font-mono text-[10px] uppercase tracking-wider text-faint">Owner</span>
          <Select
            value={ownerFilter}
            onChange={(e) => setOwnerFilter(e.target.value)}
            className="h-8 w-auto min-w-[9rem] py-1 text-xs"
          >
            <option value="">All owners</option>
            {(users as Row[]).map((u) => (
              <option key={u.id as string} value={u.id as string}>
                {u.name as string}
              </option>
            ))}
            <option value="__none__">Unassigned</option>
          </Select>
        </div>
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
                      {c.call_outcome === "interested" ? (
                        <span className="ml-2 align-middle rounded-full bg-signal-soft px-1.5 py-0.5 text-[10px] font-medium text-signal">Interested</span>
                      ) : c.call_outcome === "not_interested" ? (
                        <span className="ml-2 align-middle rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-faint">Not interested</span>
                      ) : Number(c.deal_count) === 0 ? (
                        <span className="ml-2 align-middle rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">Need to call</span>
                      ) : null}
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
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-3">
                        <button
                          onClick={() => setCalling(c)}
                          className="inline-flex items-center gap-1 text-xs font-medium text-mute transition-colors hover:text-signal"
                          title={c.phone ? `Call ${c.name}` : "Open call mode"}
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
                          </svg>
                          Call
                        </button>
                        <RecordAccessButton
                          entity="company"
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
        {rows.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title={tagFilter || ownerFilter ? "No companies match these filters" : "No companies yet"}
              hint={tagFilter || ownerFilter ? "Try a different owner or tag, or clear the filters." : "Add the businesses you're selling to."}
            />
          </div>
        ) : null}
      </Card>

      <ArchivedPanel entity="company" onRestored={() => router.invalidate()} />

      <CompanyModal
        open={open}
        onClose={() => setOpen(false)}
        company={editing}
        existing={companies as Row[]}
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
        kind="company"
        deals={deals as Row[]}
        onLogged={() => router.invalidate()}
      />
    </div>
  );
}

function CompanyModal({
  open,
  onClose,
  company,
  existing,
  users,
  onSaved,
  canEdit = true,
}: {
  open: boolean;
  onClose: () => void;
  company: Row | null;
  existing: Row[];
  users: Row[];
  onSaved: () => void;
  canEdit?: boolean;
}) {
  const [saving, setSaving] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [nameVal, setNameVal] = useState("");

  // Reset the selected tags + name whenever the modal opens on a different record.
  useEffect(() => {
    if (open) {
      setTags(parseTags(company?.tags as string));
      setNameVal((company?.name as string) || "");
    }
  }, [open, company]);

  // Live duplicate detection: match an existing company by name (case-insensitive),
  // excluding the one being edited. Shown as a warning before the user saves.
  const dupMatch = useMemo(() => {
    const n = nameVal.trim().toLowerCase();
    if (!n) return null;
    return (
      existing.find(
        (c) => c.id !== company?.id && String(c.name ?? "").trim().toLowerCase() === n,
      ) ?? null
    );
  }, [nameVal, existing, company]);

  function toggleTag(name: string) {
    setTags((prev) => (prev.includes(name) ? prev.filter((t) => t !== name) : [...prev, name]));
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get("name") || "").trim();

    // Duplicate guard: warn before creating a second company with the same name.
    if (!company?.id) {
      const clash = existing.find((c) => String(c.name ?? "").trim().toLowerCase() === name.toLowerCase());
      if (clash && !confirm(`A company named “${name}” already exists. Add it anyway?`)) return;
    }

    setSaving(true);
    try {
      await upsertCompany({
        data: {
          id: (company?.id as string) || undefined,
          name,
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
      toast(company?.id ? "Company updated" : "Company added");
      onSaved();
    } catch {
      toast("Couldn't save — please try again", "error");
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal open={open} onClose={onClose} title={company ? "Edit company" : "New company"} wide>
      {!canEdit ? (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-line-strong bg-surface-2/60 px-3 py-2 text-xs text-mute">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0 text-faint">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <span>
            {company?.owner_name ? `Owned by ${company.owner_name as string}.` : "You don't own this record."} You have
            view-only access — ask the owner to hand it off or share edit access to make changes.
          </span>
        </div>
      ) : null}
      <form onSubmit={onSubmit} className="space-y-3">
        <fieldset disabled={!canEdit} className={canEdit ? "space-y-3" : "space-y-3 opacity-60"}>
        <Field label="Company name">
          <Input name="name" required value={nameVal} onChange={(e) => setNameVal(e.target.value)} />
        </Field>
        {dupMatch ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            <span className="mt-0.5 font-semibold">Possible duplicate</span>
            <span className="text-amber-100/90">
              “{dupMatch.name as string}” is already in the CRM
              {dupMatch.owner_name ? `, owned by ${dupMatch.owner_name as string}` : ""}. Check before adding it again.
            </span>
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Industry">
            <Input name="industry" defaultValue={(company?.industry as string) || ""} />
          </Field>
          <Field label="Website">
            <Input
              name="website"
              defaultValue={(company?.website as string) || ""}
              placeholder="acme.com"
              pattern="^\s*(https?:\/\/)?[^\s.]+\.[^\s]+\s*$"
              title="Enter a domain like acme.com or a full URL"
            />
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
        </fieldset>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving || !canEdit}>
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
