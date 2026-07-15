import { useEffect, useMemo, useState } from "react";

import { Button, Eyebrow, Pill, StageBadge, cx } from "./ui";
import { toast } from "./toast";
import { logCall } from "../../lib/crm/data";
import {
  OPEN_STAGES,
  stageInfo,
  formatMoney,
  relativeTime,
  parseTags,
  tagColor,
  normalizeUrl,
} from "../../lib/crm/constants";

type Row = Record<string, unknown>;

// A single line of the live script. `say` = read it aloud, `ask` = a question to
// pose, `tip` = quiet coaching the caller shouldn't read out.
type Line = { kind: "say" | "ask" | "tip"; text: string };
type Section = { heading: string; lines: Line[] };

// Outcomes a caller can log in one tap. `followup` pre-fills a suggested
// follow-up window (in days) so the next touch never slips.
const OUTCOMES: { label: string; followup?: number; tone: "ok" | "signal" | "warn" | "danger" | "neutral" }[] = [
  { label: "Spoke with them", tone: "ok" },
  { label: "Left a voicemail", followup: 3, tone: "signal" },
  { label: "No answer", followup: 2, tone: "neutral" },
  { label: "Call back later", followup: 3, tone: "warn" },
  { label: "Not interested", tone: "danger" },
];

function fullName(c: Row): string {
  return `${(c.first_name as string) ?? ""} ${(c.last_name as string) ?? ""}`.trim();
}

function dealLabel(d: Row): string {
  return (d.name as string) || "the project";
}

// Furthest-along open deal wins the caller's attention.
function activeDeal(deals: Row[]): Row | null {
  const open = deals.filter((d) => OPEN_STAGES.includes(d.stage as string));
  if (open.length === 0) return null;
  return [...open].sort(
    (a, b) => stageInfo(b.stage as string).prob - stageInfo(a.stage as string).prob,
  )[0];
}

// Builds the adaptive talking points from whatever we actually know about the
// account — its stage, tags, source and history all steer the wording.
function buildScript(opts: {
  kind: "company" | "contact";
  companyName: string;
  firstName: string | null;
  industry: string | null;
  tags: string[];
  source: string | null;
  lastContacted: string | null;
  deals: Row[];
  hasWon: boolean;
}): Section[] {
  const { kind, companyName, firstName, industry, tags, source, deals, hasWon } = opts;
  const deal = activeDeal(deals);
  const stage = deal ? (deal.stage as string) : null;
  const dn = deal ? dealLabel(deal) : null;
  const atRisk = tags.includes("At risk");
  const isReferral = tags.includes("Referral") || source === "Referral";
  const isUpsell = tags.includes("Upsell") || tags.includes("Retainer");

  const sections: Section[] = [];

  // --- Opening -------------------------------------------------------------
  const opening: Line[] = [];
  if (kind === "contact" && firstName) {
    opening.push({ kind: "say", text: `Hi ${firstName}, I'm calling from Nexraft — do you have a couple of minutes?` });
  } else {
    opening.push({ kind: "say", text: `Hi, I'm calling from Nexraft — is this the right person to talk to about ${companyName}'s website?` });
  }
  if (isReferral) {
    opening.push({ kind: "say", text: `You came recommended to us, so I wanted to reach out personally.` });
  }
  opening.push({ kind: "tip", text: `Smile, keep it relaxed, and let them talk more than you do.` });
  sections.push({ heading: "Opening", lines: opening });

  // --- Why you're calling --------------------------------------------------
  const why: Line[] = [];
  if (stage === "Lead" || stage === "Discovery") {
    why.push({ kind: "say", text: `I wanted to learn a bit more about what you're hoping a new site could do for you.` });
    why.push({ kind: "tip", text: `Early stage — this call is about listening and qualifying, not pitching.` });
  } else if (stage === "Proposal") {
    why.push({ kind: "say", text: `I'm following up on the proposal we sent over for ${dn} — wanted to walk through it and answer anything.` });
    why.push({ kind: "tip", text: `They've seen numbers. Surface hesitations early.` });
  } else if (stage === "Negotiation") {
    why.push({ kind: "say", text: `I wanted to talk through the last details on ${dn} and figure out what it'll take to get started.` });
    why.push({ kind: "tip", text: `You're close. Aim to leave with a committed next step.` });
  } else if (stage === "In Build") {
    why.push({ kind: "say", text: `Quick check-in on the build for ${dn} — I wanted to keep you in the loop and see if anything's come up.` });
  } else if (hasWon) {
    why.push({ kind: "say", text: `It's been a little while, so I wanted to check in and see how the site's been performing for you.` });
    if (isUpsell) why.push({ kind: "tip", text: `Retainer / upsell account — listen for new needs (refresh, SEO, extra pages).` });
  } else if (atRisk) {
    why.push({ kind: "say", text: `I wanted to check in personally and make sure everything's on track on our end.` });
    why.push({ kind: "tip", text: `Flagged at risk — lead with care, not a pitch.` });
  } else {
    why.push({ kind: "say", text: `I came across ${companyName} and thought a sharper website could really help you stand out${industry ? ` in ${industry.toLowerCase()}` : ""}.` });
    why.push({ kind: "tip", text: `Cold-ish — earn 30 seconds of curiosity before going further.` });
  }
  sections.push({ heading: "Why you're calling", lines: why });

  // --- Discovery questions -------------------------------------------------
  const ask: Line[] = [];
  if (stage === "Proposal" || stage === "Negotiation") {
    ask.push({ kind: "ask", text: `How did the proposal land with everyone on your side?` });
    ask.push({ kind: "ask", text: `Is there anything holding you back from moving forward?` });
    ask.push({ kind: "ask", text: `Who else needs to sign off before we start?` });
  } else if (hasWon) {
    ask.push({ kind: "ask", text: `What's working well, and what would you change if you could?` });
    ask.push({ kind: "ask", text: `Anything new coming up where we could help?` });
  } else {
    ask.push({ kind: "ask", text: `What's prompting you to look at your website right now?` });
    ask.push({ kind: "ask", text: `What would a great outcome look like for you?` });
    ask.push({ kind: "ask", text: `Do you have a rough timeline or budget in mind?` });
  }
  sections.push({ heading: "Ask about them", lines: ask });

  // --- Handling pushback (only when money is on the table) -----------------
  if (stage === "Proposal" || stage === "Negotiation") {
    sections.push({
      heading: "If they hesitate",
      lines: [
        { kind: "tip", text: `On price: steer to value — the site pays for itself in leads, not the sticker.` },
        { kind: "tip", text: `On timing: offer to lock the slot now and start when they're ready.` },
        { kind: "tip", text: `On trust: point to the portfolio and offer a reference from a similar client.` },
      ],
    });
  }

  // --- Close ---------------------------------------------------------------
  const close: Line[] = [];
  const nextStep = deal && deal.next_step ? String(deal.next_step) : "";
  if (nextStep) {
    close.push({ kind: "say", text: `Last time we said the next step was: ${nextStep}. Shall we lock that in?` });
  } else if (stage === "Proposal" || stage === "Negotiation") {
    close.push({ kind: "say", text: `If it feels right, I can get the paperwork over today and we can pick a start date.` });
  } else if (hasWon) {
    close.push({ kind: "say", text: `I'll note anything you mentioned and follow up — sound good?` });
  } else {
    close.push({ kind: "say", text: `How about I put together a quick outline of what we'd do and send it over?` });
  }
  close.push({ kind: "tip", text: `Always leave with a concrete next step and a date. Log it below when you hang up.` });
  sections.push({ heading: "Close", lines: close });

  return sections;
}

// Live "they just said X → say this back" responses. The rep taps whatever the
// customer raised and the matching rebuttal surfaces instantly — no audio, works
// on any phone. Tuned for a web-design studio's sales calls.
type Signal = { id: string; label: string; group: "objection" | "buying"; lines: Line[] };

function buildSignals(firstName: string | null, companyName: string): Signal[] {
  const who = companyName || "your business";
  return [
    {
      id: "price",
      label: "Too expensive",
      group: "objection",
      lines: [
        { kind: "say", text: `I hear you. Most of our clients find the site pays for itself once it starts pulling in enquiries — can I show you how we'd get you there?` },
        { kind: "tip", text: `Don't discount yet. Anchor on the outcome, then ask what budget they had in mind.` },
      ],
    },
    {
      id: "think",
      label: "Let me think about it",
      group: "objection",
      lines: [
        { kind: "say", text: `Totally fair. So I can actually be useful — what's the main thing you'd want to feel sure about before going ahead?` },
        { kind: "tip", text: `"I'll think about it" almost always hides one specific concern. Surface it now.` },
      ],
    },
    {
      id: "email",
      label: "Just email me info",
      group: "objection",
      lines: [
        { kind: "say", text: `Happy to — and so I send the right thing, what matters most: examples of our work, pricing, or timeline?` },
        { kind: "ask", text: `When's a good day for me to follow up once you've had a look?` },
      ],
    },
    {
      id: "happy",
      label: "Happy with our site",
      group: "objection",
      lines: [
        { kind: "say", text: `Love that it's working for you. Just out of curiosity — if there were one thing the site did better, what would it be?` },
        { kind: "tip", text: `Open a small gap. You're looking for the itch, not a fight.` },
      ],
    },
    {
      id: "notime",
      label: "No time right now",
      group: "objection",
      lines: [
        { kind: "say", text: `No problem — I'll be quick, or we grab a better time. Is later this week or early next easier for you?` },
        { kind: "tip", text: `Offer two concrete windows, not "whenever suits."` },
      ],
    },
    {
      id: "who",
      label: "Who is this / not interested",
      group: "objection",
      lines: [
        { kind: "say", text: `Fair enough, I'll be upfront: we build websites that bring ${who} more enquiries. If that's ever on your radar, worth 30 seconds?` },
        { kind: "tip", text: `Stay warm, don't get defensive. One line, then let them react.` },
      ],
    },
    {
      id: "partner",
      label: "Need to ask my team",
      group: "objection",
      lines: [
        { kind: "say", text: `Makes sense, it's a team call. Would a short summary you can share help — or a quick call with both of you?` },
        { kind: "ask", text: `What do you think they'll want to know most?` },
      ],
    },
    {
      id: "howmuch",
      label: "How much does it cost?",
      group: "objection",
      lines: [
        { kind: "say", text: `Good question — it depends on what you need, and I want to quote you fairly. Can I ask a couple of quick things first so the number's real?` },
        { kind: "tip", text: `Don't blurt a price cold. Qualify the scope, then frame it.` },
      ],
    },
    {
      id: "competitor",
      label: "Looking at other options",
      group: "objection",
      lines: [
        { kind: "say", text: `Smart to compare. What clients tell us is they stay for the after-launch support, not just the build. What's on your shortlist to weigh up?` },
        { kind: "tip", text: `Differentiate on service and results, and learn their criteria.` },
      ],
    },
    {
      id: "timeline",
      label: "What's the timeline?",
      group: "buying",
      lines: [
        { kind: "say", text: `Most builds like yours take a few weeks from kickoff. If we locked it in this week, we could have you live sooner rather than later.` },
        { kind: "tip", text: `Use timeline to build gentle momentum toward a start date.` },
      ],
    },
    {
      id: "capable",
      label: "Can you do [X]?",
      group: "buying",
      lines: [
        { kind: "say", text: `Yes — that's right in our wheelhouse. Tell me a bit more about exactly what you're picturing so I get it spot on?` },
        { kind: "tip", text: `Confident yes, then qualify the detail. Every "can you" is a buying signal.` },
      ],
    },
    {
      id: "interested",
      label: "Sounds good / I'm in",
      group: "buying",
      lines: [
        { kind: "say", text: `Brilliant${firstName ? `, ${firstName}` : ""} — let's make it easy. I'll get the details over and we can pick a start date. Does early this week or next work to kick off?` },
        { kind: "tip", text: `They're warm — go straight to a concrete next step. Don't keep selling.` },
      ],
    },
  ];
}

function LineRow({ line }: { line: Line }) {
  if (line.kind === "tip") {
    return <p className="pl-3 text-xs italic text-faint">{line.text}</p>;
  }
  if (line.kind === "ask") {
    return (
      <p className="border-l-2 border-sky-500/40 pl-3 text-sm text-bone">
        <span className="mr-1.5 font-mono text-[10px] uppercase tracking-wider text-sky-400/80">ask</span>
        {line.text}
      </p>
    );
  }
  return (
    <p className="border-l-2 border-signal/50 pl-3 text-sm leading-relaxed text-bone">{line.text}</p>
  );
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="font-mono text-[10px] uppercase tracking-wider text-faint">{label}</span>
      <span className="text-right text-sm text-bone">{children}</span>
    </div>
  );
}

export function CallMode({
  open,
  onClose,
  subject,
  kind,
  deals,
  onLogged,
}: {
  open: boolean;
  onClose: () => void;
  subject: Row | null;
  kind: "company" | "contact";
  deals: Row[];
  onLogged?: () => void;
}) {
  const [outcome, setOutcome] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [followup, setFollowup] = useState("");
  const [saving, setSaving] = useState(false);
  const [activeSignal, setActiveSignal] = useState<string | null>(null);

  // Reset the log form + live prompt each time Call Mode opens on a fresh subject.
  useEffect(() => {
    if (open) {
      setOutcome(null);
      setNotes("");
      setFollowup("");
      setActiveSignal(null);
    }
  }, [open, subject]);

  // Everything below is derived, so the hooks must run every render — guard the
  // null subject with safe fallbacks rather than an early return.
  const isContact = kind === "contact";
  const name = subject ? (isContact ? fullName(subject) : (subject.name as string)) : "";
  const companyName = subject ? (isContact ? (subject.company_name as string) || "their company" : (subject.name as string)) : "";
  const phone = (subject?.phone as string) || "";
  const website = (subject?.website as string) || "";
  const tags = useMemo(() => parseTags(subject?.tags as string), [subject]);

  // Deals relevant to this subject drive the adaptive script.
  const relDeals = useMemo(() => {
    if (!subject) return [];
    return isContact
      ? deals.filter((d) => d.contact_id === subject.id || (subject.company_id && d.company_id === subject.company_id))
      : deals.filter((d) => d.company_id === subject.id);
  }, [subject, deals, isContact]);

  const openDeals = useMemo(() => relDeals.filter((d) => OPEN_STAGES.includes(d.stage as string)), [relDeals]);
  const hasWon = useMemo(() => relDeals.some((d) => d.stage === "Launched"), [relDeals]);
  const linkDeal = activeDeal(relDeals) ?? relDeals[0] ?? null;

  const script = useMemo(
    () =>
      subject
        ? buildScript({
            kind,
            companyName,
            firstName: isContact ? (subject.first_name as string) : null,
            industry: (subject.industry as string) || null,
            tags,
            source: (subject.source as string) || null,
            lastContacted: (subject.last_contacted as string) || null,
            deals: relDeals,
            hasWon,
          })
        : [],
    [subject, kind, companyName, isContact, tags, relDeals, hasWon],
  );

  const signals = useMemo(
    () => (subject ? buildSignals(isContact ? (subject.first_name as string) : null, companyName) : []),
    [subject, isContact, companyName],
  );
  const activeResp = activeSignal ? signals.find((s) => s.id === activeSignal) ?? null : null;

  function pickOutcome(o: { label: string; followup?: number }) {
    setOutcome(o.label);
    if (o.followup && !followup) {
      const d = new Date();
      d.setDate(d.getDate() + o.followup);
      setFollowup(d.toISOString().slice(0, 10));
    }
  }

  async function submit() {
    if (!outcome || !subject) return;
    setSaving(true);
    try {
      await logCall({
        data: {
          contact_id: isContact ? (subject.id as string) : null,
          deal_id: linkDeal ? (linkDeal.id as string) : null,
          subject_name: name,
          outcome,
          notes: notes.trim() || null,
          followup_date: followup || null,
        },
      });
      toast(followup ? "Call logged · follow-up set" : "Call logged");
      onLogged?.();
      onClose();
    } catch {
      toast("Couldn't log the call — try again", "error");
    } finally {
      setSaving(false);
    }
  }

  if (!open || !subject) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/75 p-4 backdrop-blur-md duration-200 animate-in fade-in-0 sm:p-8"
    >
      <div className="mt-2 w-full max-w-4xl rounded-2xl border border-line-strong bg-gradient-to-b from-surface to-[#0c110e] shadow-[0_24px_70px_-20px_rgba(0,0,0,0.85)] ring-1 ring-white/5 duration-200 animate-in fade-in-0 zoom-in-95 slide-in-from-top-2 sm:mt-6">
        {/* Header — who you're calling + a live pulsing indicator */}
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-signal/70" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-signal" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold tracking-tight text-bone">{name}</h3>
                {isContact && subject.title ? (
                  <span className="text-xs text-mute">{subject.title as string}</span>
                ) : null}
              </div>
              <div className="font-mono text-[10px] uppercase tracking-wider text-faint">
                Call mode{isContact && companyName ? ` · ${companyName}` : ""}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {phone ? (
              <a
                href={`tel:${phone.replace(/[^\d+]/g, "")}`}
                className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-b from-[#3ce0cd] to-signal-strong px-3 py-2 text-sm font-semibold text-ink shadow-[0_1px_2px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.3)] transition-all hover:shadow-[0_2px_14px_rgba(20,184,166,0.4)] active:translate-y-px"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
                </svg>
                {phone}
              </a>
            ) : (
              <span className="text-xs text-faint">No phone on file</span>
            )}
            <button
              onClick={onClose}
              className="rounded-md p-1 text-faint hover:bg-surface-2 hover:text-bone"
              aria-label="Close"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* During the call — tap what they say, get the line to say back */}
        <div className="border-b border-line px-5 py-3">
          <Eyebrow>During the call · tap what they say</Eyebrow>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {signals.map((s) => {
              const on = activeSignal === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => setActiveSignal(on ? null : s.id)}
                  className={cx(
                    "rounded-full px-3 py-1.5 text-xs font-medium transition-all",
                    on
                      ? "bg-signal-soft text-signal ring-1 ring-signal/40"
                      : s.group === "buying"
                        ? "border border-emerald-500/25 bg-emerald-500/5 text-emerald-300/90 hover:border-emerald-500/50 hover:text-emerald-200"
                        : "border border-line bg-surface text-mute hover:border-signal/30 hover:text-bone",
                  )}
                >
                  {s.label}
                </button>
              );
            })}
          </div>

          {activeResp ? (
            <div
              key={activeResp.id}
              className="mt-3 rounded-xl border border-signal/30 bg-gradient-to-b from-signal-soft/40 to-surface p-3 shadow-[0_8px_30px_-18px_rgba(20,184,166,0.6)] duration-200 animate-in fade-in-0 slide-in-from-top-1"
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-signal">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                  Say this now
                </span>
                <button onClick={() => setActiveSignal(null)} className="text-xs text-faint hover:text-bone">
                  Back to script
                </button>
              </div>
              <div className="space-y-1.5">
                {activeResp.lines.map((l, i) => (
                  <LineRow key={i} line={l} />
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div className="grid gap-0 md:grid-cols-[minmax(0,1fr)_260px]">
          {/* Left — the live script */}
          <div className="min-w-0 space-y-4 px-5 py-4">
            <Eyebrow>Live script · adapts to this account</Eyebrow>
            {script.map((sec, i) => (
              <div
                key={sec.heading}
                className="nx-rise space-y-1.5"
                style={{ animationDelay: `${i * 45}ms` }}
              >
                <div className="text-xs font-semibold text-signal">{sec.heading}</div>
                <div className="space-y-1.5">
                  {sec.lines.map((l, j) => (
                    <LineRow key={j} line={l} />
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Right — account facts + log the outcome */}
          <div className="border-t border-line px-5 py-4 md:border-l md:border-t-0">
            <Eyebrow className="mb-2">{isContact ? "Contact" : "Account"} info</Eyebrow>
            <div className="divide-y divide-line/60">
              {isContact && companyName ? <InfoRow label="Company">{companyName}</InfoRow> : null}
              {subject.industry ? <InfoRow label="Industry">{subject.industry as string}</InfoRow> : null}
              {subject.city ? <InfoRow label="City">{subject.city as string}</InfoRow> : null}
              {isContact && subject.email ? (
                <InfoRow label="Email">
                  <a href={`mailto:${subject.email as string}`} className="text-signal hover:underline">
                    {subject.email as string}
                  </a>
                </InfoRow>
              ) : null}
              {website ? (
                <InfoRow label="Website">
                  <a
                    href={normalizeUrl(website)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-signal hover:underline"
                  >
                    {website}
                  </a>
                </InfoRow>
              ) : null}
              {subject.owner_name ? <InfoRow label="Owner">{subject.owner_name as string}</InfoRow> : null}
              {isContact ? (
                <InfoRow label="Last contacted">
                  {subject.last_contacted ? relativeTime(subject.last_contacted as string) : <span className="text-faint">Never</span>}
                </InfoRow>
              ) : null}
            </div>

            {tags.length ? (
              <div className="mt-3 flex flex-wrap gap-1">
                {tags.map((t) => {
                  const color = tagColor(t);
                  return (
                    <span
                      key={t}
                      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
                      style={{ color, backgroundColor: color + "22", border: `1px solid ${color}55` }}
                    >
                      {t}
                    </span>
                  );
                })}
              </div>
            ) : null}

            {openDeals.length ? (
              <div className="mt-4">
                <Eyebrow className="mb-1.5">Open deals</Eyebrow>
                <div className="space-y-1.5">
                  {openDeals.map((d) => (
                    <div key={d.id as string} className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface-2/60 px-2.5 py-1.5">
                      <span className="min-w-0 truncate text-xs text-bone">{d.name as string}</span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        <span className="tnum text-xs text-mute">{formatMoney(Number(d.value) || 0)}</span>
                        <StageBadge stage={d.stage as string} />
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {subject.notes ? (
              <div className="mt-4">
                <Eyebrow className="mb-1.5">Notes</Eyebrow>
                <p className="whitespace-pre-wrap rounded-lg border border-line bg-surface-2/40 px-2.5 py-2 text-xs text-mute">
                  {subject.notes as string}
                </p>
              </div>
            ) : null}
          </div>
        </div>

        {/* Footer — log the call outcome + set the next follow-up */}
        <div className="border-t border-line bg-surface-2/40 px-5 py-4">
          <Eyebrow className="mb-2">After the call</Eyebrow>
          <div className="flex flex-wrap gap-1.5">
            {OUTCOMES.map((o) => {
              const on = outcome === o.label;
              return (
                <button
                  key={o.label}
                  onClick={() => pickOutcome(o)}
                  className={cx(
                    "rounded-full px-3 py-1.5 text-xs font-medium transition-all",
                    on
                      ? "bg-signal-soft text-signal ring-1 ring-signal/40"
                      : "border border-line bg-surface text-mute hover:border-signal/30 hover:text-bone",
                  )}
                >
                  {on ? "✓ " : ""}
                  {o.label}
                </button>
              );
            })}
          </div>

          {outcome ? (
            <div className="mt-3 space-y-3 duration-200 animate-in fade-in-0 slide-in-from-top-1">
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-mute">What was said / next step</span>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Jot the key points while they're fresh…"
                    className="min-h-16 w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-bone placeholder:text-faint outline-none shadow-[inset_0_1px_2px_rgba(0,0,0,0.25)] transition-all hover:border-line-strong focus:border-signal/70 focus:ring-2 focus:ring-signal/20"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-mute">Follow-up on</span>
                  <input
                    type="date"
                    value={followup}
                    onChange={(e) => setFollowup(e.target.value)}
                    className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-bone outline-none shadow-[inset_0_1px_2px_rgba(0,0,0,0.25)] transition-all hover:border-line-strong focus:border-signal/70 focus:ring-2 focus:ring-signal/20"
                  />
                  {followup ? (
                    <span className="mt-1 block text-[11px] text-faint">A task will be created for this date.</span>
                  ) : null}
                </label>
              </div>
              <div className="flex items-center justify-end gap-2">
                <Button variant="outline" onClick={onClose} disabled={saving}>
                  Cancel
                </Button>
                <Button onClick={submit} disabled={saving}>
                  {saving ? "Logging…" : "Log call"}
                </Button>
              </div>
            </div>
          ) : (
            <p className="mt-2 text-xs text-faint">Pick an outcome to log the call and set your next follow-up.</p>
          )}
        </div>
      </div>
    </div>
  );
}
