import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import {
  getDeals,
  getCompanies,
  getContacts,
  getUsers,
  upsertDeal,
  setDealStage,
  deleteDeal,
} from "../../lib/crm/data";
import { Button, Card, Field, Input, Modal, Select, Textarea, EmptyState } from "../../components/crm/ui";
import { STAGE_NAMES, formatMoney, stageInfo, daysBetween } from "../../lib/crm/constants";

type Row = Record<string, unknown>;

export const Route = createFileRoute("/_app/pipeline")({
  loader: async () => {
    const [deals, companies, contacts, users] = await Promise.all([
      getDeals(),
      getCompanies(),
      getContacts(),
      getUsers(),
    ]);
    return { deals, companies, contacts, users };
  },
  component: PipelinePage,
});

function PipelinePage() {
  const { deals, companies, contacts, users } = Route.useLoaderData();
  const router = useRouter();
  const [editing, setEditing] = useState<Row | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("all");

  const refresh = () => router.invalidate();

  function startAdd() {
    setEditing(null);
    setOpen(true);
  }
  function startEdit(d: Row) {
    setEditing(d);
    setOpen(true);
  }

  async function onStageChange(id: string, stage: string) {
    setBusy(true);
    await setDealStage({ data: { id, stage } });
    await refresh();
    setBusy(false);
  }
  async function onDelete(id: string) {
    if (!confirm("Delete this deal?")) return;
    setBusy(true);
    await deleteDeal({ data: { id } });
    await refresh();
    setBusy(false);
  }

  const visible = (deals as Row[]).filter((d) =>
    filter === "all"
      ? true
      : filter === "open"
        ? stageInfo(d.stage as string).kind === "open"
        : d.stage === filter,
  );

  const openValue = (deals as Row[])
    .filter((d) => stageInfo(d.stage as string).kind === "open")
    .reduce((s, d) => s + Number(d.value), 0);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Pipeline</h1>
          <p className="text-sm text-slate-500">
            {(deals as Row[]).length} deals · {formatMoney(openValue)} open
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={filter} onChange={(e) => setFilter(e.target.value)} className="w-auto">
            <option value="all">All stages</option>
            <option value="open">Open only</option>
            {STAGE_NAMES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
          <Button onClick={startAdd}>+ New deal</Button>
        </div>
      </div>

      <Card className="mt-5 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500">
                <th className="px-4 py-2 font-medium">Deal</th>
                <th className="px-4 py-2 font-medium">Company</th>
                <th className="px-4 py-2 font-medium">Owner</th>
                <th className="px-4 py-2 font-medium">Stage</th>
                <th className="px-4 py-2 font-medium">Value</th>
                <th className="px-4 py-2 font-medium">Weighted</th>
                <th className="px-4 py-2 font-medium">Age</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((d) => {
                const info = stageInfo(d.stage as string);
                const age = daysBetween(d.stage_changed_at as string);
                return (
                  <tr key={d.id as string} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-2.5">
                      <button onClick={() => startEdit(d)} className="font-medium text-slate-800 hover:text-indigo-600">
                        {d.name as string}
                      </button>
                      {d.next_step ? (
                        <div className="text-xs text-slate-400">Next: {d.next_step as string}</div>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{(d.company_name as string) || "—"}</td>
                    <td className="px-4 py-2.5 text-slate-600">{(d.owner_name as string) || "—"}</td>
                    <td className="px-4 py-2.5">
                      <select
                        value={d.stage as string}
                        disabled={busy}
                        onChange={(e) => onStageChange(d.id as string, e.target.value)}
                        className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium"
                        style={{ color: info.color }}
                      >
                        {STAGE_NAMES.map((s) => (
                          <option key={s} value={s} style={{ color: "#0f172a" }}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2.5 text-slate-700">{formatMoney(Number(d.value))}</td>
                    <td className="px-4 py-2.5 text-slate-500">
                      {info.kind === "open" ? formatMoney(Number(d.value) * info.prob) : "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={
                          "rounded-full px-2 py-0.5 text-xs " +
                          (info.kind === "open" && age >= 14
                            ? "bg-amber-50 text-amber-600"
                            : "text-slate-400")
                        }
                      >
                        {info.kind === "open" ? `${age}d` : "—"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => onDelete(d.id as string)}
                        className="text-xs text-slate-400 hover:text-red-600"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {visible.length === 0 ? (
          <div className="p-4">
            <EmptyState title="No deals here yet" hint="Click “New deal” to add your first one." />
          </div>
        ) : null}
      </Card>

      <DealModal
        open={open}
        onClose={() => setOpen(false)}
        deal={editing}
        companies={companies as Row[]}
        contacts={contacts as Row[]}
        users={users as Row[]}
        onSaved={async () => {
          setOpen(false);
          await refresh();
        }}
      />
    </div>
  );
}

function DealModal({
  open,
  onClose,
  deal,
  companies,
  contacts,
  users,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  deal: Row | null;
  companies: Row[];
  contacts: Row[];
  users: Row[];
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    const fd = new FormData(e.currentTarget);
    const payload = {
      id: (deal?.id as string) || undefined,
      name: String(fd.get("name") || ""),
      company_id: (fd.get("company_id") as string) || null,
      contact_id: (fd.get("contact_id") as string) || null,
      owner_id: (fd.get("owner_id") as string) || null,
      stage: String(fd.get("stage") || "Lead"),
      value: parseFloat(String(fd.get("value") || "0")) || 0,
      expected_close: (fd.get("expected_close") as string) || null,
      next_step: (fd.get("next_step") as string) || null,
      notes: (fd.get("notes") as string) || null,
    };
    await upsertDeal({ data: payload });
    setSaving(false);
    onSaved();
  }

  return (
    <Modal open={open} onClose={onClose} title={deal ? "Edit deal" : "New deal"} wide>
      <form onSubmit={onSubmit} className="space-y-3">
        <Field label="Deal name">
          <Input name="name" required defaultValue={(deal?.name as string) || ""} placeholder="Acme — new website build" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Company">
            <Select name="company_id" defaultValue={(deal?.company_id as string) || ""}>
              <option value="">—</option>
              {companies.map((c) => (
                <option key={c.id as string} value={c.id as string}>
                  {c.name as string}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Primary contact">
            <Select name="contact_id" defaultValue={(deal?.contact_id as string) || ""}>
              <option value="">—</option>
              {contacts.map((c) => (
                <option key={c.id as string} value={c.id as string}>
                  {`${c.first_name as string} ${(c.last_name as string) || ""}`.trim()}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Owner">
            <Select name="owner_id" defaultValue={(deal?.owner_id as string) || ""}>
              <option value="">—</option>
              {users.map((u) => (
                <option key={u.id as string} value={u.id as string}>
                  {u.name as string}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Stage">
            <Select name="stage" defaultValue={(deal?.stage as string) || "Lead"}>
              {STAGE_NAMES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Value ($)">
            <Input name="value" type="number" min="0" step="100" defaultValue={String(deal?.value ?? "")} placeholder="5000" />
          </Field>
          <Field label="Expected close">
            <Input name="expected_close" type="date" defaultValue={((deal?.expected_close as string) || "").slice(0, 10)} />
          </Field>
        </div>
        <Field label="Next step">
          <Input name="next_step" defaultValue={(deal?.next_step as string) || ""} placeholder="Send proposal by Friday" />
        </Field>
        <Field label="Notes">
          <Textarea name="notes" defaultValue={(deal?.notes as string) || ""} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save deal"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
