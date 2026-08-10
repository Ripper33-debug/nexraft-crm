import { createFileRoute } from "@tanstack/react-router";

import { getSharedProposal, type SharedProposal } from "../lib/crm/data";
import { LogoMark } from "../components/crm/brand";
import { cx } from "../components/crm/ui";
import { PRICING_PACKAGES, formatMoney } from "../lib/crm/constants";

// PUBLIC proposal page for PROSPECTS (no login), reached via the unguessable
// /proposal/<token> link a rep copies from a deal. Loading it marks the deal's
// proposal as viewed server-side and pings the rep — see getSharedProposal.
// Shows only client-safe info: packages, pricing, process, and the opportunity
// notes reframed as benefits. Never raw CRM data.

export const Route = createFileRoute("/proposal/$token")({
  loader: async ({ params }) => {
    const proposal = await getSharedProposal({ data: { token: params.token } }).catch(() => null);
    return { proposal };
  },
  component: ProposalPage,
});

// The dossier's pitch angles are written for reps ("wide open for a rebuild
// pitch"). Reframe the recognizable ones as client-facing benefits and drop
// anything we can't confidently translate — never leak rep-speak to a prospect.
function clientBenefits(research: string | null): string[] {
  let angles: string[] = [];
  try {
    const d = JSON.parse(research || "{}") as { angles?: unknown };
    if (Array.isArray(d.angles)) angles = d.angles.filter((a): a is string => typeof a === "string");
  } catch {
    /* no dossier — fall through to defaults */
  }
  const out: string[] = [];
  const add = (s: string) => {
    if (!out.includes(s)) out.push(s);
  };
  for (const a of angles) {
    const t = a.toLowerCase();
    if (t.includes("booking") || t.includes("appointment")) add("Online booking, so customers can book you 24/7 — even after hours");
    else if (t.includes("testimonial") || t.includes("review")) add("Your best reviews front and center, doing the selling for you");
    else if (t.includes("contact form") || t.includes("no form")) add("A contact form and click-to-call that turn visitors into phone calls");
    else if (t.includes("mobile")) add("Designed mobile-first — most of your customers are on their phones");
    else if (t.includes("slow") || t.includes("speed")) add("Fast load times, because slow sites lose customers before they see anything");
    else if (t.includes("copyright") || t.includes("outdated") || t.includes("old")) add("A fresh, modern design that makes you look like the obvious choice");
    else if (t.includes("down or gone") || t.includes("no website")) add("A brand-new site built from the ground up around your business");
  }
  // Always-true benefits round the list out to at least four.
  add("Built to rank on Google in your service area");
  add("We handle hosting, updates, and changes — you never touch code");
  if (out.length < 4) add("Clear calls-to-action on every page, built to generate leads");
  return out.slice(0, 5);
}

// Pick which package to spotlight: the one whose first-year total sits closest
// to the priced deal, or the house-recommended tier when the deal is unpriced.
function spotlightId(value: number): string {
  if (!value || value <= 0) return PRICING_PACKAGES.find((p) => p.recommended)?.id ?? "business";
  let best = PRICING_PACKAGES[0];
  for (const p of PRICING_PACKAGES) {
    if (Math.abs(p.build - value) < Math.abs(best.build - value)) best = p;
  }
  return best.id;
}

const STEPS = [
  { name: "Kickoff", body: "A short call to nail down your goals, pages, and look. We do the heavy lifting." },
  { name: "Design", body: "You see your new homepage design first — nothing gets built until you love it." },
  { name: "Build", body: "We build every page, write for search, and test on every screen size." },
  { name: "Launch", body: "We go live, point your domain, and stay on for updates and support." },
];

function ProposalPage() {
  const { proposal } = Route.useLoaderData() as { proposal: SharedProposal | null };

  if (!proposal) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-ink px-4">
        <div className="w-full max-w-md rounded-md border border-line bg-surface p-6 text-center shadow-sm">
          <div className="mb-4 flex items-center justify-center gap-2.5">
            <LogoMark size={34} radius={9} />
            <span className="text-lg font-semibold tracking-tight text-bone">
              Nexraft<span className="text-signal">.</span>
            </span>
          </div>
          <h1 className="text-xl font-semibold text-bone">This proposal link isn&apos;t active</h1>
          <p className="mt-2 text-sm text-mute">
            It may have expired or been replaced. Reach out to your Nexraft contact and we&apos;ll
            send a fresh one right away.
          </p>
        </div>
      </div>
    );
  }

  const company = proposal.company_name ?? "your business";
  const benefits = clientBenefits(proposal.research);
  const spotlight = spotlightId(proposal.value);

  return (
    <div className="min-h-dvh bg-ink text-bone">
      {/* Top bar */}
      <header className="mx-auto flex max-w-4xl items-center justify-between px-5 py-6">
        <div className="flex items-center gap-2.5">
          <LogoMark size={32} radius={8} />
          <span className="text-lg font-semibold tracking-tight">
            Nexraft<span className="text-signal">.</span>
          </span>
        </div>
        <span className="text-xs font-medium text-faint">
          Website proposal
        </span>
      </header>

      {/* Hero */}
      <section className="relative mx-auto max-w-4xl px-5 pb-14 pt-8">
        <div
          className="pointer-events-none absolute inset-x-0 -top-24 h-72"
          style={{ background: "radial-gradient(60% 100% at 50% 0%, rgba(24,24,27,0.07), transparent 70%)" }}
        />
        <p className="text-xs font-medium text-signal">
          Prepared for {company}
          {proposal.company_city ? ` · ${proposal.company_city}` : ""}
        </p>
        <h1 className="mt-3 max-w-2xl font-display text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl">
          A website that wins <span className="text-signal">{company}</span> more customers.
        </h1>
        <p className="mt-4 max-w-xl text-base leading-relaxed text-mute">
          We design and build websites for local businesses that need to look like the obvious
          choice — and we handle everything after launch, so you can stay focused on the work.
        </p>
      </section>

      {/* What you get */}
      <section className="mx-auto max-w-4xl px-5 pb-14">
        <h2 className="text-xs font-medium text-faint">
          What we&apos;d build for you
        </h2>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {benefits.map((b) => (
            <li key={b} className="flex items-start gap-3 rounded-md border border-line bg-surface px-4 py-3.5">
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-sm bg-signal" />
              <span className="text-sm leading-relaxed text-bone">{b}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Packages */}
      <section className="mx-auto max-w-4xl px-5 pb-14">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-faint">Investment</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {PRICING_PACKAGES.map((p) => {
            const hot = p.id === spotlight;
            return (
              <div
                key={p.id}
                className={cx(
                  "relative rounded-md border p-5",
                  hot
                    ? "border-signal/60 bg-signal-soft"
                    : "border-line bg-surface",
                )}
              >
                {hot ? (
                  <span className="absolute -top-2.5 left-5 rounded-full bg-signal px-2.5 py-0.5 text-xs font-medium text-ink">
                    Our pick for you
                  </span>
                ) : null}
                <h3 className="font-display text-lg font-semibold">{p.name}</h3>
                <p className="mt-1 text-xs text-mute">{p.blurb}</p>
                <p className="mt-4 text-3xl font-semibold tabular-nums tracking-tight">
                  {p.startsAt ? <span className="text-sm font-medium text-faint">from </span> : null}
                  {formatMoney(p.build)}
                </p>
                <p className="text-xs text-faint">one-time build · {p.pages}</p>
                <p className="mt-3 text-sm text-mute">
                  <span className="font-semibold text-bone">{formatMoney(p.monthly)}/mo</span> hosting,
                  updates &amp; support
                </p>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-faint">
          Every package includes design, copywriting help, mobile optimization, and search setup.
          No hidden fees — the monthly covers hosting, security, and unlimited small changes.
        </p>
      </section>

      {/* Process */}
      <section className="mx-auto max-w-4xl px-5 pb-14">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-faint">
          How it works
        </h2>
        <ol className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.name} className="rounded-md border border-line bg-surface p-4">
              <span className="font-mono text-[11px] font-bold text-signal">0{i + 1}</span>
              <h3 className="mt-1 text-sm font-semibold text-bone">{s.name}</h3>
              <p className="mt-1 text-xs leading-relaxed text-mute">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-4xl px-5 pb-16">
        <div className="rounded-md border border-signal/40 bg-surface p-6 text-center sm:p-8">
          <h2 className="font-display text-2xl font-semibold tracking-tight">
            Ready when you are.
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-mute">
            {proposal.rep_name
              ? `Reply to ${proposal.rep_name}'s email or give them a call — say the word and we'll get your kickoff on the calendar this week.`
              : "Reply to our email or give us a call — say the word and we'll get your kickoff on the calendar this week."}
          </p>
        </div>
        <p className="mt-6 text-center text-[11px] text-faint">
          Built by Nexraft ·{" "}
          <a href="https://nexraft.com" className="text-mute hover:text-bone">
            nexraft.com
          </a>
        </p>
      </section>
    </div>
  );
}
