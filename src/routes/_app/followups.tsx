import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import {
  getCompanies,
  getContacts,
  setCompanyCallOutcome,
  recordEmailTouch,
  sendCrmEmail,
  getGmailStatus,
  getEmailWorkspace,
  type EmailTargetRow,
  type SentEmailRow,
} from "../../lib/crm/data";
import {
  Button,
  Card,
  EmptyState,
  Eyebrow,
  Input,
  PageHeader,
  Pill,
  SummaryCard,
  Textarea,
  cx,
  EmailedBadge,
} from "../../components/crm/ui";
import { toast } from "../../components/crm/toast";
import { NoReasonModal } from "../../components/crm/no-reason-modal";
import { aiDraftFromResearch, EMAIL_TEMPLATES, followUpEmail, mailtoLink, NUDGE_LABELS } from "../../lib/crm/emails";
import { relativeTime, emailHistory } from "../../lib/crm/constants";

type Row = Record<string, unknown>;

// Where a company sits in the nudge cadence, from its next_followup_at stamp.
//  - "due"       — never scheduled (legacy / not yet emailed): nudge now
//  - "overdue"   — the scheduled date has passed: top of the list, red chip
//  - "scheduled" — a nudge is booked for the future: parked below
function dueInfo(company: Row): { state: "due" | "overdue" | "scheduled"; label: string; at: number } {
  const raw = company.next_followup_at as string | null;
  if (!raw) return { state: "due", label: "Due now", at: 0 };
  const at = Date.parse(raw);
  if (Number.isNaN(at)) return { state: "due", label: "Due now", at: 0 };
  const diffDays = Math.round((at - Date.now()) / 86400000);
  if (at <= Date.now()) {
    const late = Math.max(0, -diffDays);
    return {
      state: "overdue",
      label: late <= 0 ? "Due today" : `Overdue by ${late} day${late === 1 ? "" : "s"}`,
      at,
    };
  }
  return {
    state: "scheduled",
    label: diffDays <= 0 ? "Due today" : `Due in ${diffDays} day${diffDays === 1 ? "" : "s"}`,
    at,
  };
}

export const Route = createFileRoute("/_app/followups")({
  loader: async ({ context }) => {
    const [companies, contacts, gmail, workspace] = await Promise.all([
      getCompanies(),
      getContacts(),
      getGmailStatus().catch(() => ({ configured: false, connected: false, email: null })),
      getEmailWorkspace(),
    ]);
    const me = (context as { user?: { id: string; role: string; name: string; email: string } }).user ?? null;
    return { companies, contacts, me, gmail, workspace };
  },
  component: FollowUpsPage,
});

function FollowUpCard({
  company,
  emailOnFile,
  repName,
  gmailConnected,
  onChanged,
}: {
  company: Row;
  emailOnFile: string;
  repName: string;
  gmailConnected: boolean;
  onChanged: () => void;
}) {
  const id = company.id as string;
  const name = (company.name as string) || "This company";
  const touches = Number(company.email_touches) || 0;
  const nextTouch = Math.min(3, touches + 1);
  const allSent = touches >= 3;
  const due = dueInfo(company);
  const [to, setTo] = useState(emailOnFile);
  const [busy, setBusy] = useState(false);
  // The draft is pre-written and waiting for approval. Opening the preview lets
  // the rep read and tweak it; approving sends exactly what's shown. For the
  // FIRST touch we prefer the AI-written email from the company's research —
  // it talks about this specific business, not a template. Later nudges keep
  // the escalating cadence templates so touch 2/3 don't repeat the pitch.
  const aiDraft = nextTouch === 1 ? aiDraftFromResearch(company.research, repName, company) : null;
  const initialDraft = aiDraft ?? followUpEmail(company, repName, nextTouch);
  const [subject, setSubject] = useState(initialDraft.subject);
  const [body, setBody] = useState(initialDraft.body);
  const [showDraft, setShowDraft] = useState(false);

  // When Gmail is connected we send the nudge for real, from the rep's own
  // address, and let the server record the touch. Otherwise we fall back to
  // opening a pre-filled draft in their mail app (and record the touch here).
  async function send() {
    if (!to.trim()) {
      toast("Add an email address to send to first.", "info");
      return;
    }
    setBusy(true);
    try {
      const draft = { subject, body };
      if (gmailConnected) {
        const res = await sendCrmEmail({
          data: { to: to.trim(), subject: draft.subject, body: draft.body, company_id: id },
        });
        if (res.ok) {
          toast(`Sent ${NUDGE_LABELS[nextTouch - 1]} to ${to.trim()}.`, "success");
          onChanged();
        } else {
          toast(res.error || "Couldn't send — try again.", "error");
        }
      } else {
        await recordEmailTouch({ data: { company_id: id } });
        window.location.href = mailtoLink(to.trim(), draft.subject, draft.body);
        onChanged();
      }
    } catch {
      toast(gmailConnected ? "Couldn't send the email." : "Couldn't open the draft.", "error");
    } finally {
      setBusy(false);
    }
  }

  // Giving up on a chase is still a no, so it goes through the same one-tap
  // reason picker (see NoReasonModal) rather than closing the company out
  // silently — those nos count too.
  const [givingUp, setGivingUp] = useState(false);

  async function resolve(outcome: "interested") {
    setBusy(true);
    try {
      await setCompanyCallOutcome({ data: { id, outcome } });
      toast("Marked interested — moved to your pipeline.", "success");
      onChanged();
    } catch {
      toast("Something went wrong.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-bone">{name}</span>
            {allSent ? (
              <Pill tone="warn">All nudges sent</Pill>
            ) : (
              <Pill tone="signal">{NUDGE_LABELS[nextTouch - 1]} next</Pill>
            )}
            {aiDraft ? <Pill tone="signal">✨ Tailored</Pill> : null}
            {!allSent && due.state === "overdue" ? (
              <Pill tone="warn">{due.label}</Pill>
            ) : !allSent && due.state === "scheduled" ? (
              <Pill tone="neutral">{due.label}</Pill>
            ) : null}
          </div>
          <div className="mt-0.5 text-xs text-faint">
            {touches === 0
              ? "Not emailed yet"
              : `${touches} follow-up${touches > 1 ? "s" : ""} sent`}
            {(company.last_emailed_at as string)
              ? ` · last ${relativeTime(company.last_emailed_at as string)}`
              : ""}
            {(company.industry as string) ? ` · ${company.industry as string}` : ""}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          value={to}
          placeholder="their@email.com"
          onChange={(e) => setTo(e.target.value)}
          className="sm:max-w-xs"
        />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={busy} onClick={send}>
            {gmailConnected
              ? allSent
                ? "Approve & send another"
                : `✉ Approve & send ${NUDGE_LABELS[nextTouch - 1]}`
              : allSent
                ? "Send another draft"
                : `✉ Open ${NUDGE_LABELS[nextTouch - 1]}`}
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setShowDraft((v) => !v)}>
            {showDraft ? "Hide draft" : "Read draft"}
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => resolve("interested")}>
            They replied
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setGivingUp(true)}>
            Give up
          </Button>
        </div>
      </div>
      {givingUp ? (
        <NoReasonModal
          company={company}
          onClose={() => setGivingUp(false)}
          onDone={() => {
            setGivingUp(false);
            onChanged();
          }}
        />
      ) : null}
      {showDraft ? (
        <div className="mt-3 space-y-2 rounded-lg border border-line bg-surface-2/60 p-3">
          <Input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={8}
            className="w-full resize-y rounded-lg border border-line bg-surface px-3 py-2 text-sm text-bone outline-none transition-colors focus:border-signal/50"
          />
          <p className="text-[11px] text-faint">
            Edit anything you like — approving sends exactly what's shown here.
          </p>
        </div>
      ) : null}
      {!emailOnFile ? (
        <p className="mt-2 text-[11px] text-faint">
          No email on file — type one above to send. (Add a contact with an email to save it.)
        </p>
      ) : null}
      {!gmailConnected ? (
        <p className="mt-2 text-[11px] text-faint">
          Drafts open in your mail app.{" "}
          <a href="/settings" className="text-signal hover:underline">
            Connect your Gmail
          </a>{" "}
          to send these straight from here.
        </p>
      ) : null}
    </Card>
  );
}

function FollowUpsPage() {
  const { companies, contacts, me, gmail, workspace } = Route.useLoaderData();
  const gmailConnected = !!(gmail as { connected?: boolean }).connected;
  const router = useRouter();

  // First contact email per company, for pre-filling the recipient.
  const emailByCompany = useMemo(() => {
    const m = new Map<string, string>();
    for (const ct of contacts as Row[]) {
      const cid = ct.company_id as string;
      const email = ct.email as string;
      if (cid && email && !m.has(cid)) m.set(cid, email);
    }
    return m;
  }, [contacts]);

  // Everyone who didn't pick up — the follow-up worklist, split by urgency:
  // overdue first (scheduled nudge date has passed), then never-scheduled,
  // then future-scheduled parked at the bottom. Fully-nudged stay visible but last.
  // Only companies we can actually email belong in an email outbox — the
  // no-email ones still live on the Calls board, and we say how many were
  // hidden so nobody thinks leads vanished.
  const { queue, noEmail } = useMemo(() => {
    const all = (companies as Row[]).filter((c) => c.call_outcome === "no_answer");
    const queue = all
      .filter((c) => (Number(c.email_contacts) || 0) > 0 || emailByCompany.has(c.id as string))
      .sort((a, b) => (Number(a.email_touches) || 0) - (Number(b.email_touches) || 0));
    return { queue, noEmail: all.length - queue.length };
  }, [companies, emailByCompany]);

  const { dueNow, scheduled } = useMemo(() => {
    const dueNow: Row[] = [];
    const scheduled: Row[] = [];
    for (const c of queue) {
      const finished = (Number(c.email_touches) || 0) >= 3;
      const d = dueInfo(c);
      if (!finished && (d.state === "due" || d.state === "overdue")) dueNow.push(c);
      else scheduled.push(c);
    }
    // Most-overdue first, then least-nudged.
    dueNow.sort((a, b) => {
      const da = dueInfo(a);
      const db = dueInfo(b);
      if (da.at !== db.at) return da.at - db.at;
      return (Number(a.email_touches) || 0) - (Number(b.email_touches) || 0);
    });
    scheduled.sort((a, b) => dueInfo(a).at - dueInfo(b).at);
    return { dueNow, scheduled };
  }, [queue]);

  const stats = useMemo(() => {
    let overdue = 0;
    let done = 0;
    for (const c of queue) {
      const t = Number(c.email_touches) || 0;
      if (t >= 3) done++;
      else if (dueInfo(c).state === "overdue") overdue++;
    }
    return { total: queue.length, dueNow: dueNow.length, overdue, done };
  }, [queue, dueNow]);

  const refresh = () => router.invalidate();
  const [bulkBusy, setBulkBusy] = useState(false);

  // One-click approval for the whole due list: sends every due nudge that has
  // an email on file, one after another, from the rep's connected Gmail. Each
  // send uses the same escalating template the card previews show.
  const bulkTargets = useMemo(
    () =>
      dueNow
        .map((c) => ({ c, to: emailByCompany.get(c.id as string) ?? "" }))
        .filter((t) => t.to),
    [dueNow, emailByCompany],
  );

  async function approveAll() {
    if (bulkTargets.length === 0) {
      toast("None of the due follow-ups have an email on file.", "info");
      return;
    }
    setBulkBusy(true);
    let sent = 0;
    let failed = 0;
    for (const t of bulkTargets) {
      const touches = Number(t.c.email_touches) || 0;
      const nextTouch = Math.min(3, touches + 1);
      // First touches use the AI-written email about THIS business when the
      // research has one; later touches stay on the escalating templates.
      const draft =
        (nextTouch === 1 ? aiDraftFromResearch(t.c.research, me?.name ?? "", t.c) : null) ??
        followUpEmail(t.c, me?.name ?? "", nextTouch);
      try {
        const res = await sendCrmEmail({
          data: { to: t.to, subject: draft.subject, body: draft.body, company_id: t.c.id as string },
        });
        if (res.ok) sent++;
        else failed++;
      } catch {
        failed++;
      }
    }
    setBulkBusy(false);
    toast(
      failed > 0 ? `Sent ${sent}, ${failed} failed.` : `Approved and sent all ${sent} follow-ups.`,
      failed > 0 ? "error" : "success",
    );
    refresh();
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Outreach"
        subtitle="Your outbox: every nudge is pre-written and lined up — read it, tweak it, approve it. Need a one-off email instead? The composer is at the bottom."
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryCard label="Due now" value={String(stats.dueNow)} accent sub={stats.overdue > 0 ? `${stats.overdue} overdue` : "nudge these today"} />
        <SummaryCard
          label="In the queue"
          value={String(stats.total)}
          hint={noEmail > 0 ? `${noEmail} more have no email — they stay on Calls` : "Everyone who didn't answer"}
        />
        <SummaryCard label="Fully nudged" value={String(stats.done)} hint="All 3 sent" />
      </div>

      {queue.length === 0 ? (
        <EmptyState
          title="Nobody's waiting on a follow-up"
          hint="When a call goes unanswered, mark it “No answer” on the Calls board and it'll show up here to email."
        />
      ) : (
        <>
          {dueNow.length > 0 ? (
            <div className="grid grid-cols-1 gap-3">
              {gmailConnected && bulkTargets.length > 1 ? (
                <div className="flex items-center justify-between rounded-md border border-signal/25 bg-signal-soft px-4 py-3">
                  <span className="text-sm text-bone">
                    {bulkTargets.length} drafts written and waiting for approval.
                  </span>
                  <Button size="sm" disabled={bulkBusy} onClick={approveAll}>
                    {bulkBusy ? "Sending…" : `✉ Approve & send all (${bulkTargets.length})`}
                  </Button>
                </div>
              ) : null}
              {dueNow.map((c) => (
                <FollowUpCard
                  key={`${c.id as string}-${Number(c.email_touches) || 0}`}
                  company={c}
                  emailOnFile={emailByCompany.get(c.id as string) ?? ""}
                  repName={me?.name ?? ""}
                  gmailConnected={gmailConnected}
                  onChanged={refresh}
                />
              ))}
            </div>
          ) : (
            <Card className="p-4 text-sm text-mute">
              Nothing due right now — every follow-up is scheduled or fully nudged. Nice.
            </Card>
          )}

          {scheduled.length > 0 ? (
            <div className="space-y-3">
              <div className="pt-1 text-xs font-medium uppercase tracking-wider text-faint">
                Scheduled &amp; finished · {scheduled.length}
              </div>
              <div className="grid grid-cols-1 gap-3">
                {scheduled.map((c) => (
                  <FollowUpCard
                    key={c.id as string}
                    company={c}
                    emailOnFile={emailByCompany.get(c.id as string) ?? ""}
                    repName={me?.name ?? ""}
                    gmailConnected={gmailConnected}
                    onChanged={refresh}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}

      <ComposeSection
        companies={workspace.companies as EmailTargetRow[]}
        recent={workspace.recent as SentEmailRow[]}
        gmail={gmail as { configured: boolean; connected: boolean; email: string | null }}
        repName={me?.name ?? ""}
        onSent={refresh}
      />

      <p className="text-xs text-faint">
        {gmailConnected
          ? "Nudges send from your own Gmail address, and replies land in your inbox. Each send is logged on the company's timeline."
          : "Right now drafts open in your own email app with everything pre-filled. Connect your Gmail in Settings to send them straight from here."}
      </p>
    </div>
  );
}

// Pseudo-template id for the AI-written, per-business draft in the composer.
const TAILORED_ID = "ai_tailored";

// The one-off composer (formerly its own Email tab): pick a client and the
// To field + a ready-to-edit draft fill themselves in. Sends go through the
// rep's connected Gmail, or open as a pre-filled draft in their mail app.
function ComposeSection({
  companies,
  recent,
  gmail,
  repName,
  onSent,
}: {
  companies: EmailTargetRow[];
  recent: SentEmailRow[];
  gmail: { configured: boolean; connected: boolean; email: string | null };
  repName: string;
  onSent: () => void;
}) {
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState("intro");
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  const selected = useMemo(
    () => companies.find((c) => c.id === selectedId) ?? null,
    [companies, selectedId],
  );

  const filtered = useMemo(() => {
    // The picker only offers companies with an email on file — this is a
    // composer, and a recipient you can't send to is just noise.
    const emailable = companies.filter((c) => (c.contact_email ?? "").trim() !== "");
    const needle = q.trim().toLowerCase();
    if (!needle) return emailable;
    return emailable.filter(
      (c) =>
        c.name.toLowerCase().includes(needle) ||
        (c.city ?? "").toLowerCase().includes(needle) ||
        (c.industry ?? "").toLowerCase().includes(needle) ||
        (c.contact_email ?? "").toLowerCase().includes(needle),
    );
  }, [companies, q]);

  function applyTemplate(id: string, company: EmailTargetRow | null) {
    const tpl = EMAIL_TEMPLATES.find((t) => t.id === id) ?? EMAIL_TEMPLATES[0];
    const draft = tpl.build({
      company: company?.name ?? "your business",
      firstName: company?.contact_first_name ?? null,
      repName,
      // Hand the template the row so it can write about this business —
      // its town, its trade, its rating — instead of a name in a slot.
      row: company,
    });
    setTemplateId(id);
    setSubject(draft.subject);
    setBody(draft.body);
  }

  function pickCompany(c: EmailTargetRow) {
    setSelectedId(c.id);
    setTo(c.contact_email ?? "");
    // If the nightly research wrote a bespoke email for this business, lead
    // with it — it's about THEIR site and THEIR situation. Otherwise re-run
    // the current template so the draft at least speaks to this client.
    const ai = aiDraftFromResearch(c.research, repName, c);
    if (ai) {
      setTemplateId(TAILORED_ID);
      setSubject(ai.subject);
      setBody(ai.body);
      return;
    }
    const tplId = templateId === TAILORED_ID ? "intro" : templateId;
    const tpl = EMAIL_TEMPLATES.find((t) => t.id === tplId) ?? EMAIL_TEMPLATES[0];
    const draft = tpl.build({ company: c.name, firstName: c.contact_first_name, repName, row: c });
    setTemplateId(tplId);
    setSubject(draft.subject);
    setBody(draft.body);
  }

  // The AI draft for the currently selected client, if their research has one.
  const selectedAiDraft = selected ? aiDraftFromResearch(selected.research, repName, selected) : null;
  // What we've already sent this company — shown above the draft, not below it.
  const selectedHistory = emailHistory(selected);

  const canSend = to.trim().includes("@") && subject.trim().length > 0 && body.trim().length > 0;

  async function send() {
    if (!canSend || sending) return;
    setSending(true);
    try {
      if (gmail.connected) {
        const res = await sendCrmEmail({
          data: {
            to: to.trim(),
            subject: subject.trim(),
            body,
            company_id: selected?.id,
            contact_id: selected?.contact_id ?? undefined,
          },
        });
        if (!res.ok) {
          toast(res.error || "Couldn't send the email.", "error");
          return;
        }
        toast(`Sent to ${to.trim()} ✓`, "success");
        onSent();
      } else {
        // No Gmail connected: open a pre-filled draft in their own email app and
        // still record the touch so the follow-up cadence stays accurate.
        if (selected) await recordEmailTouch({ data: { company_id: selected.id } }).catch(() => {});
        window.location.href = mailtoLink(to.trim(), subject.trim(), body);
        onSent();
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't send the email.", "error");
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="space-y-3 border-t border-line pt-5">
      <div>
        <Eyebrow>Write any email</Eyebrow>
        <p className="mt-1 text-xs text-faint">
          Pick a client and the email writes itself — their name, your name, all filled in. Tweak it and hit send.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(260px,1fr)_2fr]">
        {/* Client picker */}
        <Card className="flex max-h-[520px] flex-col p-3">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search clients…"
            aria-label="Search clients"
          />
          <div className="mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
            {filtered.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => pickCompany(c)}
                className={cx(
                  "w-full rounded-lg border px-3 py-2 text-left transition-colors",
                  selectedId === c.id
                    ? "border-signal/50 bg-signal-soft"
                    : "border-transparent hover:bg-surface-2",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-bone">{c.name}</span>
                  {/* Was a bare count with no date, which reads as trivia. The
                      date is what makes it a decision: "3× emailed" shrugs,
                      "3× emailed · last 4d ago" stops your hand. */}
                  <EmailedBadge company={c} />
                </div>
                <div className="mt-0.5 truncate text-xs text-faint">
                  {c.contact_email || "No email on file — add one or type it in"}
                </div>
              </button>
            ))}
            {filtered.length === 0 ? (
              <p className="px-2 py-4 text-center text-xs text-faint">No clients match.</p>
            ) : null}
          </div>
        </Card>

        {/* Compose */}
        <Card className="space-y-3 p-4">
          {/* The whole reason this exists: Barry was one click from sending a
              second cold email to a company he'd already written to, and the
              CRM knew and said nothing. It warns, it does not block — a real
              follow-up is a good email, and only the person writing it can
              tell the difference. */}
          {selectedHistory ? (
            <div
              className={cx(
                "rounded-lg border px-3 py-2 text-xs leading-relaxed",
                selectedHistory.exhausted || selectedHistory.recent
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-800"
                  : "border-line bg-surface-2 text-mute",
              )}
            >
              <span className="font-semibold">
                You've already emailed {selected?.name ?? "this company"} {selectedHistory.touches}
                {selectedHistory.touches === 1 ? " time" : " times"}
                {selectedHistory.label.includes("·")
                  ? `, ${selectedHistory.label.split("·")[1].trim()}`
                  : ""}
                .
              </span>{" "}
              {selectedHistory.advice || "Worth a glance at the thread below before you write another."}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-1.5">
            {selectedAiDraft ? (
              <button
                type="button"
                title="An AI-written email about this specific business, from its research"
                onClick={() => {
                  setTemplateId(TAILORED_ID);
                  setSubject(selectedAiDraft.subject);
                  setBody(selectedAiDraft.body);
                }}
                className={cx(
                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  templateId === TAILORED_ID
                    ? "border-signal/60 bg-signal-soft text-signal"
                    : "border-line text-mute hover:border-line-strong hover:text-bone",
                )}
              >
                ✨ Tailored
              </button>
            ) : null}
            {EMAIL_TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                title={t.hint}
                onClick={() => applyTemplate(t.id, selected)}
                className={cx(
                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  templateId === t.id
                    ? "border-signal/60 bg-signal-soft text-signal"
                    : "border-line text-mute hover:border-line-strong hover:text-bone",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="space-y-1">
            <Eyebrow>To</Eyebrow>
            <Input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder={selected ? "No email on file — type one" : "Pick a client or type an address"}
              aria-label="Recipient email"
            />
          </div>

          <div className="space-y-1">
            <Eyebrow>Subject</Eyebrow>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject"
              aria-label="Subject"
            />
          </div>

          <div className="space-y-1">
            <Eyebrow>Message</Eyebrow>
            <Textarea
              rows={10}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Pick a client on the left and a template above — the draft fills itself in."
              aria-label="Email body"
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-faint">
              {gmail.connected
                ? `Sends from ${gmail.email ?? "your connected Gmail"}`
                : "Opens a pre-filled draft in your email app"}
            </span>
            <Button disabled={!canSend || sending} onClick={() => void send()}>
              {sending ? "Sending…" : gmail.connected ? "Send email" : "Open draft"}
            </Button>
          </div>
        </Card>
      </div>

      {/* Recent sends */}
      {recent.length > 0 ? (
        <div className="space-y-2">
          <Eyebrow>Your recent emails</Eyebrow>
          <Card className="divide-y divide-line p-0">
            {recent.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <div className="truncate text-sm text-bone">{r.subject || "(no subject)"}</div>
                  <div className="truncate text-xs text-faint">
                    {r.company_name ? `${r.company_name} · ` : ""}
                    {r.to_email}
                  </div>
                </div>
                <span className="shrink-0 text-xs text-faint" title={r.created_at}>
                  {relativeTime(r.created_at)}
                </span>
              </div>
            ))}
          </Card>
        </div>
      ) : null}
    </section>
  );
}
