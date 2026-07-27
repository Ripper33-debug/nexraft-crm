import { createFileRoute, useRouter, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  getCompanies,
  getDeals,
  getUsers,
  upsertCompany,
  archiveCompany,
  restoreCompany,
  importCompanies,
  verifyCompanyWebsites,
  claimCompany,
  setCompanyCallOutcome,
  backfillResearchEmails,
  researchCompany,
  runOutscraperEnrich,
  tagFacebookOnlyCompanies,
  archiveGoodSiteCompanies,
  pruneWeakLeads,
  undoLastBulkArchive,
  aiQualifyLeadsBatch,
} from "../../lib/crm/data";
import { Button, Card, Field, Input, Modal, Select, Textarea, EmptyState, PageHeader, OwnerChip, PageSkeleton } from "../../components/crm/ui";
import { NotesThread } from "../../components/crm/notes";
import { CallMode } from "../../components/crm/call-mode";
import { RecordAccessButton } from "../../components/crm/record-access";
import { ArchivedPanel } from "../../components/crm/archived";
import { DuplicatesPanel } from "../../components/crm/duplicates";
import { ImportCsvButton } from "../../components/crm/csv-import";
import { ResearchAllButton } from "../../components/crm/research-all-button";
import { NoReasonModal } from "../../components/crm/no-reason-modal";
import {
  LEAD_SOURCES,
  COMPANY_TAGS,
  tagColor,
  parseTags,
  serializeTags,
  canEditRecord,
  leadNeed,
  NEED_GROUPS,
  type LeadNeed,
  type NeedKey,
} from "../../lib/crm/constants";
import { downloadCsv, stampedName } from "../../lib/crm/csv";
import { toast } from "../../components/crm/toast";

type Row = Record<string, unknown>;

// A company whose researched website came back live with ZERO pitch angles is
// one the audit couldn't fault — modern, working, nothing to sell against.
// These are the hardest calls in the book, so they get flagged and filterable.
// A site that flipped live→dead within the last week — the owner knows
// they're broken RIGHT NOW, which makes this the warmest cold call there is.
function isRecentlyDown(c: Row): boolean {
  const at = c.site_down_at as string | null | undefined;
  if (!at) return false;
  return Date.now() - new Date(at).getTime() < 7 * 24 * 3600_000;
}

// The one reason we'd interrupt this business's day — same function the call
// queue, the score and the call script all read, so a company can never look
// worth calling here and dead in the queue.
export function needOf(c: Row): LeadNeed {
  return leadNeed({
    website: c.website as string | null,
    research: c.research as string | null,
    tags: c.tags as string | null,
    siteDownAt: c.site_down_at as string | null,
    createdAt: c.created_at as string | null,
  });
}

// Chip colours track how hard the opener is, not how pretty the site is:
// red = they're broken right now, brass = a real defect to name, grey = we have
// nothing, emerald = nothing wrong (which is a warning, not a win).
function needChipStyle(need: LeadNeed): string {
  if (!need.worthCalling) {
    return need.key === "good_site"
      ? "bg-emerald-500/15 text-emerald-700"
      : "bg-surface-2 text-faint";
  }
  if (need.rank >= 80) return "bg-red-500/15 text-red-700";
  return "bg-signal-soft text-signal";
}

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

// Owner's ask (2026-07-22): reps work straight down this list and call from the
// row — give them a way to MOVE the company right here once they've called.
// Clicking the outcome badge opens the same Yes / Maybe / No / No answer triage
// as the Calls queue, backed by the same setCompanyCallOutcome server fn, so
// the company's pipeline deal moves with it (Yes/Maybe → Proposal, No → Lost,
// No answer → stays in the call queue).
function RowTriage({ c, canEdit, onDone }: { c: Row; canEdit: boolean; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // A "no" from this row goes through the same one-tap reason picker as the
  // Calls page — otherwise the tally would quietly miss every no filed here.
  const [asking, setAsking] = useState(false);

  const badge =
    c.call_outcome === "signed" ? (
      <span className="ml-2 align-middle rounded-full bg-signal px-1.5 py-0.5 text-[10px] font-semibold text-ink">Signed</span>
    ) : c.call_outcome === "interested" ? (
      <span className="ml-2 align-middle rounded-full bg-signal-soft px-1.5 py-0.5 text-[10px] font-medium text-signal">Yes</span>
    ) : c.call_outcome === "maybe" ? (
      <span className="ml-2 align-middle rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">Maybe</span>
    ) : c.call_outcome === "not_interested" ? (
      <span className="ml-2 align-middle rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-faint">No</span>
    ) : c.call_outcome === "no_answer" ? (
      <span className="ml-2 align-middle rounded-full bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-medium text-sky-700">No answer</span>
    ) : !c.call_outcome ? (
      <span className="ml-2 align-middle rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">Need to call</span>
    ) : null;

  // "Signed" is final (there's a won deal behind it) — leave that badge alone.
  // Records you can't edit stay read-only badges too.
  if (!canEdit || c.call_outcome === "signed") return badge;

  async function decide(outcome: "interested" | "maybe" | "no_answer") {
    if (busy) return;
    setBusy(true);
    try {
      await setCompanyCallOutcome({ data: { id: c.id as string, outcome } });
      toast(
        outcome === "interested"
          ? "Marked Yes — deal moved to Proposal"
          : outcome === "maybe"
            ? "Marked Maybe"
            : "Marked No answer — we'll put them back in the queue for a callback",
      );
      setOpen(false);
      onDone();
    } catch {
      toast("Couldn't save — you may not own this one", "error");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="cursor-pointer transition-opacity hover:opacity-75"
        title="How did the call go? Click to move them — Yes, Maybe, No, or No answer"
      >
        {badge}
      </button>
    );
  }
  return (
    <span className="ml-2 inline-flex items-center gap-1 align-middle">
      <button
        type="button"
        disabled={busy}
        onClick={() => decide("interested")}
        className="rounded-full bg-signal-soft px-2 py-0.5 text-[10px] font-medium text-signal transition-colors hover:bg-signal hover:text-ink disabled:opacity-50"
        title="They're interested — moves their deal to Proposal"
      >
        Yes
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => decide("maybe")}
        className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-700 transition-colors hover:bg-amber-500/30 disabled:opacity-50"
        title="Warm but not sold yet — moves their deal to Proposal"
      >
        Maybe
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => setAsking(true)}
        className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-faint transition-colors hover:text-red-700 disabled:opacity-50"
        title="Not interested — drops their deal to Lost"
      >
        No
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => decide("no_answer")}
        className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-medium text-sky-700 transition-colors hover:bg-sky-500/30 disabled:opacity-50"
        title="Didn't pick up — keeps them in the call queue"
      >
        No answer
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => setOpen(false)}
        className="px-1 text-[10px] text-faint transition-colors hover:text-bone"
        title="Never mind"
      >
        ✕
      </button>
      {asking ? (
        <NoReasonModal
          company={c}
          onClose={() => setAsking(false)}
          onDone={() => {
            setAsking(false);
            setOpen(false);
            onDone();
          }}
        />
      ) : null}
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
  pendingComponent: () => <PageSkeleton cards={0} rows={8} />,
});

function CompaniesPage() {
  const { companies, users, deals } = Route.useLoaderData();
  const { user: me } = Route.useRouteContext();
  const isAdmin = me?.role === "admin";
  const { focus, new: newParam } = Route.useSearch();
  const router = useRouter();
  const navigate = Route.useNavigate();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [ownerFilter, setOwnerFilter] = useState<string>("");
  const [callFilter, setCallFilter] = useState<string>("");
  const [needFilter, setNeedFilter] = useState<NeedKey | "">("");
  const [calling, setCalling] = useState<Row | null>(null);
  const [checkingSites, setCheckingSites] = useState(false);
  const [pullingEmails, setPullingEmails] = useState(false);
  const [outscraping, setOutscraping] = useState(false);
  const [taggingFb, setTaggingFb] = useState(false);
  const [clearingGoodSites, setClearingGoodSites] = useState(false);
  const [pruning, setPruning] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [aiRating, setAiRating] = useState(false);

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

  // One pass over the book: what is the reason to call each of these, and how
  // many of each do we actually have?
  const needs = useMemo(() => {
    const byId = new Map<string, LeadNeed>();
    const counts = new Map<NeedKey, number>();
    for (const c of companies as Row[]) {
      const n = needOf(c);
      byId.set(c.id as string, n);
      counts.set(n.key, (counts.get(n.key) ?? 0) + 1);
    }
    let withReason = 0;
    for (const n of byId.values()) if (n.worthCalling) withReason += 1;
    return { byId, counts, withReason };
  }, [companies]);

  const rows = useMemo(() => {
    let all = companies as Row[];
    if (tagFilter) all = all.filter((c) => parseTags(c.tags as string).includes(tagFilter));
    if (needFilter) all = all.filter((c) => needs.byId.get(c.id as string)?.key === needFilter);
    if (ownerFilter) {
      all = ownerFilter === "__none__"
        ? all.filter((c) => !c.owner_id)
        : all.filter((c) => c.owner_id === ownerFilter);
    }
    if (callFilter === "need") all = all.filter((c) => !c.call_outcome);
    else if (callFilter === "interested") all = all.filter((c) => c.call_outcome === "interested");
    else if (callFilter === "maybe") all = all.filter((c) => c.call_outcome === "maybe");
    else if (callFilter === "not_interested") all = all.filter((c) => c.call_outcome === "not_interested");
    else if (callFilter === "signed") all = all.filter((c) => c.call_outcome === "signed");
    // Worst website first, so whatever slice is on screen is worked top-down.
    return [...all].sort((a, b) => {
      const ra = needs.byId.get(a.id as string)?.rank ?? 0;
      const rb = needs.byId.get(b.id as string)?.rank ?? 0;
      return rb - ra;
    });
  }, [companies, tagFilter, ownerFilter, callFilter, needFilter, needs]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <PageHeader
        title="Companies"
        subtitle={`${(companies as Row[]).length} accounts · ${needs.withReason} with a real reason to call · ${(companies as Row[]).filter((c) => Number(c.email_contacts ?? 0) > 0).length} with an email on file`}
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
            {isAdmin ? (
              <Button variant="outline" onClick={() => exportCompanies(companies as Row[])}>
                Export CSV
              </Button>
            ) : null}
            {isAdmin ? (
              <Button
                variant="outline"
                disabled={pullingEmails}
                onClick={async () => {
                  setPullingEmails(true);
                  try {
                    const res = await backfillResearchEmails();
                    toast(
                      res.created > 0
                        ? `Found ${res.created} email${res.created === 1 ? "" : "s"} in research notes and saved them as contacts — they're usable in Outreach now.`
                        : `Checked ${res.scanned} researched companies — no new emails to pull.`,
                      res.created > 0 ? "success" : "info",
                    );
                    void router.invalidate();
                  } catch {
                    toast("Couldn't pull emails from research — try again.", "error");
                  } finally {
                    setPullingEmails(false);
                  }
                }}
              >
                {pullingEmails ? "Pulling emails…" : "Pull emails from research"}
              </Button>
            ) : null}
            {isAdmin ? (
              <Button
                variant="outline"
                disabled={outscraping}
                onClick={async () => {
                  setOutscraping(true);
                  try {
                    const res = await runOutscraperEnrich();
                    if (!res.configured) {
                      toast(
                        "Outscraper isn't connected yet — add OUTSCRAPER_API_KEY in Vercel (outscraper.com → account → API) and this button goes live.",
                        "info",
                      );
                    } else {
                      toast(
                        res.contacts > 0
                          ? `Outscraper found emails for ${res.contacts} compan${res.contacts === 1 ? "y" : "ies"} — they're emailable in Outreach now.`
                          : `Asked Outscraper about ${res.scanned} compan${res.scanned === 1 ? "y" : "ies"} — no new emails this batch.`,
                        res.contacts > 0 ? "success" : "info",
                      );
                    }
                    void router.invalidate();
                  } catch {
                    toast("Couldn't run the Outscraper enrichment — try again.", "error");
                  } finally {
                    setOutscraping(false);
                  }
                }}
              >
                {outscraping ? "Finding emails…" : "🔎 Find emails (Outscraper)"}
              </Button>
            ) : null}
            {isAdmin ? (
              <Button
                variant="outline"
                disabled={taggingFb}
                onClick={async () => {
                  setTaggingFb(true);
                  try {
                    const res = await tagFacebookOnlyCompanies();
                    toast(
                      res.tagged > 0
                        ? `Tagged ${res.tagged} compan${res.tagged === 1 ? "y" : "ies"} that market on socials but have no website — filter by "facebook-only" to work them.`
                        : `Checked ${res.scanned} siteless researched companies — no new social-only businesses found.`,
                      res.tagged > 0 ? "success" : "info",
                    );
                    void router.invalidate();
                  } catch {
                    toast("Couldn't run the Facebook-only tagging — try again.", "error");
                  } finally {
                    setTaggingFb(false);
                  }
                }}
              >
                {taggingFb ? "Tagging…" : "📘 Tag Facebook-only"}
              </Button>
            ) : null}
            {isAdmin ? (
              <Button
                variant="outline"
                disabled={pruning}
                onClick={async () => {
                  setPruning(true);
                  try {
                    // Two-step on purpose: preview the damage, then confirm.
                    // Everything archived here is restorable from Archived.
                    const preview = await pruneWeakLeads({ data: { threshold: 70, dryRun: true } });
                    if (preview.matched === 0) {
                      toast(
                        `Scanned ${preview.scanned} prunable compan${preview.scanned === 1 ? "y" : "ies"} — none scored under 70. Nothing to clean up.`,
                        "info",
                      );
                      return;
                    }
                    const go = window.confirm(
                      `${preview.matched} compan${preview.matched === 1 ? "y" : "ies"} score under 70 and look like dead weight (old leads never reached, or "not interested").\n\nSigned clients, interested/maybe, referrals, active deals, and fresh leads are protected and NOT included.\n\nArchive ${preview.matched === 1 ? "it" : "them"}? (Restorable any time from the Archived drawer.)`,
                    );
                    if (!go) return;
                    const res = await pruneWeakLeads({ data: { threshold: 70, dryRun: false } });
                    toast(
                      `Archived ${res.archived} weak lead${res.archived === 1 ? "" : "s"} — the book is cleaner. Restore any of them from the Archived drawer below.`,
                      "success",
                    );
                    void router.invalidate();
                  } catch {
                    toast("Couldn't prune weak leads — try again.", "error");
                  } finally {
                    setPruning(false);
                  }
                }}
              >
                {pruning ? "Scoring the book…" : "🧹 Prune weak leads"}
              </Button>
            ) : null}
            {isAdmin ? (
              <Button
                variant="outline"
                disabled={undoing}
                onClick={async () => {
                  setUndoing(true);
                  try {
                    // Preview first: finds the most recent bulk pass (prune or
                    // good-site sweep) by its shared archive timestamp.
                    const preview = await undoLastBulkArchive({ data: { dryRun: true } });
                    if (!preview.found) {
                      toast("No bulk archive to undo — single archived companies are restorable from the Archived drawer.", "info");
                      return;
                    }
                    const go = window.confirm(
                      `This will restore the last bulk archive: ${preview.count} compan${preview.count === 1 ? "y" : "ies"} (plus their deals) archived in one pass.\n\nBring ${preview.count === 1 ? "it" : "them"} back?`,
                    );
                    if (!go) return;
                    const res = await undoLastBulkArchive({ data: { dryRun: false } });
                    toast(
                      `Restored ${res.restored} compan${res.restored === 1 ? "y" : "ies"} — they're back in the book.`,
                      "success",
                    );
                    void router.invalidate();
                  } catch {
                    toast("Couldn't undo the bulk archive — try again.", "error");
                  } finally {
                    setUndoing(false);
                  }
                }}
              >
                {undoing ? "Restoring…" : "↩️ Undo last bulk archive"}
              </Button>
            ) : null}
            {isAdmin ? (
              <Button
                variant="outline"
                disabled={aiRating}
                onClick={async () => {
                  setAiRating(true);
                  let total = 0;
                  try {
                    // Small batches in a loop so each call stays well inside
                    // the serverless window; stops when the pool is empty.
                    for (let i = 0; i < 100; i++) {
                      const res = await aiQualifyLeadsBatch({ data: { limit: 6 } });
                      if (!res.configured) {
                        toast("AI isn't set up yet — add OPENROUTER_API_KEY (or ANTHROPIC_API_KEY) in Vercel first, then run this.", "error");
                        return;
                      }
                      total += res.rated;
                      if (res.remaining === 0 || res.rated === 0) break;
                    }
                    toast(
                      total > 0
                        ? `AI rated ${total} lead${total === 1 ? "" : "s"} — the 🎯 badge shows how likely each is to buy. Green ones first.`
                        : "Every researched company is already rated — research new leads to grow the pool.",
                      total > 0 ? "success" : "info",
                    );
                    void router.invalidate();
                  } catch {
                    toast(total > 0 ? `Rated ${total} before hitting an error — click again to continue.` : "Couldn't run AI ratings — try again.", "error");
                  } finally {
                    setAiRating(false);
                  }
                }}
              >
                {aiRating ? "AI is rating leads…" : "🎯 AI-rate leads"}
              </Button>
            ) : null}
            <Button
              variant="outline"
              disabled={checkingSites}
              onClick={async () => {
                setCheckingSites(true);
                try {
                  const res = await verifyCompanyWebsites();
                  if (res.checked === 0) {
                    toast("All websites are freshly checked — nothing to do.", "info");
                  } else {
                    toast(
                      `Checked ${res.checked} site${res.checked === 1 ? "" : "s"} — ${
                        res.down === 0 ? "all responding" : `${res.down} down (redesign openings!)`
                      }${res.remaining > 0 ? ` · ${res.remaining} left, click again` : ""}`,
                      res.down > 0 ? "success" : "info",
                    );
                    router.invalidate();
                  }
                } catch {
                  toast("Couldn't run the website check — try again.", "error");
                } finally {
                  setCheckingSites(false);
                }
              }}
            >
              {checkingSites ? "Checking sites…" : "Check websites"}
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

      {/* What the book is actually made of. Every pill is one reason to call,
          counted, strongest first — so the day's work is "clear the No website
          pile", not "start at the top of 900 rows and hope". */}
      <Card className="mt-4 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-faint">Why we'd call them</span>
          <span className="text-xs text-mute">
            {needs.withReason > 0
              ? `${needs.withReason} of ${(companies as Row[]).length} have something true to open with.`
              : "Nothing in the book has a reason to call yet — research these before anyone dials."}
          </span>
        </div>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          <button
            onClick={() => setNeedFilter("")}
            className={
              "rounded-full px-2.5 py-1 text-xs font-medium transition-colors " +
              (needFilter === "" ? "bg-signal-soft text-signal" : "text-mute hover:bg-surface-2 hover:text-bone")
            }
          >
            All {(companies as Row[]).length}
          </button>
          {NEED_GROUPS.map((g) => {
            const n = needs.counts.get(g.key) ?? 0;
            if (n === 0) return null;
            const active = needFilter === g.key;
            const cold = g.key === "good_site" || g.key === "unknown";
            return (
              <button
                key={g.key}
                title={g.blurb}
                onClick={() => setNeedFilter(active ? "" : g.key)}
                className={
                  "rounded-full px-2.5 py-1 text-xs font-medium transition-colors " +
                  (active
                    ? "bg-signal text-ink"
                    : cold
                      ? "text-faint hover:bg-surface-2 hover:text-mute"
                      : "text-mute hover:bg-surface-2 hover:text-bone")
                }
              >
                {g.label} <span className="font-mono tabular-nums opacity-70">{n}</span>
              </button>
            );
          })}
        </div>
        {needFilter ? (
          <p className="mt-2.5 text-xs text-mute">
            {NEED_GROUPS.find((g) => g.key === needFilter)?.blurb}
          </p>
        ) : null}
        {/* The un-researched pile is the one bucket with a one-click fix, so the
            fix sits right next to the count instead of on another page. */}
        {(needs.counts.get("unknown") ?? 0) > 0 ? (
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <p className="text-xs text-faint">
              {needs.counts.get("unknown")} have never been researched — nobody can open a call on them yet. Research
              them and most will sort themselves into the piles above.
            </p>
            {isAdmin ? <ResearchAllButton size="sm" onDone={() => router.invalidate()} /> : null}
          </div>
        ) : null}
      </Card>

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
            <option value="interested">Yes</option>
            <option value="maybe">Maybe</option>
            <option value="not_interested">No</option>
            <option value="signed">Signed</option>
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

      {isAdmin && needFilter === "good_site" && rows.length > 0 ? (
        <div className="mt-3 flex items-center justify-between rounded-xl border border-signal/25 bg-signal-soft px-4 py-3">
          <span className="text-sm text-bone">
            These {rows.length} companies already have a good website — the hardest pitch in the book.
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={clearingGoodSites}
            onClick={async () => {
              if (!window.confirm(`Archive all good-site companies? Signed clients and interested leads are never touched, and everything is restorable from the Archived panel below.`)) return;
              setClearingGoodSites(true);
              try {
                const res = await archiveGoodSiteCompanies();
                toast(
                  res.archived > 0
                    ? `Archived ${res.archived} good-site compan${res.archived === 1 ? "y" : "ies"} — the pool is all weak-site leads now.`
                    : "Nothing to archive — no eligible good-site companies.",
                  res.archived > 0 ? "success" : "info",
                );
                void router.invalidate();
              } catch {
                toast("Couldn't archive them — try again.", "error");
              } finally {
                setClearingGoodSites(false);
              }
            }}
          >
            {clearingGoodSites ? "Archiving…" : "Archive all of these"}
          </Button>
        </div>
      ) : null}

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
                      <Link
                        to="/companies/$companyId"
                        params={{ companyId: c.id as string }}
                        search={{ focus: undefined, new: undefined }}
                        className="font-medium text-bone hover:text-signal"
                      >
                        {c.name as string}
                      </Link>
                      {Number(c.email_contacts ?? 0) > 0 ? (
                        <span className="ml-1.5 align-middle text-[11px] text-faint" title="Has an email on file — reachable from Outreach">
                          ✉
                        </span>
                      ) : null}
                      {(() => {
                        const need = needs.byId.get(c.id as string);
                        if (!need) return null;
                        return (
                          <span
                            className={`ml-2 align-middle rounded-full px-1.5 py-0.5 text-[10px] font-medium ${needChipStyle(need)}`}
                            title={
                              need.worthCalling
                                ? `Open the call with: “${need.line}”`
                                : need.key === "good_site"
                                  ? "Research found a live, modern site with nothing to pitch against — hardest sell in the book"
                                  : "Nobody has researched this one, so there's no honest reason to interrupt them yet"
                            }
                          >
                            {need.label}
                          </span>
                        );
                      })()}
                      <RowTriage
                        c={c}
                        canEdit={canEditRecord(me, (c.owner_id as string) ?? null, (c.shared_with as string) ?? null)}
                        onDone={() => router.invalidate()}
                      />
                      {typeof c.ai_fit === "number" ? (
                        <span
                          className={`ml-2 align-middle rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                            (c.ai_fit as number) >= 70
                              ? "bg-emerald-500/15 text-emerald-700"
                              : (c.ai_fit as number) >= 40
                                ? "bg-amber-500/15 text-amber-700"
                                : "bg-surface-2 text-faint"
                          }`}
                          title={`AI read their research and rated how likely they are to buy: ${c.ai_fit}/100. ${(c.ai_fit_reason as string) ?? ""}`}
                        >
                          🎯 {c.ai_fit as number}
                        </span>
                      ) : null}
                      {c.website ? (
                        <div className="flex items-center gap-1.5 text-xs text-faint">
                          {c.website_status === "dead" ? (
                            <span
                              className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500"
                              title="Website is down — redesign opening"
                            />
                          ) : c.website_status === "live" ? (
                            <span
                              className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500"
                              title="Website is live"
                            />
                          ) : null}
                          <span className="truncate">{c.website as string}</span>
                          {c.website_status === "dead" ? (
                            isRecentlyDown(c) ? (
                              <span
                                className="animate-pulse rounded-full bg-red-500/25 px-1.5 py-0.5 text-[10px] font-semibold text-red-700"
                                title="Their site was LIVE last week and is down NOW — they know it's broken. Hottest call on the board."
                              >
                                🚨 Just went down
                              </span>
                            ) : (
                              <span className="rounded-full bg-red-500/15 px-1.5 py-0.5 text-[10px] font-medium text-red-700">
                                Site down
                              </span>
                            )
                          ) : null}
                        </div>
                      ) : tags.includes("facebook-only") ? (
                        <span
                          className="rounded-full bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-medium text-sky-700"
                          title="Marketing on Facebook/Instagram but has NO website — already sold on being online, easiest pitch on the board. Profile link is in their notes."
                        >
                          📘 On socials, no site
                        </span>
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
                    <td className="px-4 py-2.5">
                      {!c.owner_id ? (
                        <button
                          onClick={async () => {
                            try {
                              const res = await claimCompany({ data: { company_id: c.id as string } });
                              if (res.ok) {
                                toast(`${(c.name as string) || "Company"} is yours — it's in your book now.`, "success");
                                void router.invalidate();
                              } else {
                                toast(res.error || "Couldn't claim it.", "error");
                              }
                            } catch {
                              toast("Couldn't claim it — try again.", "error");
                            }
                          }}
                          className="rounded-full border border-signal/40 bg-signal-soft px-2.5 py-1 text-[11px] font-medium text-signal transition-colors hover:border-signal"
                          title="Unowned — claim it and it goes straight into your book"
                        >
                          Claim
                        </button>
                      ) : (
                        <OwnerChip name={c.owner_name as string} />
                      )}
                    </td>
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
                          <button onClick={() => onArchive(c.id as string)} className="text-xs text-faint hover:text-red-600">
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
              hint={tagFilter || ownerFilter ? "Try a different owner or tag, or clear the filters." : "Add the businesses you're selling to, or import a list from a spreadsheet."}
              action={
                tagFilter || ownerFilter ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setTagFilter(null);
                      setOwnerFilter("");
                    }}
                  >
                    Clear filters
                  </Button>
                ) : (
                  <Button
                    onClick={() => {
                      setEditing(null);
                      setOpen(true);
                    }}
                  >
                    + New company
                  </Button>
                )
              }
            />
          </div>
        ) : null}
      </Card>

      <DuplicatesPanel entity="company" onMerged={() => router.invalidate()} />
      <ArchivedPanel entity="company" onRestored={() => router.invalidate()} />

      <CompanyModal
        open={open}
        onClose={() => setOpen(false)}
        company={editing}
        existing={companies as Row[]}
        users={users as Row[]}
        canEdit={!editing || canEditRecord(me, (editing.owner_id as string) ?? null, (editing.shared_with as string) ?? null)}
        onSaved={(saved, thenCall) => {
          setOpen(false);
          router.invalidate();
          // "Save & call now": the add→call flow stays on one screen — the
          // fresh company goes straight into Call Mode.
          if (thenCall && saved?.id) setCalling(saved);
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
  onSaved: (saved?: Row, thenCall?: boolean) => void;
  canEdit?: boolean;
}) {
  const [saving, setSaving] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [nameVal, setNameVal] = useState("");
  // "Save & call" support: the second submit button flips this ref so the ONE
  // submit handler knows to hand the fresh company straight to Call Mode.
  // (A ref, not state — state wouldn't be committed yet when submit fires.)
  const thenCallRef = useRef(false);

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

    const thenCall = thenCallRef.current && !company?.id;
    thenCallRef.current = false;

    setSaving(true);
    try {
      const fields = {
        name,
        industry: (fd.get("industry") as string) || null,
        website: (fd.get("website") as string) || null,
        phone: (fd.get("phone") as string) || null,
        email: (fd.get("email") as string) ?? null,
        city: (fd.get("city") as string) || null,
        source: (fd.get("source") as string) || null,
        owner_id: (fd.get("owner_id") as string) || null,
        notes: (fd.get("notes") as string) || null,
        tags: serializeTags(tags) || null,
      };
      const saved = await upsertCompany({
        data: { id: (company?.id as string) || undefined, ...fields },
      });
      // upsertCompany returns just { id } — rebuild the row from the form so
      // "Save & call" can open Call Mode without waiting for a reload.
      const savedRow: Row = { ...fields, id: saved?.id };
      if (company?.id) {
        toast("Company updated");
      } else {
        // Brand-new company: kick off the website/AI research right away in the
        // background so the dossier + tailored email are ready by the time a rep
        // opens it — no waiting for the nightly sweep. Fire-and-forget: research
        // is a bonus, never a blocker, so failures are swallowed silently.
        toast("Company added — researching it in the background");
        if (saved?.id) {
          void researchCompany({ data: { id: saved.id as string } }).catch(() => {});
        }
      }
      onSaved(savedRow, thenCall);
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
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800">
            <span className="mt-0.5 font-semibold">Possible duplicate</span>
            <span className="text-amber-100/90">
              “{dupMatch.name as string}” is already in the CRM
              {dupMatch.owner_name ? `, owned by ${dupMatch.owner_name as string}` : ""}. Check before adding it again.
            </span>
          </div>
        ) : null}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Phone">
            <Input name="phone" defaultValue={(company?.phone as string) || ""} />
          </Field>
          <Field label="Email">
            <Input
              name="email"
              type="email"
              defaultValue={(company?.contact_email as string) || ""}
              placeholder="owner@theirbusiness.com"
            />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="City / Region">
            <Input name="city" defaultValue={(company?.city as string) || ""} />
          </Field>
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
        </div>
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
          {!company?.id ? (
            <Button
              type="submit"
              disabled={saving || !canEdit}
              onClick={() => {
                thenCallRef.current = true;
              }}
              title="Save the company and open Call Mode on it right away — no hunting for it in the list"
            >
              {saving ? "Saving…" : "Save & call now"}
            </Button>
          ) : null}
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
