import { createFileRoute, Link } from "@tanstack/react-router";

import { Card, PageHeader, Eyebrow } from "../../components/crm/ui";
import { STAGES } from "../../lib/crm/constants";

export const Route = createFileRoute("/_app/help")({
  component: HelpPage,
});

// A plain-English section. Title on top, prose underneath — no jargon.
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="p-5">
      <Eyebrow className="mb-2">{title}</Eyebrow>
      <div className="space-y-2 text-sm leading-relaxed text-mute">{children}</div>
    </Card>
  );
}

function HelpPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <PageHeader
        title="How it works"
        subtitle="A quick, plain-English guide to everything in your CRM. No jargon — just what each part does and when to use it."
      />

      <div className="mt-6 space-y-4">
        <Section title="The big picture">
          <p>
            This CRM keeps track of the companies you're talking to, the people at those companies, and
            the deals you're working to win. Everything flows in one direction: a new company comes in,
            someone calls it, and if there's interest it becomes a deal that moves through your pipeline
            until it's won (launched) or lost.
          </p>
          <p>
            You don't need to set anything up. Just add companies and contacts as you meet them, and
            create deals when there's real work on the table.
          </p>
        </Section>

        <Section title="The Dashboard & your “Today” list">
          <p>
            The <Link to="/" className="text-signal hover:underline">Dashboard</Link> is your morning
            check-in. The <strong className="text-bone">Today</strong> panel at the top tells you exactly
            what needs you right now: companies to call, follow-ups that are due, and renewals coming up.
            Start there and work your way down the list.
          </p>
          <p>
            The numbers below it (open pipeline, weighted forecast, win rate, recurring revenue) each have
            a small <span className="font-mono text-faint">?</span> next to them — hover over it any time
            for a one-line explanation of what that number means.
          </p>
        </Section>

        <Section title="The call queue (who to call)">
          <p>
            Whenever a new company is added with no deal attached yet, it automatically lands in the{" "}
            <Link to="/calls" className="text-signal hover:underline">Calls</Link> queue. You'll see a
            count like “4 companies need a first call,” along with who added each one.
          </p>
          <p>
            Go through them one at a time. After each call, mark it{" "}
            <strong className="text-bone">Interested</strong> or{" "}
            <strong className="text-bone">Not interested</strong>, and the company moves out of the queue
            into that bucket. That's it — no forms to fill in.
          </p>
        </Section>

        <Section title="The pipeline & its stages">
          <p>
            The <Link to="/pipeline" search={{ focus: undefined, new: undefined }} className="text-signal hover:underline">Pipeline</Link>{" "}
            is where deals live. Each deal sits in a stage, and you move it forward by dragging its card
            (board view) or picking a new stage (table view). Here's what the stages mean:
          </p>
          <ul className="mt-1 space-y-1.5">
            {STAGES.map((s) => (
              <li key={s.name} className="flex items-start gap-2">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
                <span>
                  <strong className="text-bone">{s.name}</strong>
                  {s.kind === "won" ? " — the deal is won and the site is live." : null}
                  {s.kind === "lost" ? " — the deal didn't happen. You can note why, which feeds your win/loss reports." : null}
                  {s.kind === "open" ? " — still in progress." : null}
                </span>
              </li>
            ))}
          </ul>
          <p>
            The <strong className="text-bone">weighted forecast</strong> takes each open deal's value and
            scales it by how likely that stage is to close, so you get a realistic view of what you'll
            actually land rather than a best-case total.
          </p>
        </Section>

        <Section title="Proposals">
          <p>
            Each deal has a proposal status — <strong className="text-bone">Sent</strong>,{" "}
            <strong className="text-bone">Viewed</strong>, or <strong className="text-bone">Signed</strong>.
            Set it in the deal's details and a little badge shows up on the card, so at a glance you know
            which deals are waiting on the client to sign.
          </p>
        </Section>

        <Section title="Who owns what (ownership, handoff & sharing)">
          <p>
            Every company, contact, and deal has one <strong className="text-bone">owner</strong> — the
            person responsible for it — so two people don't accidentally work the same account. If a record
            isn't yours, you'll see it as view-only.
          </p>
          <p>
            To pass a record to a teammate, use <strong className="text-bone">hand off</strong>. To let
            someone help without taking it over, use <strong className="text-bone">share</strong>. Either
            way, that person gets a notification (the bell in the top corner) so nothing slips through.
          </p>
        </Section>

        <Section title="Follow-ups & activities">
          <p>
            <Link to="/activities" className="text-signal hover:underline">Activities</Link> are the calls,
            emails, and to-dos tied to your deals. Give one a due date and it becomes a follow-up. Anything
            due today or overdue shows up in your Today list on the dashboard, so you never lose track.
          </p>
        </Section>

        <Section title="Recurring revenue & renewals">
          <p>
            When a deal has a monthly value (a retainer or hosting), it counts toward your{" "}
            <strong className="text-bone">recurring revenue</strong> — the predictable income you can
            count on each month (often called MRR). Add a renewal date and the dashboard will remind you
            before it comes due, so you can reach out in time.
          </p>
        </Section>

        <Section title="Importing & exporting (CSV)">
          <p>
            On the <Link to="/companies" search={{ focus: undefined, new: undefined }} className="text-signal hover:underline">Companies</Link> and{" "}
            <Link to="/contacts" search={{ focus: undefined, new: undefined }} className="text-signal hover:underline">Contacts</Link> screens, use{" "}
            <strong className="text-bone">Import CSV</strong> to bulk-add records from a spreadsheet. You'll
            get a preview before anything is saved. <strong className="text-bone">Export CSV</strong> pulls
            everything back out — handy for backups or moving data elsewhere later.
          </p>
        </Section>

        <Section title="Made a mistake? Undo it">
          <p>
            When you archive a record or move a deal to a new stage, a little message pops up in the corner
            with an <strong className="text-bone">Undo</strong> button for a few seconds. Click it to put
            things back exactly as they were. Nothing is ever truly deleted — archived items can always be
            restored from the archive panel at the bottom of each screen.
          </p>
        </Section>
      </div>
    </div>
  );
}
