import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import {
  getEmailWorkspace,
  getGmailStatus,
  sendCrmEmail,
  recordEmailTouch,
  type EmailTargetRow,
  type SentEmailRow,
} from "../../lib/crm/data";
import { EMAIL_TEMPLATES, mailtoLink } from "../../lib/crm/emails";
import {
  Button,
  Card,
  EmptyState,
  Eyebrow,
  Input,
  PageHeader,
  Pill,
  Textarea,
  cx,
} from "../../components/crm/ui";
import { toast } from "../../components/crm/toast";
import { relativeTime } from "../../lib/crm/constants";

// The Email tab: pick a client, and the To field + a ready-to-edit draft fill
// themselves in (company name, contact first name, your sign-off). Templates
// cover the common moments — intro, follow-up, quote heads-up, launch day.
// Sends go out through the rep's connected Gmail; without Gmail connected the
// same button opens a pre-filled draft in their own email app instead.

export const Route = createFileRoute("/_app/emails")({
  loader: async ({ context }) => {
    const [workspace, gmail] = await Promise.all([
      getEmailWorkspace(),
      getGmailStatus().catch(() => ({ configured: false, connected: false, email: null })),
    ]);
    const me = (context as { user?: { name?: string } }).user ?? null;
    return { ...workspace, gmail, repName: me?.name ?? "" };
  },
  component: EmailsPage,
});

function EmailsPage() {
  const { companies, recent, gmail, repName } = Route.useLoaderData() as {
    companies: EmailTargetRow[];
    recent: SentEmailRow[];
    gmail: { configured: boolean; connected: boolean; email: string | null };
    repName: string;
  };
  const router = useRouter();

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
    const needle = q.trim().toLowerCase();
    if (!needle) return companies;
    return companies.filter(
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
    });
    setTemplateId(id);
    setSubject(draft.subject);
    setBody(draft.body);
  }

  function pickCompany(c: EmailTargetRow) {
    setSelectedId(c.id);
    setTo(c.contact_email ?? "");
    // Re-run the current template so the draft speaks to THIS client.
    const tpl = EMAIL_TEMPLATES.find((t) => t.id === templateId) ?? EMAIL_TEMPLATES[0];
    const draft = tpl.build({ company: c.name, firstName: c.contact_first_name, repName });
    setSubject(draft.subject);
    setBody(draft.body);
  }

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
        void router.invalidate();
      } else {
        // No Gmail connected: open a pre-filled draft in their own email app and
        // still record the touch so the follow-up cadence stays accurate.
        if (selected) await recordEmailTouch({ data: { company_id: selected.id } }).catch(() => {});
        window.location.href = mailtoLink(to.trim(), subject.trim(), body);
        void router.invalidate();
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't send the email.", "error");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Email"
        subtitle="Pick a client and the email writes itself — their name, your name, all filled in. Tweak it and hit send."
      />

      {!gmail.connected ? (
        <Card className="p-3 text-sm text-mute">
          {gmail.configured
            ? "Gmail isn't connected yet — emails will open as drafts in your own email app. Connect Gmail in Settings to send straight from here."
            : "Emails open as pre-filled drafts in your own email app. Once Gmail is set up in Settings, you can send them straight from this page."}
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(260px,1fr)_2fr]">
        {/* Client picker */}
        <Card className="flex max-h-[640px] flex-col p-3">
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
                  {c.email_touches > 0 ? (
                    <Pill tone="neutral">{c.email_touches}× emailed</Pill>
                  ) : null}
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
          <div className="flex flex-wrap gap-1.5">
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
              rows={12}
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
      <section className="space-y-3">
        <Eyebrow>Your recent emails</Eyebrow>
        {recent.length === 0 ? (
          <EmptyState
            title="Nothing sent yet"
            hint="Emails you send from here show up in this list, so you always know who you've touched."
          />
        ) : (
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
        )}
      </section>
    </div>
  );
}
