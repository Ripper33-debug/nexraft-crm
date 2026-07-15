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
import {
  Button,
  Card,
  Field,
  Input,
  Modal,
  Select,
  Textarea,
  EmptyState,
  PageHeader,
  SummaryCard,
  StageBadge,
  OwnerChip,
  Pill,
  Avatar,
  cx,
} from "../../components/crm/ui";
import { NotesThread } from "../../components/crm/notes";
import { STAGES, STAGE_NAMES, LOST_REASONS, formatMoney, stageInfo, daysBetween } from "../../lib/crm/constants";
import { downloadCsv, stampedName } from "../../lib/crm/csv";

type Row = Record<string, unknown>;

function exportDeals(rows: Row[]) {
  downloadCsv(
    stampedName("nexraft_deals"),
    rows.map((d) => ({
      Deal: String(d.name ?? ""),
      Company: String(d.company_name ?? ""),
      Contact: `${(d.contact_first as string) ?? ""} ${(d.contact_last as string) ?? ""}`.trim(),
      Owner: String(d.owner_name ?? ""),
      Stage: String(d.stage ?? ""),
      Value: String(d.value ?? 0),
      "Expected close": String(d.expected_close ?? ""),
      "Next step": String(d.next_step ?? ""),
      "Lost reason": String(d.lost_reason ?? ""),
      Notes: String(d.notes ?? ""),
    })),
  );
}

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
  const [view, setView] = useState<"board" | "table">("board");
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

  const all = deals as Row[];
  const visible = all.filter((d) =>
    filter === "all"
      ? true
      : filter === "open"
        ? stageInfo(d.stage as string).kind === "open"
        : d.stage === filter,
  );

  const openDeals = all.filter((d) => stageInfo(d.stage as string).kind === "open");
  const openValue = openDeals.reduce((s, d) => s + Number(d.value), 0);
  const weighted = openDeals.reduce(
    (s, d) => s + Number(d.value) * (stageInfo(d.stage as string).prob ?? 0),
    0,
  );

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
      <PageHeader
        title="Pipeline"
        subtitle={`${all.length} deals · ${openDeals.length} open`}
        actions={
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-line bg-surface p-0.5">
              <button
                onClick={() => setView("board")}
                className={cx(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  view === "board" ? "bg-signal-soft text-signal" : "text-mute hover:text-bone",
                )}
              >
                Board
              </button>
              <button
                onClick={() => setView("table")}
                className={cx(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  view === "table" ? "bg-signal-soft text-signal" : "text-mute hover:text-bone",
                )}
              >
                Table
              </button>
            </div>
            <Button variant="outline" onClick={() => exportDeals(all)}>
              Export CSV
            </Button>
            <Button onClick={startAdd}>+ New deal</Button>
          </div>
        }
      />

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <SummaryCard label="Open pipeline" value={formatMoney(openValue)} sub={`${openDeals.length} open deals`} accent />
        <SummaryCard label="Weighted forecast" value={formatMoney(weighted)} sub="Probability-adjusted" />
        <SummaryCard label="Total deals" value={String(all.length)} sub="All stages" />
      </div>

      {view === "board" ? (
        <KanbanBoard
          deals={all}
          busy={busy}
          onStageChange={onStageChange}
          onEdit={startEdit}
        />
      ) : (
        <PipelineTable
          deals={visible}
          filter={filter}
          setFilter={setFilter}
          busy={busy}
          onStageChange={onStageChange}
          onEdit={startEdit}
          onDelete={onDelete}
        />
      )}

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

// ---------- Kanban board (drag a card between stages to move the deal) ----------
function KanbanBoard({
  deals,
  busy,
  onStageChange,
  onEdit,
}: {
  deals: Row[];
  busy: boolean;
  onStageChange: (id: string, stage: string) => void;
  onEdit: (d: Row) => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);

  function handleDrop(stage: string) {
    if (dragId) {
      const deal = deals.find((d) => d.id === dragId);
      if (deal && deal.stage !== stage) onStageChange(dragId, stage);
    }
    setDragId(null);
    setOverStage(null);
  }

  return (
    <div className="mt-4 flex gap-3 overflow-x-auto pb-3">
      {STAGES.map((s) => {
        const col = deals.filter((d) => d.stage === s.name);
        const total = col.reduce((sum, d) => sum + Number(d.value), 0);
        const isOver = overStage === s.name;
        return (
          <div
            key={s.name}
            onDragOver={(e) => {
              e.preventDefault();
              setOverStage(s.name);
            }}
            onDragLeave={() => setOverStage((cur) => (cur === s.name ? null : cur))}
            onDrop={() => handleDrop(s.name)}
            className={cx(
              "flex w-72 shrink-0 flex-col rounded-xl border bg-surface/60 transition-colors",
              isOver ? "border-signal/60 bg-surface-2/60" : "border-line",
            )}
          >
            <div className="flex items-center justify-between px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                <span className="text-sm font-semibold text-bone">{s.name}</span>
                <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[11px] text-mute">{col.length}</span>
              </div>
              <span className="font-mono text-[11px] text-faint">{formatMoney(total)}</span>
            </div>
            <div className="flex min-h-24 flex-1 flex-col gap-2 px-2 pb-2">
              {col.map((d) => {
                const age = daysBetween(d.stage_changed_at as string);
                const stale = s.kind === "open" && age >= 14;
                return (
                  <div
                    key={d.id as string}
                    draggable={!busy}
                    onDragStart={() => setDragId(d.id as string)}
                    onDragEnd={() => {
                      setDragId(null);
                      setOverStage(null);
                    }}
                    onClick={() => onEdit(d)}
                    className={cx(
                      "cursor-grab rounded-lg border border-line bg-surface p-2.5 shadow-sm transition-colors hover:border-line-strong active:cursor-grabbing",
                      dragId === d.id ? "opacity-50" : "",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-sm font-medium text-bone">{d.name as string}</div>
                      {stale ? <Pill tone="warn">{age}d</Pill> : null}
                    </div>
                    {d.company_name ? (
                      <div className="mt-0.5 truncate text-xs text-faint">{d.company_name as string}</div>
                    ) : null}
                    <div className="mt-2 flex items-center justify-between">
                      <span className="font-mono text-xs text-signal">{formatMoney(Number(d.value))}</span>
                      {d.owner_name ? <Avatar name={d.owner_name as string} size={20} /> : null}
                    </div>
                    {d.next_step ? (
                      <div className="mt-1.5 truncate border-t border-line/60 pt-1.5 text-[11px] text-faint">
                        Next: {d.next_step as string}
                      </div>
                    ) : null}
                  </div>
                );
              })}
              {col.length === 0 ? (
                <div className="rounded-lg border border-dashed border-line/70 px-2 py-6 text-center text-[11px] text-faint">
                  Drop deals here
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------- Table view ----------
function PipelineTable({
  deals,
  filter,
  setFilter,
  busy,
  onStageChange,
  onEdit,
  onDelete,
}: {
  deals: Row[];
  filter: string;
  setFilter: (v: string) => void;
  busy: boolean;
  onStageChange: (id: string, stage: string) => void;
  onEdit: (d: Row) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <>
      <div className="mt-4 flex justify-end">
        <Select value={filter} onChange={(e) => setFilter(e.target.value)} className="w-auto">
          <option value="all">All stages</option>
          <option value="open">Open only</option>
          {STAGE_NAMES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      </div>
      <Card className="mt-3 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                <th className="px-4 py-2.5 font-medium">Deal</th>
                <th className="px-4 py-2.5 font-medium">Company</th>
                <th className="px-4 py-2.5 font-medium">Owner</th>
                <th className="px-4 py-2.5 font-medium">Stage</th>
                <th className="px-4 py-2.5 font-medium">Value</th>
                <th className="px-4 py-2.5 font-medium">Weighted</th>
                <th className="px-4 py-2.5 font-medium">Age</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {deals.map((d) => {
                const info = stageInfo(d.stage as string);
                const age = daysBetween(d.stage_changed_at as string);
                return (
                  <tr key={d.id as string} className="border-b border-line/60 last:border-0 hover:bg-surface-2/60">
                    <td className="px-4 py-2.5">
                      <button onClick={() => onEdit(d)} className="font-medium text-bone hover:text-signal">
                        {d.name as string}
                      </button>
                      {d.next_step ? (
                        <div className="text-xs text-faint">Next: {d.next_step as string}</div>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5 text-mute">{(d.company_name as string) || "—"}</td>
                    <td className="px-4 py-2.5"><OwnerChip name={d.owner_name as string} /></td>
                    <td className="px-4 py-2.5">
                      <select
                        value={d.stage as string}
                        disabled={busy}
                        onChange={(e) => onStageChange(d.id as string, e.target.value)}
                        className="rounded-md border border-line bg-surface-2 px-2 py-1 text-xs font-semibold outline-none"
                        style={{ color: info.color }}
                      >
                        {STAGE_NAMES.map((s) => (
                          <option key={s} value={s} style={{ color: "#e8ede9", backgroundColor: "#0f1512" }}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2.5 font-medium text-bone">{formatMoney(Number(d.value))}</td>
                    <td className="px-4 py-2.5 text-mute">
                      {info.kind === "open" ? formatMoney(Number(d.value) * info.prob) : "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      {info.kind === "open" ? (
                        <Pill tone={age >= 14 ? "warn" : "neutral"}>{age}d</Pill>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => onDelete(d.id as string)}
                        className="text-xs text-faint hover:text-red-400"
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
        {deals.length === 0 ? (
          <div className="p-4">
            <EmptyState title="No deals here yet" hint="Click “New deal” to add your first one." />
          </div>
        ) : null}
      </Card>
    </>
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
  const [stage, setStage] = useState<string>((deal?.stage as string) || "Lead");

  // Reset the tracked stage whenever a different deal opens in the modal.
  const dealKey = (deal?.id as string) || "new";
  const [lastKey, setLastKey] = useState(dealKey);
  if (lastKey !== dealKey) {
    setLastKey(dealKey);
    setStage((deal?.stage as string) || "Lead");
  }

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
      lost_reason: (fd.get("lost_reason") as string) || null,
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
            <Select name="stage" value={stage} onChange={(e) => setStage(e.target.value)}>
              {STAGE_NAMES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {stage === "Lost" ? (
          <Field label="Why was it lost? (helps win/loss analytics)">
            <Select name="lost_reason" defaultValue={(deal?.lost_reason as string) || ""}>
              <option value="">—</option>
              {LOST_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
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

      {deal?.id ? (
        <div className="mt-5 border-t border-line pt-4">
          <NotesThread entityType="deal" entityId={deal.id as string} />
        </div>
      ) : null}
    </Modal>
  );
}
