// Pure email templates + helpers shared by the Calls board and the Follow-ups
// queue. No server imports — safe on client and server. These power the "email
// them when they don't pick up" flow: a friendly, escalating set of nudges the
// rep sends from their own inbox via a pre-filled mailto draft (no account
// connection needed).

export type EmailDraft = { subject: string; body: string };

function firstName(repName: string): string {
  return (repName || "").split(" ")[0] || "the Nexraft team";
}

// The copy below is tuned for one thing: getting a REPLY from a busy owner
// reading on their phone. That means short (under ~90 words), one specific
// point, one easy question — and an out ("just say no thanks") that
// paradoxically makes people answer. No pitch walls, no "I'd love to connect".

// Nudge 1 — right after a missed call. Reference the call, make replying easy.
function nudge1(company: string, rep: string, repName: string): EmailDraft {
  return {
    subject: `tried calling — ${company}`,
    body: `Hi,

${rep} here — I tried calling about ${company}'s website but didn't catch you.

Short version: we build and run websites for local businesses — design, hosting, updates, all handled. Plans start at $299/month.

Worth a look? Reply "sure" and I'll send something over — or "no thanks" and I won't bug you again.

${repName || "The Nexraft team"}
Nexraft`,
  };
}

// Nudge 2 — a few days later. A concrete reason, a yes/no question.
function nudge2(company: string, rep: string, repName: string): EmailDraft {
  return {
    subject: `quick question about ${company}`,
    body: `Hi,

${rep} again. Quick question and then I'll get out of your inbox:

When someone in town searches for what ${company} does, are you happy with what they find? Most owners we talk to aren't — and it's usually costing them a few customers a month without them ever knowing.

That's the whole thing we fix, done for you, from $299/month. Want me to send over what your site could look like?

${repName || "The Nexraft team"}
Nexraft`,
  };
}

// Nudge 3 — the breakup email. Consistently the most-replied-to email in any
// cold sequence: closing the file makes people who were on the fence speak up.
function nudge3(company: string, rep: string, repName: string): EmailDraft {
  return {
    subject: `closing your file — ${company}`,
    body: `Hi,

${rep} from Nexraft — I've reached out a couple of times about ${company}'s website and haven't heard back, so I'm going to close your file and stop emailing.

Before I do: if the timing was just bad, one word back ("later") and I'll check in down the road. If you're all set, no reply needed at all.

Either way, good luck out there — and if a website ever becomes the thing, you know where I am.

${repName || "The Nexraft team"}
Nexraft`,
  };
}

export const NUDGE_LABELS = ["1st nudge", "2nd nudge", "Final nudge"];

// Build the right draft for a given touch. `touch` is 1-based (the nudge being
// sent now). Anything past 3 reuses the final nudge.
export function followUpEmail(companyName: string, repName: string, touch: number): EmailDraft {
  const company = companyName || "your business";
  const rep = firstName(repName);
  const t = Math.max(1, Math.min(3, touch));
  if (t === 1) return nudge1(company, rep, repName);
  if (t === 2) return nudge2(company, rep, repName);
  return nudge3(company, rep, repName);
}

// Back-compat alias for the original single-template helper.
export function missedCallEmail(companyName: string, repName: string): EmailDraft {
  return followUpEmail(companyName, repName, 1);
}

// ---- Email tab templates ----------------------------------------------------
// One-click starting points for the compose page. Each template auto-fills the
// company name, the contact's first name (when we have one), and the rep's
// name — the rep just tweaks and hits send.

export type TemplateInput = { company: string; firstName?: string | null; repName: string };
export type EmailTemplate = { id: string; label: string; hint: string; build: (t: TemplateInput) => EmailDraft };

function greet(firstName?: string | null): string {
  return `Hi ${(firstName || "").trim() || "there"},`;
}

// The rep's first name for sign-offs (alias because the templates destructure a
// `firstName` param for the CONTACT's name, which would shadow the helper).
const repFirst = firstName;

export const EMAIL_TEMPLATES: EmailTemplate[] = [
  {
    id: "intro",
    label: "Intro",
    hint: "First time reaching out",
    build: ({ company, firstName, repName }) => ({
      subject: `question about ${company}`,
      body: `${greet(firstName)}

${repFirst(repName)} here, from Nexraft. We build and run websites for local businesses — everything handled, live in about two weeks, plans from $299/month.

I think ${company} is exactly the kind of business it works for, but you'd know better than me.

Worth a look? Reply "sure" and I'll send over what it'd look like — or "no thanks" and that's the last you'll hear from me.

${repName || "The Nexraft team"}
Nexraft`,
    }),
  },
  {
    id: "followup",
    label: "Follow-up",
    hint: "Nudge someone who went quiet",
    build: ({ company, firstName, repName }) => ({
      subject: `re: ${company}'s website`,
      body: `${greet(firstName)}

${repFirst(repName)} again — my earlier note about a website for ${company} probably got buried, so bumping it once.

The offer's simple: we handle everything — design, hosting, updates — with plans from $299/month.

Yes, no, or "ask me in the fall" — any one-word reply works and I'll take it from there.

${repName || "The Nexraft team"}
Nexraft`,
    }),
  },
  {
    id: "quote",
    label: "Quote heads-up",
    hint: "Tell them a proposal is coming",
    build: ({ company, firstName, repName }) => ({
      subject: `Your website proposal for ${company}`,
      body: `${greet(firstName)}

Great talking with you! As promised, I'm putting together a proposal for ${company}'s new website — you'll have it shortly with pricing and a timeline laid out clearly.

If any questions pop up in the meantime, just reply here and I'll get right back to you.

Talk soon,
${repName || "The Nexraft team"}
Nexraft`,
    }),
  },
  {
    id: "proposal_chase",
    label: "Proposal chase",
    hint: "Proposal out 3+ days, no reply",
    build: ({ company, firstName, repName }) => ({
      subject: `Any questions on the proposal, ${company}?`,
      body: `${greet(firstName)}

${repFirst(repName)} from Nexraft — I wanted to check in on the proposal I sent over for ${company}'s new website. No rush at all, I just don't want it sitting in limbo if you had questions.

Most people have one or two things they'd like adjusted — pages, timing, budget — and that's exactly the conversation I'd love to have. If something's not sitting right, tell me straight and I'll rework it.

Would a quick 10-minute call this week help? Just reply with a time. And if you're ready to go, even easier — say the word and I'll get your kickoff scheduled.

Best,
${repName || "The Nexraft team"}
Nexraft`,
    }),
  },
  {
    id: "launched",
    label: "Site is live",
    hint: "Celebrate a launch with the client",
    build: ({ company, firstName, repName }) => ({
      subject: `${company}'s new website is LIVE 🎉`,
      body: `${greet(firstName)}

Big day — ${company}'s new website is officially live! Go take a look and click around; we think you're going to love it.

If you spot anything you'd like tweaked, just reply here and we'll jump on it. Otherwise, congratulations — and thank you for trusting us with your business.

Cheers,
${repName || "The Nexraft team"}
Nexraft`,
    }),
  },
  {
    id: "blank",
    label: "Blank",
    hint: "Start from scratch",
    build: ({ firstName, repName }) => ({
      subject: "",
      body: `${greet(firstName)}



Best,
${repName || "The Nexraft team"}
Nexraft`,
    }),
  },
];

// ---- AI-tailored drafts ------------------------------------------------------
// The nightly research run has Grok write a bespoke outreach email for each
// business (stored in the company's research JSON under `.ai`). When one
// exists, it beats any canned template — it talks about THEIR site, THEIR
// reviews, THEIR town. This helper digs it out and personalizes the sign-off.
// Client-safe: pure JSON parsing, no server imports.

export function aiDraftFromResearch(research: unknown, repName: string): EmailDraft | null {
  try {
    const parsed = typeof research === "string" ? JSON.parse(research) : research;
    const ai = (parsed as { ai?: { email_subject?: unknown; email_body?: unknown } } | null)?.ai;
    const subject = typeof ai?.email_subject === "string" ? ai.email_subject.trim() : "";
    const body = typeof ai?.email_body === "string" ? ai.email_body.trim() : "";
    if (!subject || !body) return null;
    // Drafts generated before 2026-07-21 quote the wrong price ("$100/month" —
    // real plans start at $299/month, per nexraft.com). Refuse to pre-fill
    // those; the corrected canned templates take over until the nightly
    // research run regenerates the draft with the right pricing.
    if (body.includes("$100")) return null;
    const rep = (repName || "").trim() || "The Nexraft team";
    return { subject, body: body.replaceAll("{{REP_NAME}}", rep) };
  } catch {
    return null;
  }
}

// A mailto: link that opens the rep's own email app with everything pre-filled.
export function mailtoLink(to: string, subject: string, body: string): string {
  const params = `subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  return `mailto:${encodeURIComponent(to)}?${params}`;
}
