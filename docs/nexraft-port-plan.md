# Nexraft Port Plan

Nexraft is moving onto the CompAI CRM foundation. The base app keeps CompAI's
record sheets, dynamic fields, saved views, sync integrations, and agent runtime.
Nexraft-specific sales operations are added as focused modules.

## Kept From CompAI

- App/API/agent monorepo architecture.
- Prisma/Postgres data model and migrations.
- Light CRM shell, icon rail, record sheets, timeline, and Agent tab.
- Dynamic fields with sheet/table/filter visibility.
- Saved and shared views.
- Gmail, Outlook, Calendar, Slack, and website tracking foundations.
- Evidence-based contact facts and background agent tasks.

## Ported From Nexraft

- Calls and My Day queue.
- Call outcomes: interested, maybe, no answer, no, signed.
- Proposal links, viewed/sent tracking, and signed-deal handling.
- No-answer follow-up email flow.
- Lead discovery, website checks, and research enrichment.
- Project handoff after a won deal.
- Payroll/commission reporting.
- Stripe invoice workflow.
- Nexraft admin/team operating rules.

## Migration Order

1. Rebrand the CompAI base to Nexraft.
2. Add Nexraft Calls as a first-class navigation section.
3. Add call-outcome persistence and activity logging.
4. Add proposal links and proposal status to deals.
5. Add post-sale projects for closed-won deals.
6. Add Nexraft lead discovery and website status fields.
7. Add payroll and commission reporting.
8. Migrate data from the old Nexraft CRM.

## Current Slice

The first slice adds the Nexraft Calls section and extends company rows with
phone, email, and primary-contact summary data. It intentionally reuses the
existing CompAI account list and record-sheet behavior so the new workflow starts
inside the target architecture.
