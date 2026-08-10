import { useEffect, useMemo, useState } from "react";
import { useRouteContext } from "@tanstack/react-router";

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
  callOpener,
  leadNeed,
  type LeadNeed,
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

// Seconds → m:ss for the live call timer.
function fmtClock(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
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

// Industry-specific angles so the pitch lands in the customer's world, not
// ours. Keyword-matched against the company's industry; generic fallback if
// nothing hits. `pitch` is the cold-call hook, `ask` a discovery question that
// shows we get their business.
type IndustryAngle = { match: RegExp; pitch: string; ask: string };
const INDUSTRY_ANGLES: IndustryAngle[] = [
  {
    match: /plumb|hvac|heating|air condition|electric/i,
    pitch: `When a pipe bursts or the AC dies, people grab their phone and call whoever shows up first — we build sites that put you at the top of that search with a tap-to-call button front and center.`,
    ask: `When someone has an emergency, how do they usually find you right now — Google, word of mouth, or something else?`,
  },
  {
    match: /roof|construction|contractor|builder|renovat|remodel/i,
    pitch: `For jobs this size, homeowners compare two or three companies online before ever calling — a sharp photo gallery of your best work is usually what tips the decision.`,
    ask: `Do you have photos of recent jobs you're proud of? That's the heart of a site like this.`,
  },
  {
    match: /landscap|lawn|garden|tree|pool|fenc|paving/i,
    pitch: `Your work is visual — before-and-after photos sell it better than any ad. We build sites that show that off and turn lookers into quote requests.`,
    ask: `What season brings you the most business — and do you get enough leads lined up before it starts?`,
  },
  {
    match: /restaurant|cafe|coffee|bakery|pizza|food|catering|bar\b/i,
    pitch: `Most people check the menu on their phone before choosing where to eat — if it's a blurry PDF or out of date, they pick somewhere else. We fix exactly that.`,
    ask: `Where do your customers see your menu right now, and how easy is it for you to update it?`,
  },
  {
    match: /dent|chiro|clinic|medical|therap|veterinar|optom/i,
    pitch: `New patients pick a practice from a Google search and book with whoever makes it easiest — we build sites that look trustworthy and let people request an appointment in two taps.`,
    ask: `How do new patients book with you today — do they have to call during office hours?`,
  },
  {
    match: /salon|barber|spa|beauty|nail|tattoo/i,
    pitch: `People book where booking is easy. A clean site with your work, prices, and an easy way to book keeps your chair full without you answering DMs all day.`,
    ask: `How do most clients book right now — calls, Instagram DMs, walk-ins?`,
  },
  {
    match: /gym|fitness|yoga|martial|dance|coach/i,
    pitch: `Someone deciding to get in shape checks you out online first — class times, prices, what it feels like inside. A great site gets them through the door for that first visit.`,
    ask: `What's the biggest thing that stops people from showing up for a first session?`,
  },
  {
    match: /auto|mechanic|tire|towing|car wash|detail/i,
    pitch: `When a car breaks down, people search, skim, and call — we make sure that first impression says "trustworthy" and the phone number is impossible to miss.`,
    ask: `How much of your work comes from repeat customers versus new people finding you?`,
  },
  {
    match: /clean|maid|janitor|pest|mov(?:ing|er)/i,
    pitch: `Your customers are comparing quotes from their couch — a professional site with clear services and an instant quote form usually wins that race.`,
    ask: `How do people ask you for quotes today, and how fast can you usually get back to them?`,
  },
  {
    match: /real estate|realt|property|mortgage/i,
    pitch: `In your world, your brand is the product — a polished personal site is what makes a seller pick you over the agent with the bus-bench ad.`,
    ask: `Where do most of your listings and leads come from right now?`,
  },
  {
    match: /law|attorney|legal|account|tax|insur|financ/i,
    pitch: `Clients in your field hire on trust — a dated website quietly costs you cases to competitors who look more established online.`,
    ask: `When a potential client looks you up before calling, what do you want them to come away thinking?`,
  },
];

function industryAngle(industry: string | null): IndustryAngle | null {
  if (!industry) return null;
  return INDUSTRY_ANGLES.find((a) => a.match.test(industry)) ?? null;
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
  // Saved research dossier (companies.research) — turns the generic script
  // into one that name-drops the owner and pitches their actual site gaps.
  intel: { summary: string | null; established: number | null; people: string[]; angles: string[] } | null;
  // Why we're calling THIS business (leadNeed) + where they are, so the opener
  // can be about them instead of about us.
  need?: LeadNeed | null;
  repFirst?: string | null;
  city?: string | null;
}): Section[] {
  const { kind, companyName, firstName, industry, tags, source, deals, hasWon, intel } = opts;
  const deal = activeDeal(deals);
  const stage = deal ? (deal.stage as string) : null;
  const dn = deal ? dealLabel(deal) : null;
  const atRisk = tags.includes("At risk");
  const isReferral = tags.includes("Referral") || source === "Referral";
  const isUpsell = tags.includes("Upsell") || tags.includes("Retainer");
  const isFacebookOnly = tags.includes("facebook-only");

  const sections: Section[] = [];

  // --- Opening -------------------------------------------------------------
  // A cold call lives or dies in the first seven seconds. Warm accounts (an
  // open deal, a won client, a referral) get the friendly opener they've
  // earned; a stranger gets name + permission + one true fact about their own
  // business, because "I'm calling from Nexraft about your website" is exactly
  // the sentence people hang up on.
  const opening: Line[] = [];
  const isWarmAccount = Boolean(stage && stage !== "To Call") || hasWon || isReferral;
  if (isWarmAccount) {
    if (kind === "contact" && firstName) {
      opening.push({ kind: "say", text: `Hi ${firstName}, I'm calling from Nexraft — do you have a couple of minutes?` });
    } else {
      opening.push({ kind: "say", text: `Hi, I'm calling from Nexraft — is this the right person to talk to about ${companyName}'s website?` });
    }
    if (isReferral) {
      opening.push({ kind: "say", text: `You came recommended to us, so I wanted to reach out personally.` });
    }
    opening.push({ kind: "tip", text: `Smile, keep it relaxed, and let them talk more than you do.` });
  } else {
    const o = callOpener({
      company: companyName,
      repFirst: opts.repFirst,
      need: opts.need,
      industry,
      city: opts.city,
    });
    opening.push({ kind: "say", text: kind === "contact" && firstName ? o.hook.replace(/^Hi — is that [^?]+\?/, `Hi ${firstName} —`) : o.hook });
    opening.push({ kind: "say", text: o.fact });
    opening.push({ kind: "ask", text: o.ask });
    opening.push({ kind: "tip", text: `Then stop talking. The silence after the question is what makes them answer instead of brushing you off.` });
    if (!opts.need?.worthCalling) {
      opening.push({
        kind: "tip",
        text: `Heads up: we haven't found anything wrong with their setup, so you're opening cold. Research them first if you can — a specific fact is worth ten dials.`,
      });
    }
  }
  sections.push({ heading: "First seven seconds", lines: opening });

  // --- Why you're calling --------------------------------------------------
  const why: Line[] = [];
  if (stage === "Proposal") {
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
  } else if (isFacebookOnly) {
    // The easiest cold pitch on the board: they already market themselves on
    // socials — they just have nowhere to send the people that marketing wins.
    why.push({ kind: "say", text: `I found ${companyName} on Facebook — your page looks great, but when people Google you there's no website behind it. About half of your potential customers check Google first, and right now they find nothing.` });
    why.push({ kind: "say", text: `You're clearly already putting effort into being online — a site just captures the customers your posts are already creating.` });
    why.push({ kind: "tip", text: `Facebook-only lead: they believe in marketing, so don't sell the idea of being online — sell catching what they're missing. Their profile link is in the notes.` });
  } else {
    const angle = industryAngle(industry);
    if (angle) {
      why.push({ kind: "say", text: `I came across ${companyName} and wanted to reach out — ${angle.pitch}` });
    } else {
      why.push({ kind: "say", text: `I came across ${companyName} and thought a sharper website could really help you stand out${industry ? ` in ${industry.toLowerCase()}` : ""}.` });
    }
    why.push({ kind: "tip", text: `Cold-ish — earn 30 seconds of curiosity before going further.` });
  }
  sections.push({ heading: "Why you're calling", lines: why });

  // --- Intel from research -------------------------------------------------
  // Only shown when a dossier exists; specifics beat generic pitching.
  if (intel && (intel.people.length > 0 || intel.angles.length > 0 || intel.established || intel.summary)) {
    const know: Line[] = [];
    if (intel.people.length > 0) {
      know.push({ kind: "tip", text: `Ask for ${intel.people[0]} by name — their site says they run the place.` });
    }
    if (intel.established) {
      know.push({ kind: "say", text: `I saw you've been at it since ${intel.established} — clearly doing something right.` });
    }
    for (const a of intel.angles.slice(0, 3)) {
      know.push({ kind: "tip", text: `Pitch angle: ${a}` });
    }
    sections.push({ heading: "Intel from research", lines: know });
  }

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
    const angle = industryAngle(industry);
    if (angle) ask.push({ kind: "ask", text: angle.ask });
    ask.push({ kind: "ask", text: `What's prompting you to look at your website right now?` });
    ask.push({ kind: "ask", text: `What would a great outcome look like for you?` });
    ask.push({ kind: "ask", text: `Do you have a rough timeline or budget in mind?` });
  }
  sections.push({ heading: "Ask about them", lines: ask });

  // --- Closer mode (only when money is on the table) -----------------------
  // Proposal/Negotiation calls are a different sport: the pitch is done, the
  // number is out there, and the only job is getting to a yes. This section
  // reads the deal itself — value, whether they've opened the proposal — and
  // arms the rep with price justification and a concrete close.
  if (stage === "Proposal" || stage === "Negotiation") {
    const closer: Line[] = [];
    const viewed = deal ? String(deal.proposal_status ?? "") === "viewed" || Boolean(deal.proposal_viewed_at) : false;
    const sentNotViewed = deal ? String(deal.proposal_status ?? "") === "sent" && !viewed : false;
    if (viewed) {
      closer.push({ kind: "tip", text: `🔥 They HAVE opened the proposal${deal?.proposal_viewed_at ? ` (${relativeTime(String(deal.proposal_viewed_at))})` : ""} — don't re-pitch. Ask what stood out.` });
      closer.push({ kind: "ask", text: `I saw you had a chance to look things over — what stood out to you?` });
    } else if (sentNotViewed) {
      closer.push({ kind: "tip", text: `They haven't opened the proposal yet — walk them through it live on this call instead of waiting.` });
    }
    const value = deal ? Number(deal.value) || 0 : 0;
    if (value > 0) {
      const perDay = Math.max(1, Math.round(value / 365));
      closer.push({ kind: "say", text: `The ${formatMoney(value)} build works out to about ${formatMoney(perDay)} a day over the first year — one extra customer a month covers it.` });
    } else {
      closer.push({ kind: "say", text: `Most clients land between ${formatMoney(1500)} and ${formatMoney(4000)} for the build — one or two extra jobs a month covers it.` });
    }
    closer.push({ kind: "tip", text: `On price: never discount first. Trade instead — "I can't move the price, but I can add a page / start sooner."` });
    closer.push({ kind: "tip", text: `Silence is your friend. Ask for the business, then stop talking.` });
    sections.push({ heading: "Closer mode", lines: closer });

    sections.push({
      heading: "If they hesitate",
      lines: [
        { kind: "tip", text: `On price: steer to value — the site pays for itself in leads, not the sticker.` },
        { kind: "tip", text: `On timing: offer to lock the slot now and start when they're ready.` },
        { kind: "tip", text: `On trust: point to the portfolio and offer a reference from a similar client.` },
        { kind: "tip", text: `Before hanging up: get a yes, a no, or a date. "Maybe" with no date is a slow no.` },
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

function buildSignals(firstName: string | null, companyName: string, need?: LeadNeed | null): Signal[] {
  const who = companyName || "your business";
  // The single true fact we hold about them. Every brush-off answer leans on it
  // — a rep who can name something real earns the next ten seconds; one who
  // repeats "we build websites" earns a dial tone.
  const fact = need?.worthCalling ? need.line : null;
  return [
    // The most common no on the board: they brush you off before you've
    // finished your first sentence. Don't fight it — agree, spend the fact,
    // and hand them an easy exit. Half of them stay on the line.
    {
      id: "brushoff",
      label: "Not interested (instantly)",
      group: "objection",
      lines: [
        { kind: "say", text: `That's fair — you don't know me yet. One sentence and I'm gone.` },
        {
          kind: "say",
          text: fact ?? `When someone searches for what you do around here, you're not what comes up first — that's the only reason I called.`,
        },
        { kind: "ask", text: `If that's not worth two minutes, tell me and I'll leave you alone.` },
        { kind: "tip", text: `They said no to the interruption, not to you. Agreeing with them breaks the script they expected — then say your fact and shut up.` },
      ],
    },
    {
      id: "gatekeeper",
      label: "Not the owner / \u201cshe's not in\u201d",
      group: "objection",
      lines: [
        { kind: "ask", text: `No problem — who's the best person? And what's the name, so I'm not calling asking for \u201cthe owner\u201d?` },
        { kind: "ask", text: `When's she usually about — mornings or afternoons?` },
        { kind: "tip", text: `Never pitch the gatekeeper. Get a name and a time, thank them, ring off. Log the name in the notes so the next call opens with it.` },
      ],
    },
    {
      id: "already",
      label: "We already have a website",
      group: "objection",
      lines: [
        {
          kind: "say",
          text: fact
            ? `I know — I looked at it before I called. ${fact}`
            : `I know, I had a look before I rang. I'm not calling about having one, I'm calling about whether it brings you any work.`,
        },
        { kind: "ask", text: `When was the last time somebody rang you and said \u201cI found you online\u201d?` },
        { kind: "tip", text: `Having a site and getting customers from it are two different things. Take the conversation to the second one.` },
      ],
    },
    {
      id: "howgot",
      label: "How did you get my number?",
      group: "objection",
      lines: [
        { kind: "say", text: `It's on your public listing — same place your customers find it. Nothing clever, I promise.` },
        { kind: "tip", text: `Answer straight and lightly, then go back to your fact. Any hedging here and you're done.` },
      ],
    },
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
      label: "Who is this?",
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

function LineRow({ line, covered, onToggle }: { line: Line; covered?: boolean; onToggle?: () => void }) {
  if (line.kind === "tip") {
    return <p className="pl-3 text-xs italic text-faint">{line.text}</p>;
  }

  const isAsk = line.kind === "ask";
  const border = isAsk ? "border-sky-500/40" : "border-signal/50";

  // Tap a say/ask line to tick it off as you say it — a quiet progress cue.
  if (onToggle) {
    return (
      <button
        onClick={onToggle}
        className={cx(
          "group flex w-full items-start gap-2 border-l-2 pl-3 text-left text-sm leading-relaxed transition-colors",
          border,
          covered ? "text-faint line-through decoration-faint/50" : "text-bone hover:text-signal",
        )}
      >
        <span
          className={cx(
            "mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px] border transition-colors",
            covered ? "border-signal/60 bg-signal/20 text-signal" : "border-line-strong text-transparent group-hover:border-signal/40",
          )}
        >
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </span>
        <span className="min-w-0">
          {isAsk ? <span className="mr-1.5 font-mono text-[10px] uppercase tracking-wider text-sky-600/80">ask</span> : null}
          {line.text}
        </span>
      </button>
    );
  }

  if (isAsk) {
    return (
      <p className="border-l-2 border-sky-500/40 pl-3 text-sm text-bone">
        <span className="mr-1.5 font-mono text-[10px] uppercase tracking-wider text-sky-600/80">ask</span>
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
  const [elapsed, setElapsed] = useState(0);
  const [covered, setCovered] = useState<Set<string>>(new Set());

  // Reset the log form + live prompt each time Call Mode opens on a fresh subject.
  useEffect(() => {
    if (open) {
      setOutcome(null);
      setNotes("");
      setFollowup("");
      setActiveSignal(null);
      setElapsed(0);
      setCovered(new Set());
    }
  }, [open, subject]);

  // A gentle call timer so the rep can feel the call's length at a glance.
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [open, subject]);

  // Escape closes Call Mode from anywhere in the overlay.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  function toggleCovered(key: string) {
    setCovered((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

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

  // Research dossier travels on the company row (companies.research JSON).
  const intel = useMemo(() => {
    const raw = !isContact ? (subject?.research as string) : null;
    if (!raw) return null;
    try {
      const d = JSON.parse(raw) as {
        summary?: string | null;
        established?: number | null;
        people?: string[];
        angles?: string[];
        emails?: string[];
        ai?: { email_subject?: string | null; email_body?: string | null } | null;
      };
      return {
        summary: d.summary ?? null,
        established: d.established ?? null,
        people: Array.isArray(d.people) ? d.people : [],
        angles: Array.isArray(d.angles) ? d.angles : [],
        emails: Array.isArray(d.emails) ? d.emails : [],
        ai: d.ai ?? null,
      };
    } catch {
      return null;
    }
  }, [subject, isContact]);

  // The one true fact this call opens with. Contacts inherit their company's
  // signal where we have it; otherwise leadNeed falls back to "unknown" and the
  // script warns the rep they're going in cold.
  const need = useMemo(
    () =>
      subject && !isContact
        ? leadNeed({
            website: subject.website as string | null,
            research: subject.research as string | null,
            tags: (subject.tags as string) || null,
            siteDownAt: subject.site_down_at as string | null,
            createdAt: subject.created_at as string | null,
          })
        : null,
    [subject, isContact],
  );

  // "Finish the call in one place": after a missed call, offer a one-tap email
  // draft so the rep doesn't have to hop over to Outreach. Uses the contact's
  // email (or the first researched company email) and prefers the AI-drafted
  // email when a dossier has one.
  const { user } = useRouteContext({ from: "/_app" }) as { user?: { name?: string } };
  const missEmail = useMemo(() => {
    const to = isContact ? ((subject?.email as string) || null) : (intel?.emails[0] ?? null);
    if (!to) return null;
    const rep = user?.name ?? "";
    const aiSubject = intel?.ai?.email_subject?.trim();
    const aiBody = intel?.ai?.email_body?.replace(/\{\{REP_NAME\}\}/g, rep).trim();
    const fallbackSubject = `Sorry I missed you${companyName ? ` — quick idea for ${companyName}` : ""}`;
    const fallbackBody = [
      "Hi,",
      "",
      `Just tried giving you a call${companyName ? ` about ${companyName}'s website` : ""} — sorry I missed you. We build websites for local businesses, and I had a couple of quick ideas I think you'd like.`,
      "",
      "Is there a good time this week for a 5-minute chat?",
      "",
      rep ? `Thanks,\n${rep}` : "Thanks!",
    ].join("\n");
    return {
      to,
      href: `mailto:${to}?subject=${encodeURIComponent(aiSubject || fallbackSubject)}&body=${encodeURIComponent(aiBody || fallbackBody)}`,
      ai: Boolean(aiSubject || aiBody),
    };
  }, [isContact, subject, intel, companyName, user]);

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
            intel,
            need,
            repFirst: (user?.name ?? "").trim().split(/\s+/)[0] || null,
            city: (subject.city as string) || null,
          })
        : [],
    [subject, kind, companyName, isContact, tags, relDeals, hasWon, intel, need, user],
  );

  const signals = useMemo(
    () => (subject ? buildSignals(isContact ? (subject.first_name as string) : null, companyName, need) : []),
    [subject, isContact, companyName, need],
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
      const res = await logCall({
        data: {
          contact_id: isContact ? (subject.id as string) : null,
          deal_id: linkDeal ? (linkDeal.id as string) : null,
          subject_name: name,
          outcome,
          notes: notes.trim() || null,
          followup_date: followup || null,
        },
      });
      toast(
        res?.movedToLost
          ? "Call logged · moved to No"
          : followup
            ? "Call logged · follow-up set"
            : "Call logged",
      );
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
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 backdrop-blur-md duration-200 animate-in fade-in-0 sm:p-8"
    >
      <div className="mt-2 w-full max-w-4xl rounded-2xl border border-line-strong bg-surface shadow-[0_24px_70px_-20px_rgba(0,0,0,0.18)] ring-1 ring-black/5 duration-200 animate-in fade-in-0 zoom-in-95 slide-in-from-top-2 sm:mt-6">
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
              <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-faint">
                <span>Call mode{isContact && companyName ? ` · ${companyName}` : ""}</span>
                <span className="text-line-strong">·</span>
                <span className="tnum text-signal/80">{fmtClock(elapsed)}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {phone ? (
              <a
                href={`tel:${phone.replace(/[^\d+]/g, "")}`}
                className="inline-flex items-center gap-1.5 rounded-lg bg-signal hover:bg-signal-strong px-3 py-2 text-sm font-semibold text-ink transition-all active:translate-y-px"
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
          {(["objection", "buying"] as const).map((grp) => {
            const chips = signals.filter((s) => s.group === grp);
            if (chips.length === 0) return null;
            return (
              <div key={grp} className="mt-2">
                <div className="mb-1 font-mono text-[9px] uppercase tracking-wider text-faint">
                  {grp === "objection" ? "If they push back" : "Buying signals"}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {chips.map((s) => {
                    const on = activeSignal === s.id;
                    return (
                      <button
                        key={s.id}
                        onClick={() => setActiveSignal(on ? null : s.id)}
                        className={cx(
                          "rounded-full px-3 py-1.5 text-xs font-medium transition-all",
                          on
                            ? "bg-signal-soft text-signal ring-1 ring-signal/40"
                            : grp === "buying"
                              ? "border border-emerald-500/25 bg-emerald-500/5 text-emerald-700/90 hover:border-emerald-500/50 hover:text-emerald-800"
                              : "border border-line bg-surface text-mute hover:border-signal/30 hover:text-bone",
                        )}
                      >
                        {s.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {activeResp ? (
            <div
              key={activeResp.id}
              className="mt-3 rounded-xl border border-signal/30 bg-gradient-to-b from-signal-soft/40 to-surface p-3 shadow-[0_8px_30px_-18px_rgba(24,24,27,0.3)] duration-200 animate-in fade-in-0 slide-in-from-top-1"
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
            <div className="flex items-center justify-between gap-2">
              <Eyebrow>Live script · tap a line as you say it</Eyebrow>
              {covered.size > 0 ? (
                <button onClick={() => setCovered(new Set())} className="text-[10px] text-faint hover:text-bone">
                  {covered.size} covered · reset
                </button>
              ) : null}
            </div>
            {script.map((sec, i) => (
              <div
                key={sec.heading}
                className="nx-rise space-y-1.5"
                style={{ animationDelay: `${i * 45}ms` }}
              >
                <div className="text-xs font-semibold text-signal">{sec.heading}</div>
                <div className="space-y-1.5">
                  {sec.lines.map((l, j) => {
                    const key = `${i}-${j}`;
                    return l.kind === "tip" ? (
                      <LineRow key={j} line={l} />
                    ) : (
                      <LineRow key={j} line={l} covered={covered.has(key)} onToggle={() => toggleCovered(key)} />
                    );
                  })}
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
              {/not interested/i.test(outcome) && linkDeal && OPEN_STAGES.includes(linkDeal.stage as string) ? (
                <div className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-800/90">
                  <svg className="mt-0.5 shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                  <span>Logging this will move <span className="font-medium text-rose-100">{dealLabel(linkDeal)}</span> to <span className="font-medium text-rose-100">No</span> in the pipeline — no dragging needed.</span>
                </div>
              ) : null}
              {/voicemail|no answer|call back/i.test(outcome) && missEmail ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-signal/30 bg-signal-soft/40 px-3 py-2">
                  <span className="text-xs text-mute">
                    Didn&apos;t reach them? Send the follow-up email while it&apos;s fresh
                    {missEmail.ai ? " — the AI draft is already filled in" : ""}.
                  </span>
                  <a
                    href={missEmail.href}
                    className="inline-flex items-center gap-1 rounded-full border border-signal/40 bg-signal-soft px-3 py-1 text-xs font-medium text-signal transition-colors hover:border-signal"
                    title={`Opens a ready-to-send email to ${missEmail.to}`}
                  >
                    ✉ Email them now
                  </a>
                </div>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-mute">What was said / next step</span>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Jot the key points while they're fresh…"
                    className="min-h-16 w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-bone placeholder:text-faint outline-none shadow-[inset_0_1px_2px_rgba(0,0,0,0.08)] transition-all hover:border-line-strong focus:border-signal/70 focus:ring-2 focus:ring-signal/20"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-mute">Follow-up on</span>
                  <input
                    type="date"
                    value={followup}
                    onChange={(e) => setFollowup(e.target.value)}
                    className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-bone outline-none shadow-[inset_0_1px_2px_rgba(0,0,0,0.08)] transition-all hover:border-line-strong focus:border-signal/70 focus:ring-2 focus:ring-signal/20"
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
