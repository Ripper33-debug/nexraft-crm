import { createFileRoute, useRouter, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import {
  getDeals,
  getCompanies,
  getContacts,
  getUsers,
  upsertDeal,
  setDealStage,
  archiveDeal,
  restoreDeal,
  getProposalLink,
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
  PageSkeleton,
} from "../../components/crm/ui";
import { NotesThread } from "../../components/crm/notes";
import { ResearchPanel } from "../../components/crm/research-panel";
import { RecordAccessButton } from "../../components/crm/record-access";
import { ArchivedPanel } from "../../components/crm/archived";
import { fireConfetti } from "../../lib/crm/confetti";
import {
  STAGES,
  STAGE_NAMES,
  LOST_REASONS,
  WIN_REASONS,
  formatMoney,
  formatRange,
  pipelineValueRange,
  pipelineMrrRange,
  stageInfo,
  daysBetween,
  parseLinks,
  serializeLinks,
  normalizeUrl,
  canEditRecord,
  proposalInfo,
  PROPOSAL_STATUSES,
  type DealLink,
} from "../../lib/crm/constants";
import { downloadCsv, stampedName } from "../../lib/crm/csv";
import { toast } from "../../components/crm/toast";

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
      "Monthly value": String(d.monthly_value ?? 0),
      "Renewal date": String(d.renewal_date ?? ""),
      "Expected close": String(d.expected_close ?? ""),
      "Next step": String(d.next_step ?? ""),
      Proposal: proposalInfo(d.proposal_status as string).label,
      "Win reason": String(d.win_reason ?? ""),
      "Lost reason": String(d.lost_reason ?? ""),
      Links: parseLinks(d.links as string)
        .map((l) => (l.label ? `${l.label}: ${l.url}` : l.url))
        .join(" | "),
      Notes: String(d.notes ?? ""),
    })),
  );
}

export const Route = createFileRoute("/_app/pipeline")({
  validateSearch: (search: Record<string, unknown>) => ({
    focus: typeof search.focus === "string" ? search.focus : undefined,
    new: search.new === true || search.new === "true" ? true : undefined,
  }),
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
  pendingComponent: () => <PageSkeleton cards={3} rows={6} />,
});

function PipelinePage() {
  const { deals, companies, contacts, users } = Route.useLoaderData();
  const { user: me } = Route.useRouteContext();
  const isAdmin = me?.role === "admin";
  const { focus, new: newParam } = Route.useSearch();
  const router = useRouter();
  const navigate = Route.useNavigate();
  const [editing, setEditing] = useState<Row | null>(null);
  const [open, setOpen] = useState(false);

  // Deep-link from global search: ?focus=<id> auto-opens the matching deal.
  useEffect(() => {
    if (!focus) return;
    const match = (deals as Row[]).find((d) => d.id === focus);
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
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<"board" | "table">("board");
  const [filter, setFilter] = useState("all");
  const [ownerFilter, setOwnerFilter] = useState("");

  const refresh = () => router.invalidate();

  // Companies with a saved research dossier — the board flags their deals with
  // a 🔎 pill so reps know which cards come with ready-made intel + a drafted
  // email before they even open them.
  const researched = new Set(
    (companies as Row[]).filter((c) => Boolean(c.research)).map((c) => c.id as string),
  );

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
    // Grab the name + previous stage before we refresh so the celebration can
    // call it out and Undo can move it back.
    const deal = (deals as Row[]).find((d) => d.id === id);
    const prevStage = (deal?.stage as string) || "";
    const won = stage === "Launched" && prevStage !== "Launched";
    const wonName = won ? ((deal?.company_name as string) || (deal?.name as string)) : "";
    // A win with no price is invisible on the revenue chart — ask for the
    // number right at the moment of celebration, when the rep knows it cold.
    let wonValue: number | undefined;
    if (won && !Number(deal?.value)) {
      const raw = window.prompt(
        `Nice — what did ${wonName || "this deal"} close for? (build price in $)`,
        "",
      );
      if (raw) {
        const parsed = Number(raw.replace(/[^0-9.]/g, ""));
        if (isFinite(parsed) && parsed > 0) wonValue = parsed;
      }
    }
    try {
      await setDealStage({ data: { id, stage, value: wonValue } });
      await refresh();
      if (won) {
        fireConfetti();
        toast(`🎉 ${wonName || "Deal"} is a win!`);
      } else {
        const undo =
          prevStage && prevStage !== stage
            ? {
                label: "Undo",
                onClick: async () => {
                  try {
                    await setDealStage({ data: { id, stage: prevStage } });
                    await refresh();
                    toast(`Moved back to ${prevStage}`);
                  } catch {
                    toast("Couldn't undo — try again", "error");
                  }
                },
              }
            : undefined;
        toast(stage === "Lost" ? "Deal marked lost" : `Moved to ${stage}`, "success", undo);
      }
    } catch {
      toast("Couldn't move the deal — try again", "error");
    } finally {
      setBusy(false);
    }
  }
  async function onArchive(id: string) {
    setBusy(true);
    try {
      await archiveDeal({ data: { id } });
      await refresh();
      toast("Deal archived", "info", {
        label: "Undo",
        onClick: async () => {
          try {
            await restoreDeal({ data: { id } });
            await refresh();
            toast("Deal restored");
          } catch {
            toast("Couldn't restore — try again", "error");
          }
        },
      });
    } catch {
      toast("Couldn't archive — try again", "error");
    } finally {
      setBusy(false);
    }
  }

  const allDeals = deals as Row[];
  // Scope everything (board, table, KPIs) to the selected owner.
  const all = ownerFilter
    ? allDeals.filter((d) => (ownerFilter === "__none__" ? !d.owner_id : d.owner_id === ownerFilter))
    : allDeals;
  const visible = all.filter((d) =>
    filter === "all"
      ? true
      : filter === "open"
        ? stageInfo(d.stage as string).kind === "open"
        : d.stage === filter,
  );

  // Companies that haven't been triaged yet — the "need to call" queue.
  const needToCall = (companies as Row[]).filter((c) => !c.call_outcome).length;

  const openDeals = all.filter((d) => stageInfo(d.stage as string).kind === "open");
  const openValue = openDeals.reduce((s, d) => s + Number(d.value), 0);
  const weighted = openDeals.reduce(
    (s, d) => s + Number(d.value) * (stageInfo(d.stage as string).prob ?? 0),
    0,
  );
  // Deals still sitting at $0 (typically fresh "To Call" ones) get an estimated
  // Starter→Pro band so the pipeline shows a realistic low–high, not an undercount.
  const openUnpriced = openDeals.filter((d) => Number(d.value) <= 0).length;
  const openMonthly = openDeals.reduce((s, d) => s + Number(d.monthly_value || 0), 0);
  const valueRange = pipelineValueRange(openValue, openUnpriced);
  const mrrRange = pipelineMrrRange(openMonthly, openUnpriced);

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
      <PageHeader
        title="Pipeline"
        subtitle={`${all.length} deals · ${openDeals.length} open`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={ownerFilter}
              onChange={(e) => setOwnerFilter(e.target.value)}
              className="h-9 w-auto min-w-[9rem] py-1.5 text-xs"
            >
              <option value="">All owners</option>
              {(users as Row[]).map((u) => (
                <option key={u.id as string} value={u.id as string}>
                  {u.name as string}
                </option>
              ))}
              <option value="__none__">Unassigned</option>
            </Select>
            <div className="flex rounded-lg border border-line bg-surface p-0.5" role="group" aria-label="Pipeline view">
              <button
                onClick={() => setView("board")}
                aria-pressed={view === "board"}
                aria-label="Board view"
                className={cx(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  view === "board" ? "bg-signal-soft text-signal" : "text-mute hover:text-bone",
                )}
              >
                Board
              </button>
              <button
                onClick={() => setView("table")}
                aria-pressed={view === "table"}
                aria-label="Table view"
                className={cx(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  view === "table" ? "bg-signal-soft text-signal" : "text-mute hover:text-bone",
                )}
              >
                Table
              </button>
            </div>
            {isAdmin ? (
              <Button variant="outline" onClick={() => exportDeals(allDeals)}>
                Export CSV
              </Button>
            ) : null}
            <Button onClick={startAdd}>+ New deal</Button>
          </div>
        }
      />

      {needToCall > 0 ? (
        <Link
          to="/calls"
          className="mt-4 flex items-center gap-3 rounded-md border border-signal/30 bg-signal-soft/30 px-4 py-3 transition-colors hover:bg-signal-soft/50"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-signal text-xs font-bold text-ink">
            {needToCall}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-bone">
              {needToCall} compan{needToCall === 1 ? "y needs" : "ies need"} a first call
            </div>
            <div className="text-xs text-mute">Fresh accounts waiting on a first call — triage them into interested or not.</div>
          </div>
          <span className="shrink-0 text-xs font-medium text-signal">Go to call queue →</span>
        </Link>
      ) : null}

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard
          label="Open pipeline"
          value={formatRange(valueRange.low, valueRange.high)}
          sub={openUnpriced > 0 ? `${openDeals.length} open · ${openUnpriced} estimated` : `${openDeals.length} open deals`}
          accent
          hint="The build value of every deal still in progress. Deals that haven't been priced yet are estimated using the Starter–Pro range, so this shows a low–high span."
        />
        <SummaryCard
          label="Est. monthly (MRR)"
          value={formatRange(mrrRange.low, mrrRange.high)}
          sub={openUnpriced > 0 ? "Includes unpriced estimates" : "Retainers in the pipeline"}
          hint="Recurring monthly retainer value across open deals. Unpriced deals are estimated on the Starter–Pro monthly range."
        />
        <SummaryCard label="Weighted forecast" value={formatMoney(weighted)} sub="Probability-adjusted" hint="Open deal value adjusted by how likely each stage is to close — a more realistic estimate of what you'll actually land." />
        <SummaryCard label="Total deals" value={String(all.length)} sub="All stages" hint="Every deal in this view across all stages, including won and lost." />
      </div>

      {view === "board" ? (
        <KanbanBoard
          deals={all}
          busy={busy}
          onStageChange={onStageChange}
          onEdit={startEdit}
          users={users as Row[]}
          me={me}
          researched={researched}
          onAccessDone={() => router.invalidate()}
        />
      ) : (
        <PipelineTable
          deals={visible}
          filter={filter}
          setFilter={setFilter}
          busy={busy}
          onStageChange={onStageChange}
          onEdit={startEdit}
          onArchive={onArchive}
          onAdd={startAdd}
          users={users as Row[]}
          me={me}
          onAccessDone={() => router.invalidate()}
        />
      )}

      <ArchivedPanel entity="deal" onRestored={() => router.invalidate()} />

      <DealModal
        open={open}
        onClose={() => setOpen(false)}
        deal={editing}
        companies={companies as Row[]}
        contacts={contacts as Row[]}
        users={users as Row[]}
        canEdit={!editing || canEditRecord(me, (editing.owner_id as string) ?? null, (editing.shared_with as string) ?? null)}
        onSaved={async () => {
          setOpen(false);
          await refresh();
        }}
      />
    </div>
  );
}

// One-click proposal link straight from a board card — first click flips the
// deal to proposal "sent" server-side (starting the 3-day chaser clock in My
// Day) and copies the public link, so a rep never has to open the deal page
// just to send a proposal.
function CardProposalButton({ dealId, status }: { dealId: string; status: string }) {
  const [busy, setBusy] = useState(false);
  const sent = status !== "none" && status !== "";
  return (
    <button
      disabled={busy}
      onClick={async (e) => {
        e.stopPropagation();
        setBusy(true);
        try {
          const { token } = await getProposalLink({ data: { dealId } });
          const url = `${window.location.origin}/proposal/${token}`;
          try {
            await navigator.clipboard.writeText(url);
            toast("📋 Proposal link copied — paste it into your email. You'll get pinged when they open it.", "success");
          } catch {
            prompt("Copy your proposal link:", url);
          }
        } catch {
          toast("Couldn't create the proposal link — try again.", "error");
        } finally {
          setBusy(false);
        }
      }}
      className="text-xs transition-opacity hover:opacity-80 disabled:opacity-40"
      title={sent ? "Proposal already sent — copy the link again" : "Send proposal — copies the link to paste into your email"}
    >
      📨
    </button>
  );
}

// ---------- Kanban board (drag a card between stages to move the deal) ----------
function KanbanBoard({
  deals,
  busy,
  onStageChange,
  onEdit,
  users,
  me,
  researched,
  onAccessDone,
}: {
  deals: Row[];
  busy: boolean;
  onStageChange: (id: string, stage: string) => void;
  onEdit: (d: Row) => void;
  users: Row[];
  me: { id: string; role: string };
  researched: Set<string>;
  onAccessDone: () => void;
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
              "flex w-72 shrink-0 flex-col rounded-md border bg-surface/60 transition-all duration-150",
              isOver ? "border-signal/60 bg-surface-2/70 ring-2 ring-signal/20" : "border-line",
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
                const health =
                  s.kind !== "open"
                    ? null
                    : age < 7
                      ? { c: "#34d399", t: "On track" }
                      : age < 14
                        ? { c: "#f59e0b", t: `${age}d in stage` }
                        : { c: "#ef4444", t: `Stuck ${age} days` };
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
                      "cursor-grab rounded-lg border border-line bg-surface p-2.5 shadow-sm transition-all duration-150 active:cursor-grabbing",
                      dragId === d.id
                        ? "rotate-[1.5deg] scale-[1.02] opacity-80 shadow-lg shadow-black/40 ring-1 ring-signal/40"
                        : "hover:-translate-y-0.5 hover:border-line-strong hover:shadow-md",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-start gap-1.5">
                        {health ? (
                          <span
                            className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                            style={{ backgroundColor: health.c, boxShadow: `0 0 6px ${health.c}80` }}
                            title={health.t}
                          />
                        ) : null}
                        <div className="min-w-0 text-sm font-medium text-bone">{d.name as string}</div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {researched.has((d.company_id as string) ?? "") ? (
                          <span title="Research done — intel & drafted email inside" className="text-xs">🔎</span>
                        ) : null}
                        {stale ? <Pill tone="warn">{age}d</Pill> : null}
                      </div>
                    </div>
                    {d.company_name ? (
                      <div className="mt-0.5 truncate text-xs text-faint">{d.company_name as string}</div>
                    ) : null}
                    <div className="mt-2 flex items-center justify-between">
                      <span className="font-mono text-xs text-signal">{formatMoney(Number(d.value))}</span>
                      <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                        {(d.stage === "Proposal" || d.stage === "Negotiation") ? (
                          <CardProposalButton dealId={d.id as string} status={String(d.proposal_status ?? "none")} />
                        ) : null}
                        <RecordAccessButton
                          entity="deal"
                          record={{ id: d.id as string, owner_id: (d.owner_id as string) ?? null, owner_name: (d.owner_name as string) ?? null, shared_with: (d.shared_with as string) ?? null }}
                          users={users as { id: string; name: string; email?: string; role?: string }[]}
                          me={me}
                          onDone={onAccessDone}
                        />
                        {d.owner_name ? <Avatar name={d.owner_name as string} size={20} /> : null}
                      </div>
                    </div>
                    {/* Tap-to-move: change stage without dragging — essential on
                        touch/mobile where dragging across columns barely works, and
                        a faster path than drag on desktop too. */}
                    <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                      <select
                        value={d.stage as string}
                        disabled={busy}
                        onChange={(e) => onStageChange(d.id as string, e.target.value)}
                        aria-label={`Move ${d.name as string} to a different stage`}
                        className="w-full rounded-md border border-line bg-surface-2/70 px-2 py-1.5 text-[11px] font-medium text-mute outline-none transition-colors hover:border-signal/40 focus:border-signal/60"
                      >
                        {STAGE_NAMES.map((st) => (
                          <option key={st} value={st} style={{ color: "#e8ede9", backgroundColor: "#0f1512" }}>
                            {st === (d.stage as string) ? `● ${st}` : `Move to ${st}`}
                          </option>
                        ))}
                      </select>
                    </div>
                    {Number(d.monthly_value) > 0 || parseLinks(d.links as string).length > 0 || (d.proposal_status && d.proposal_status !== "none") ? (
                      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-faint">
                        {d.proposal_status && d.proposal_status !== "none" ? (
                          <span
                            className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-medium"
                            style={{
                              color: proposalInfo(d.proposal_status as string).color,
                              backgroundColor: `${proposalInfo(d.proposal_status as string).color}1a`,
                            }}
                          >
                            📄 {proposalInfo(d.proposal_status as string).label}
                          </span>
                        ) : null}
                        {Number(d.monthly_value) > 0 ? (
                          <span className="text-signal/80">↻ {formatMoney(Number(d.monthly_value))}/mo</span>
                        ) : null}
                        {parseLinks(d.links as string).length > 0 ? (
                          <span>{parseLinks(d.links as string).length} link{parseLinks(d.links as string).length > 1 ? "s" : ""}</span>
                        ) : null}
                      </div>
                    ) : null}
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
  onArchive,
  onAdd,
  users,
  me,
  onAccessDone,
}: {
  deals: Row[];
  filter: string;
  setFilter: (v: string) => void;
  busy: boolean;
  onStageChange: (id: string, stage: string) => void;
  onEdit: (d: Row) => void;
  onArchive: (id: string) => void;
  onAdd: () => void;
  users: Row[];
  me: { id: string; role: string };
  onAccessDone: () => void;
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
              <tr className="border-b border-line text-left text-xs font-medium text-faint">
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
                      <Link to="/deals/$dealId" params={{ dealId: d.id as string }} className="font-medium text-bone hover:text-signal">
                        {d.name as string}
                      </Link>
                      {d.proposal_status && d.proposal_status !== "none" ? (
                        <span
                          className="ml-2 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 align-middle text-[10px] font-medium"
                          style={{
                            color: proposalInfo(d.proposal_status as string).color,
                            backgroundColor: `${proposalInfo(d.proposal_status as string).color}1a`,
                          }}
                        >
                          📄 {proposalInfo(d.proposal_status as string).label}
                        </span>
                      ) : null}
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
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-3">
                        <RecordAccessButton
                          entity="deal"
                          record={{ id: d.id as string, owner_id: (d.owner_id as string) ?? null, owner_name: (d.owner_name as string) ?? null, shared_with: (d.shared_with as string) ?? null }}
                          users={users as { id: string; name: string; email?: string; role?: string }[]}
                          me={me}
                          onDone={onAccessDone}
                        />
                        {canEditRecord(me, (d.owner_id as string) ?? null, (d.shared_with as string) ?? null) ? (
                          <button
                            onClick={() => onArchive(d.id as string)}
                            className="text-xs text-faint hover:text-red-600"
                          >
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
        {deals.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="No deals here yet"
              hint="A deal is a website project you're working to win. Add your first one to start tracking it through the pipeline."
              action={<Button onClick={onAdd}>+ New deal</Button>}
            />
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
  canEdit = true,
}: {
  open: boolean;
  onClose: () => void;
  deal: Row | null;
  companies: Row[];
  contacts: Row[];
  users: Row[];
  onSaved: () => void;
  canEdit?: boolean;
}) {
  const [saving, setSaving] = useState(false);
  const [stage, setStage] = useState<string>((deal?.stage as string) || "To Call");
  const [links, setLinks] = useState<DealLink[]>(parseLinks(deal?.links as string));

  // The deal's company row (carries the research dossier) — lets the rep read
  // the intel and run/copy the AI research right here in the pipeline instead
  // of jumping over to the company page.
  const dealCompany = deal?.company_id
    ? companies.find((c) => c.id === (deal.company_id as string)) ?? null
    : null;

  // Reset the tracked stage + links whenever a different deal opens in the modal.
  const dealKey = (deal?.id as string) || "new";
  const [lastKey, setLastKey] = useState(dealKey);
  if (lastKey !== dealKey) {
    setLastKey(dealKey);
    setStage((deal?.stage as string) || "To Call");
    setLinks(parseLinks(deal?.links as string));
  }

  function updateLink(i: number, patch: Partial<DealLink>) {
    setLinks((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  function addLink() {
    setLinks((prev) => [...prev, { label: "", url: "" }]);
  }
  function removeLink(i: number) {
    setLinks((prev) => prev.filter((_, idx) => idx !== i));
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
      stage: String(fd.get("stage") || "To Call"),
      value: parseFloat(String(fd.get("value") || "0")) || 0,
      monthly_value: parseFloat(String(fd.get("monthly_value") || "0")) || 0,
      renewal_date: (fd.get("renewal_date") as string) || null,
      expected_close: (fd.get("expected_close") as string) || null,
      next_step: (fd.get("next_step") as string) || null,
      proposal_status: ((fd.get("proposal_status") as string) || "none") as "none" | "sent" | "viewed" | "signed",
      notes: (fd.get("notes") as string) || null,
      lost_reason: (fd.get("lost_reason") as string) || null,
      win_reason: (fd.get("win_reason") as string) || null,
      links: serializeLinks(links.map((l) => ({ label: l.label.trim(), url: normalizeUrl(l.url) }))),
    };
    const won = payload.stage === "Launched" && deal?.stage !== "Launched";
    try {
      await upsertDeal({ data: payload });
      if (won) {
        fireConfetti();
        toast(`🎉 ${(deal?.company_name as string) || payload.name || "Deal"} is a win!`);
      } else {
        toast(deal?.id ? "Deal updated" : "Deal added");
      }
      onSaved();
    } catch {
      toast("Couldn't save — please try again", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={deal ? "Edit deal" : "New deal"} wide>
      {!canEdit ? (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-line-strong bg-surface-2/60 px-3 py-2 text-xs text-mute">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0 text-faint">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <span>
            {deal?.owner_name ? `Owned by ${deal.owner_name as string}.` : "You don't own this record."} You have
            view-only access — ask the owner to hand it off or share edit access to make changes.
          </span>
        </div>
      ) : null}
      {dealCompany ? (
        <div className="mb-3">
          {/* Keyed by company so switching deals resets the panel's local dossier state. */}
          <ResearchPanel key={dealCompany.id as string} company={dealCompany} />
        </div>
      ) : null}
      <form onSubmit={onSubmit} className="space-y-3">
        <fieldset disabled={!canEdit} className={canEdit ? "space-y-3" : "space-y-3 opacity-60"}>
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
        {stage === "Launched" ? (
          <Field label="Why did we win? (helps win/loss analytics)">
            <Select name="win_reason" defaultValue={(deal?.win_reason as string) || ""}>
              <option value="">—</option>
              {WIN_REASONS.map((r) => (
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
        <div className="grid grid-cols-2 gap-3">
          <Field label="Monthly value ($) — retainer / hosting">
            <Input
              name="monthly_value"
              type="number"
              min="0"
              step="50"
              defaultValue={deal?.monthly_value ? String(deal.monthly_value) : ""}
              placeholder="0"
            />
          </Field>
          <Field label="Renewal date">
            <Input name="renewal_date" type="date" defaultValue={((deal?.renewal_date as string) || "").slice(0, 10)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Next step">
            <Input name="next_step" defaultValue={(deal?.next_step as string) || ""} placeholder="Send proposal by Friday" />
          </Field>
          <Field label="Proposal status">
            <Select name="proposal_status" defaultValue={(deal?.proposal_status as string) || "none"}>
              {PROPOSAL_STATUSES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {/* Labelled links — Figma, proposal, staging URL, contract, etc. */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-medium text-mute">Links</span>
            <button
              type="button"
              onClick={addLink}
              className="text-xs font-medium text-signal hover:text-signal-strong"
            >
              + Add link
            </button>
          </div>
          {links.length === 0 ? (
            <p className="text-xs text-faint">Attach a Figma file, proposal, staging URL, contract…</p>
          ) : (
            <div className="space-y-2">
              {links.map((l, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    value={l.label}
                    onChange={(e) => updateLink(i, { label: e.target.value })}
                    placeholder="Label (Figma)"
                    className="w-1/3"
                  />
                  <Input
                    value={l.url}
                    onChange={(e) => updateLink(i, { url: e.target.value })}
                    placeholder="paste URL"
                    className="flex-1"
                  />
                  {l.url.trim() ? (
                    <a
                      href={normalizeUrl(l.url)}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="shrink-0 rounded-md px-1.5 text-xs font-medium text-signal hover:text-signal-strong"
                      title="Open in new tab"
                    >
                      Open
                    </a>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => removeLink(i)}
                    className="shrink-0 px-1 text-faint hover:text-red-600"
                    aria-label="Remove link"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <Field label="Notes">
          <Textarea name="notes" defaultValue={(deal?.notes as string) || ""} />
        </Field>
        </fieldset>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving || !canEdit}>
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
