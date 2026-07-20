import { createFileRoute, Link } from "@tanstack/react-router";

import { Button, Card, PageHeader, Eyebrow } from "../../components/crm/ui";
import { startTour } from "../../components/crm/tour";
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
        actions={
          <Button variant="outline" onClick={() => startTour()}>
            Replay the tour
          </Button>
        }
      />

      <div className="mt-6 space-y-4">
        <Section title="What Nexraft does">
          <p>
            <strong className="text-bone">Nexraft builds clean, professional websites for local
            businesses.</strong> We handle the whole thing — design, copy, and hosting — so it's genuinely
            hands-off for the client, and most local businesses are up and running within a couple of weeks.
          </p>
          <p>
            The best-fit customers are local businesses that either have no website yet or have one that's
            dated and holding them back. We reach out, show them what a modern site could do for them, and
            build it once they're on board.
          </p>
          <p>
            After launch, many clients stay on a <strong className="text-bone">monthly retainer</strong> —
            hosting, upkeep, and small changes — which is where the steady, predictable income comes from.
            So the business has two halves: <em>winning new website projects</em>, and{" "}
            <em>keeping clients on recurring plans</em>. This CRM is the tool that runs both.
          </p>
        </Section>

        <Section title="The big picture — how a client moves through the CRM">
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

        <Section title="Claiming leads from the pool">
          <p>
            Unowned companies are the <strong className="text-bone">open pool</strong>. On the{" "}
            <Link to="/companies" search={{ focus: undefined, new: undefined }} className="text-signal hover:underline">Companies</Link> list, anything
            without an owner shows a <strong className="text-bone">Claim</strong> button — hit it and the
            company (plus its deal) is yours and drops straight into your call queue. The hottest unclaimed
            ones are also flagged on <Link to="/today" className="text-signal hover:underline">My Day</Link>,
            so you can grab the best chances before a teammate does.
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

        <Section title="Emailing prospects who don't pick up">
          <p>
            When someone doesn't answer a call, head to{" "}
            <Link to="/followups" className="text-signal hover:underline">Outreach</Link> and send them a
            nudge by email. The CRM writes a friendly, ready-to-send draft for you — a gentle set of
            escalating notes ("sorry we missed you," then a quick idea, then a graceful last check-in) — so
            you never stare at a blank message. The same page has a composer at the bottom for any other
            email — intros, quote heads-ups, launch-day notes — pre-filled from a template.
          </p>
          <p>
            If you connect your Google account under{" "}
            <Link to="/settings" search={{ email: undefined }} className="text-signal hover:underline">Settings</Link>, those emails send
            straight from your own address, replies land in your own inbox, and every send is logged on the
            company's timeline. The CRM only ever <strong className="text-bone">sends</strong> mail — it
            never reads your inbox.
          </p>
        </Section>

        <Section title="Win/loss numbers & exports">
          <p>
            The bottom of the <Link to="/" className="text-signal hover:underline">Dashboard</Link> shows how
            the team is performing — how many deals are being won versus lost, why the lost ones were lost,
            and who's closing. It's also where admins can pull a clean export of all the data if you ever
            need it elsewhere.
          </p>
        </Section>

        <Section title="For admins: the Team view & commissions">
          <p>
            If you're an admin, <Link to="/team" className="text-signal hover:underline">Team</Link> gives
            you a bird's-eye view of everything each teammate owns — their deals, companies, contacts, and
            activity — and lets you add new teammates, reset a password, or reassign someone's records if
            they leave or hand off an account.
          </p>
          <p>
            <Link to="/payroll" className="text-signal hover:underline">Payroll</Link> tracks what each rep
            has earned. Reps make a commission on every signed retainer (for the first several months),
            plus a bonus the first month they hit their signing target — so this page turns closed deals
            into exactly what everyone gets paid.
          </p>
        </Section>

        <Section title="Making it yours (appearance)">
          <p>
            Under <Link to="/settings" search={{ email: undefined }} className="text-signal hover:underline">Settings</Link> you can
            switch between <strong className="text-bone">Warm Paper</strong> (a bright, easy-on-the-eyes
            light look), <strong className="text-bone">Dark</strong> (its warm-charcoal counterpart for
            evenings), or <strong className="text-bone">System</strong> (follow your device). Your choice is
            saved on your device and applies instantly — it's just for you and doesn't change anything for
            the rest of the team.
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
