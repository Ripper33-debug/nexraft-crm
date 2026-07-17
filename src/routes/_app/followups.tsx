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
  const [to, setTo] = useState(emailOnFile);
  const [busy, setBusy] = useState(false);

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
      const draft = followUpEmail(name, repName, nextTouch);
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
                ? "Send another"
                : `✉ Send ${NUDGE_LABELS[nextTouch - 1]}`
              : allSent
                ? "Send another draft"
                : `✉ Open ${NUDGE_LABELS[nextTouch - 1]}`}
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => resolve("interested")}>
            They replied
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => resolve("not_interested")}>
            Give up
          </Button>
        </div>
      </div>
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

  // Everyone who didn't pick up — the follow-up worklist. Least-nudged first.
  const queue = useMemo(() => {
    return (companies as Row[])
      .filter((c) => c.call_outcome === "no_answer")
      .sort((a, b) => (Number(a.email_touches) || 0) - (Number(b.email_touches) || 0));
  }, [companies]);

  const stats = useMemo(() => {
    let needFirst = 0;
    let done = 0;
    for (const c of queue) {
      const t = Number(c.email_touches) || 0;
      if (t === 0) needFirst++;
      if (t >= 3) done++;
    }
    return { total: queue.length, needFirst, done };
  }, [queue]);

  const refresh = () => router.invalidate();

  return (
    <div className="space-y-5">
      <PageHeader
        title="Follow-ups"
        subtitle="Didn't pick up? Nudge them by email — a friendly draft opens ready to send from your own inbox."
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryCard label="Waiting on a nudge" value={String(stats.total)} accent sub="didn't answer the call" />
        <SummaryCard label="Not emailed yet" value={String(stats.needFirst)} hint="Send the 1st nudge" />
        <SummaryCard label="Fully nudged" value={String(stats.done)} hint="All 3 sent" />
      </div>

      {queue.length === 0 ? (
        <EmptyState
          title="Nobody's waiting on a follow-up"
          hint="When a call goes unanswered, mark it “No answer” on the Calls board and it'll show up here to email."
        />
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {queue.map((c) => (
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
      )}

      <p className="text-xs text-faint">
        {gmailConnected
          ? "Nudges send from your own Gmail address, and replies land in your inbox. Each send is logged on the company's timeline."
          : "Right now drafts open in your own email app with everything pre-filled. Connect your Gmail in Settings to send them straight from here."}
      </p>
    </div>
  );
}
