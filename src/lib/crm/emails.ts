// Pure email templates + helpers shared by the Calls board and the Follow-ups
// queue. No server imports — safe on client and server. These power the "email
// them when they don't pick up" flow: a friendly, escalating set of nudges the
// rep sends from their own inbox via a pre-filled mailto draft (no account
// connection needed).

export type EmailDraft = { subject: string; body: string };

function firstName(repName: string): string {
  return (repName || "").split(" ")[0] || "the Nexraft team";
}

// "Mills Plumbing & Drain Cleaning LLC" reads like a mail merge; "Mills
// Plumbing & Drain Cleaning" reads like a person typed it. Strip trailing
// legal suffixes (repeatedly — "Co., Inc." has two) for use in subjects and
// bodies. Display pages keep the full legal name; this is outreach-only.
const LEGAL_SUFFIX_RE =
  /[,\s]+(llc|l\.l\.c\.?|inc\.?|incorporated|corp\.?|corporation|co\.?|company|pllc|p\.?a\.?|llp|lp|ltd\.?|limited)\s*$/i;
export function friendlyCompanyName(name: string): string {
  let n = (name || "").trim();
  for (let i = 0; i < 3; i++) {
    const next = n.replace(LEGAL_SUFFIX_RE, "").replace(/[,.\s]+$/, "").trim();
    if (next === n || next === "") break;
    n = next;
  }
  return n || (name || "").trim();
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
    subject: `${company} on google`,
    body: `Hi,

${rep} again. One thing, then I'll get out of your inbox:

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
  const company = friendlyCompanyName(companyName) || "your business";
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
  const n = (firstName || "").trim();
  // Placeholder contacts aren't people. The seeded office inboxes carry names
  // like "Office /" or "Main" — greeting those by "name" produced the
  // infamous "Hi Office /," Barry caught on 2026-07-21. When we don't have a
  // real human's first name, "Hi there," beats a robot giveaway every time.
  if (!n || n.includes("/") || /^(office|main|info|admin|sales|contact|team|front)\b/i.test(n)) {
    return "Hi there,";
  }
  return `Hi ${n},`;
}

// The rep's first name for sign-offs (alias because the templates destructure a
// `firstName` param for the CONTACT's name, which would shadow the helper).
const repFirst = firstName;

const RAW_TEMPLATES: EmailTemplate[] = [
  {
    id: "intro",
    label: "Intro",
    hint: "First time reaching out",
    build: ({ company, firstName, repName }) => ({
      subject: `${company}'s website`,
      body: `${greet(firstName)}

${repFirst(repName)} here, from Nexraft — we build and run websites for local businesses. Design, hosting, updates, all handled, live in about two weeks, plans from $299/month.

No site, or one that isn't bringing in work? That's exactly who we're for.

Want to see what ${company}'s could look like? Reply "sure" and I'll put something together — or "no thanks" and that's the last you'll hear from me.

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

// Every template gets the friendly company name ("Z Plumber", not
// "Z Plumber, Inc.") without each build function having to remember to strip
// it — one wrapper here covers subjects and bodies alike.
export const EMAIL_TEMPLATES: EmailTemplate[] = RAW_TEMPLATES.map((t) => ({
  ...t,
  build: (input) => t.build({ ...input, company: friendlyCompanyName(input.company) || input.company }),
}));

// ---- AI-tailored drafts ------------------------------------------------------
// The nightly research run has Grok write a bespoke outreach email for each
// business (stored in the company's research JSON under `.ai`). When one
// exists, it beats any canned template — it talks about THEIR site, THEIR
// reviews, THEIR town. This helper digs it out and personalizes the sign-off.
// Client-safe: pure JSON parsing, no server imports.

// The quality bar every AI-tailored draft must clear before a rep ever sees
// it — used at generation time (the AI gets one retry, then we refuse to
// store a bad draft) AND at display time (a stored draft that fails falls
// back to the canned templates). Returns the reason it failed, or null if
// the draft is good. Pure and client-safe on purpose so it's unit-testable.
//
// A draft may quote the PROSPECT's own prices as facts ("$150 service
// calls") — but the only monthly plan price it may ever state as ours is
// real Nexraft pricing ($299/$399/$599, Growth add-on $750). This is what
// catches the pre-2026-07-21 "$100/month" drafts.
const OUR_MONTHLY_PRICES = new Set(["299", "399", "599", "750"]);
const MONTHLY_PRICE_RE = /\$\s?([\d,]+)(?:\s*[-–]\s*\$?[\d,]+)?\s*(?:\/|per\s|a\s|each\s)\s*mo/gi;
const BANNED_PHRASES = [
  "hope this finds you well",
  "i'd love to connect",
  "to whom it may concern",
  "dear sir",
  "cutting-edge",
  "synergy",
  "revolutionize",
  "i wanted to reach out",
];
// The phrases that make a reader delete without finishing the first line —
// every mass cold email opens with one of these. A tailored draft has no
// reason to use them: it opens with something true about THIS business.
// Added 2026-07-21 after Barry flagged the drafts all "sound like cold
// emails"; the display-time gate means existing drafts using these fall back
// to templates until the redraft pass rewrites them.
const COLD_CLICHES = [
  "i noticed",
  "i came across",
  "i was browsing",
  "i stumbled",
  "reaching out",
  "my name is",
  "just following up",
  "quick question",
  "hope you're doing well",
  "hope you are doing well",
  "i help businesses",
  "we specialize in",
  "don't want to take up",
  "free consultation",
];

export function draftQualityIssue(subject: string, body: string): string | null {
  if (!subject.trim()) return "empty subject";
  if (subject.trim().length > 60) return "subject longer than 60 characters";
  const words = body.trim().split(/\s+/).filter(Boolean).length;
  if (words < 30) return `body too short (${words} words — needs 30+)`;
  if (words > 130) return `body too long (${words} words — keep it under 130)`;
  if (!body.includes("{{REP_NAME}}")) return "missing the {{REP_NAME}} sign-off placeholder";
  if (!body.includes("?")) return "no question — the email must end with one easy question";
  const lower = `${subject}\n${body}`.toLowerCase();
  for (const phrase of BANNED_PHRASES) {
    if (lower.includes(phrase)) return `banned corporate phrase: "${phrase}"`;
  }
  for (const phrase of COLD_CLICHES) {
    if (lower.includes(phrase))
      return `cold-email cliché: "${phrase}" — open with a specific true fact about this business instead`;
  }
  for (const m of `${subject}\n${body}`.matchAll(MONTHLY_PRICE_RE)) {
    const amount = m[1].replaceAll(",", "");
    if (!OUR_MONTHLY_PRICES.has(amount)) {
      return `quotes a monthly price that isn't ours ($${amount}/mo — plans are $299/$399/$599)`;
    }
  }
  return null;
}

export function aiDraftFromResearch(research: unknown, repName: string): EmailDraft | null {
  try {
    const parsed = typeof research === "string" ? JSON.parse(research) : research;
    const ai = (parsed as { ai?: { email_subject?: unknown; email_body?: unknown } } | null)?.ai;
    const subject = typeof ai?.email_subject === "string" ? ai.email_subject.trim() : "";
    const body = typeof ai?.email_body === "string" ? ai.email_body.trim() : "";
    if (!subject || !body) return null;
    // Stored drafts must clear today's quality bar, not the one they were
    // written under — anything stale or sloppy (like the pre-2026-07-21
    // "$100/month" drafts) silently falls back to the canned templates until
    // re-research regenerates it.
    if (draftQualityIssue(subject, body) !== null) return null;
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
