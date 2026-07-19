import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import {
  getCompanies,
  getContacts,
  setCompanyCallOutcome,
  recordEmailTouch,
  sendCrmEmail,
  getGmailStatus,
} from "../../lib/crm/data";
import { Button, Card, EmptyState, Input, PageHeader, Pill, SummaryCard } from "../../components/crm/ui";
import { toast } from "../../components/crm/toast";
import { followUpEmail, mailtoLink, NUDGE_LABELS } from "../../lib/crm/emails";
import { relativeTime } from "../../lib/crm/constants";

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
    const [companies, contacts, gmail] = await Promise.all([
      getCompanies(),
      getContacts(),
      getGmailStatus().catch(() => ({ configured: false, connected: false, email: null })),
    ]);
    const me = (context as { user?: { id: string; role: string; name: string; email: string } }).user ?? null;
    return { companies, contacts, me, gmail };
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
  // the rep read and tweak it; approving sends exactly what's shown.
  const initialDraft = followUpEmail(name, repName, nextTouch);
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

  async function resolve(outcome: "interested" | "not_interested") {
    setBusy(true);
    try {
      await setCompanyCallOutcome({ data: { id, outcome } });
      toast(outcome === "interested" ? "Marked interested — moved to your pipeline." : "Closed out.", "success");
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
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => resolve("not_interested")}>
            Give up
          </Button>
        </div>
      </div>
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
  const { companies, contacts, me, gmail } = Route.useLoaderData();
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
  const queue = useMemo(() => {
    return (companies as Row[])
      .filter((c) => c.call_outcome === "no_answer")
      .sort((a, b) => (Number(a.email_touches) || 0) - (Number(b.email_touches) || 0));
  }, [companies]);

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
      const draft = followUpEmail((t.c.name as string) || "there", me?.name ?? "", Math.min(3, touches + 1));
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
        title="Follow-ups"
        subtitle="Your outbox: every nudge is pre-written and lined up — read it, tweak it, approve it. Or approve the whole due list in one click."
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryCard label="Due now" value={String(stats.dueNow)} accent sub={stats.overdue > 0 ? `${stats.overdue} overdue` : "nudge these today"} />
        <SummaryCard label="In the queue" value={String(stats.total)} hint="Everyone who didn't answer" />
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
                <div className="flex items-center justify-between rounded-xl border border-signal/25 bg-signal-soft px-4 py-3">
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

      <p className="text-xs text-faint">
        {gmailConnected
          ? "Nudges send from your own Gmail address, and replies land in your inbox. Each send is logged on the company's timeline."
          : "Right now drafts open in your own email app with everything pre-filled. Connect your Gmail in Settings to send them straight from here."}
      </p>
    </div>
  );
}
