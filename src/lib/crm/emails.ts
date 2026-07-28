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

// ---- What makes an email about THIS business --------------------------------
//
// Owner's call, 2026-07-27: "i want every email tailored to each business and
// them to sound like real people and i want them to be good enough maybe even
// offering a free mockup we can show them dont discuss price."
//
// The templates below used to be canned: swap the company name and the same
// email works for anyone, which is exactly the thing an owner deletes without
// finishing the first line. The AI drafts were tailored, but they only exist
// when an AI key is configured and the draft clears the quality bar — so the
// fallback was doing most of the real sending, generically.
//
// So the facts come out of the dossier here, once, and BOTH paths use them.
// A template with the business's own rating, trade and town in it is no longer
// a fallback that reads like a fallback.

/**
 * Anything the outreach copy can be built from — a whole company row, ideally.
 * Fields are `unknown` because the routes hold rows as Record<string, unknown>;
 * outreachFacts coerces, so passing a raw row is safe and is the point.
 */
export type CompanyLike = {
  name?: unknown;
  city?: unknown;
  industry?: unknown;
  research?: unknown;
};

export type OutreachFacts = {
  /** Friendly name — "Mills Plumbing", never "Mills Plumbing & Drain Cleaning LLC". */
  company: string;
  city: string | null;
  /** How a neighbour would say the trade out loud: "plumber", not "Plumbing". */
  trade: string | null;
  rating: number | null;
  reviews: number | null;
  /** Year they opened, when the site says so. */
  established: string | null;
  /** One service they name themselves. */
  service: string | null;
  /** null when nobody has actually checked — never assert absence off this. */
  siteStatus: "live" | "dead" | "none" | null;
  ownerFirst: string | null;
};

// "Plumbing" is what a directory calls it. "plumber" is what a person says.
// Anything not in the list falls through lowercased, which reads fine in
// "searches for landscaping in Naples" even when it isn't a person-noun.
const TRADE_WORDS: Record<string, string> = {
  plumbing: "plumber",
  roofing: "roofer",
  electrical: "electrician",
  landscaping: "landscaper",
  "lawn care": "lawn guy",
  painting: "painter",
  flooring: "flooring guy",
  concrete: "concrete guy",
  remodeling: "remodeler",
  "pest control": "pest control company",
  "pool service": "pool guy",
  "pool cleaning": "pool guy",
  towing: "tow truck",
  "auto repair": "mechanic",
  cleaning: "cleaner",
  "tree service": "tree guy",
};

export function tradeWord(industry: string | null | undefined): string | null {
  const raw = (industry || "").trim();
  if (!raw) return null;
  const hit = TRADE_WORDS[raw.toLowerCase()];
  if (hit) return hit;
  // Acronyms keep their case — "an HVAC company", never "a hvac". On its own
  // an acronym isn't a thing you can hire ("searches for a HVAC"), so it gets
  // a noun attached.
  if (/^[A-Z0-9&/ ]{2,8}$/.test(raw)) return `${raw} company`;
  return raw.toLowerCase();
}

// "a plumber" but "an electrician", and "an HVAC company" — English goes by
// sound, not spelling, and the acronyms that start F/H/L/M/N/R/S/X are said
// "eff, aitch, ell…" so they take "an" too. Getting this wrong is a small
// thing that makes an email read like software wrote it.
function articleFor(word: string): string {
  const w = word.trim();
  if (!w) return "a";
  if (/^[aeiou]/i.test(w)) return "an";
  if (/^[FHLMNRSX][A-Z0-9&/]/.test(w)) return "an";
  return "a";
}

// Pull the tailoring material out of a company row + its research dossier.
// Pure and defensive: junk JSON, missing keys and half-written dossiers all
// just mean fewer facts, never a throw.
export function outreachFacts(c: CompanyLike | null | undefined): OutreachFacts {
  // The call sites hold company rows typed as Record<string, unknown>, so the
  // fields arrive as `unknown` and get coerced here rather than cast at every
  // caller. A non-string is the same as absent: one fact fewer, never a throw.
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  const base: OutreachFacts = {
    company: friendlyCompanyName(str(c?.name)) || "your business",
    city: str(c?.city).trim() || null,
    trade: tradeWord(str(c?.industry)),
    rating: null,
    reviews: null,
    established: null,
    service: null,
    siteStatus: null,
    ownerFirst: null,
  };
  let d: Record<string, unknown>;
  try {
    const parsed = typeof c?.research === "string" ? JSON.parse(c.research) : c?.research;
    if (!parsed || typeof parsed !== "object") return base;
    d = parsed as Record<string, unknown>;
  } catch {
    return base;
  }
  const rating = Number(d.rating);
  const reviews = Number(d.reviews);
  if (Number.isFinite(rating) && rating > 0) base.rating = rating;
  if (Number.isFinite(reviews) && reviews > 0) base.reviews = Math.round(reviews);
  if (typeof d.established === "string" && d.established.trim()) base.established = d.established.trim();
  const services = Array.isArray(d.services) ? d.services : [];
  const firstService = services.find((s) => typeof s === "string" && s.trim().length > 2);
  if (typeof firstService === "string") base.service = firstService.trim();
  const people = Array.isArray(d.people) ? d.people : [];
  const firstPerson = people.find((p) => typeof p === "string" && p.trim().length > 1);
  if (typeof firstPerson === "string") base.ownerFirst = firstPerson.trim().split(/\s+/)[0] || null;
  // The whole point of the 2026-07-27 site-probe work: "none" is only a fact
  // when someone actually looked. Without the probe stamp we report null and
  // every line that would have asserted sitelessness stays unwritten.
  const status = d.siteStatus;
  if (status === "live" || status === "dead") base.siteStatus = status;
  else if (status === "none" && d.siteProbe) base.siteStatus = "none";
  return base;
}

// The tokens that prove an email was written about this business and not
// generated from a name. At least one of these has to survive into the final
// copy or the draft is, by definition, a mail merge.
export function specificityTokens(f: OutreachFacts): string[] {
  const t: string[] = [];
  if (f.city) t.push(f.city);
  if (f.trade) t.push(f.trade);
  if (f.rating !== null) t.push(String(f.rating));
  if (f.reviews !== null) t.push(String(f.reviews));
  if (f.established) t.push(f.established);
  if (f.service) t.push(f.service);
  return t;
}

// The opening line: the single most specific TRUE thing we know, written so
// the first word is about them. Ordered by how much it proves we looked.
// Every branch is honest about what we actually verified — nothing here
// claims a business has no website unless the probe ran and found nothing.
export function specificOpener(f: OutreachFacts): string {
  const where = f.city ? ` in ${f.city}` : " around here";
  const searches = f.trade
    ? `someone searches for ${articleFor(f.trade)} ${f.trade}${where}`
    : `someone looks you up`;
  if (f.siteStatus === "dead") {
    return `${f.company}'s website isn't loading — I checked twice to be sure. Anyone looking for you right now finds a dead page and tries the next name down the list.`;
  }
  if (f.rating !== null && f.reviews !== null) {
    // Deliberately NOT "better than anyone in town" — we've never looked at
    // the competition, and a claim we can't back is the fastest way to lose a
    // reader who knows their own market better than we do.
    return `${f.rating} stars across ${f.reviews} reviews is a lot of people vouching for you — but that all lives on Google's page, not yours. When ${searches}, none of it shows.`;
  }
  if (f.siteStatus === "none") {
    return `Went looking for a website for ${f.company} and couldn't find one anywhere. Which means when ${searches}, the work goes to whoever does show up.`;
  }
  if (f.established) {
    return `${f.company} has been${where} since ${f.established}. That's the kind of track record people are actually looking for — and it's nowhere to be seen when ${searches}.`;
  }
  if (f.service) {
    return `Saw ${f.company} does ${f.service.toLowerCase()}. When ${searches}, though, you're not what comes up first — and that's usually the whole ballgame.`;
  }
  if (f.trade) {
    return `When ${searches}, whatever they find is what decides if they call ${f.company} or the next name down. Worth knowing what it's telling them.`;
  }
  return `Had a look at how ${f.company} turns up online, and there's an easy win sitting there.`;
}

// The ask, every time: something they can SEE, free, with no price attached
// and no obligation. "Want me to put one together?" is a one-word answer for
// someone reading on a phone between jobs.
export function mockupAsk(f: OutreachFacts): string {
  return `Easier to show you than explain it: I'll build ${f.company} a homepage mockup. Real design, your own reviews and photos on it, free, and yours to keep either way.\n\nWant me to put one together?`;
}

// The copy below is tuned for one thing: getting a REPLY from a busy owner
// reading on their phone. That means short (under ~90 words), one specific
// point, one easy question — and an out ("just say no thanks") that
// paradoxically makes people answer. No pitch walls, no "I'd love to connect".
//
// NEVER a price. Barry's rule as of 2026-07-27: a number in a first email
// gets argued with before anything has been shown. The mockup is the offer;
// price is a conversation for after they've seen it and want it.

// Subjects are lowercase and specific — the way a person in town types one,
// not the way a campaign tool does. Same fact that drives the opening line.
function nudgeSubject(f: OutreachFacts): string {
  if (f.siteStatus === "dead") return `${f.company.toLowerCase()}'s site is down`;
  if (f.reviews !== null) return `those ${f.reviews} reviews`;
  if (f.siteStatus === "none") return `couldn't find your site`;
  if (f.established) return `${f.company.toLowerCase()} since ${f.established}`;
  return `${f.company.toLowerCase()} on google`;
}

// A few words naming what this business specifically has going on — for the
// spots that need to prove the email is about them without re-running the
// whole opening line. Same fact order as specificOpener, so a sequence reads
// consistently. Null when we genuinely know nothing, and then the copy simply
// doesn't make a claim.
function shortFact(f: OutreachFacts): string | null {
  if (f.siteStatus === "dead") return "the site that isn't loading";
  if (f.reviews !== null) return `those ${f.reviews} reviews with nowhere to send anyone`;
  if (f.siteStatus === "none") return "not being able to find you online";
  if (f.established) return `everything you've built since ${f.established}`;
  if (f.service) return `the ${f.service.toLowerCase()} side of it`;
  if (f.trade) return `how you turn up when someone needs ${articleFor(f.trade)} ${f.trade}`;
  return null;
}

// Greet the owner by name when the dossier actually turned one up. Anything
// else gets "Hi there," — a wrong name is worse than no name.
function greetOwner(f: OutreachFacts): string {
  return f.ownerFirst ? `${f.ownerFirst} —` : "Hi there,";
}

function signOff(repName: string): string {
  return `${repName || "The Nexraft team"}\nNexraft`;
}

// Nudge 1 — right after a missed call. Opens on THEM (the missed call is the
// second line, never the first), offers something they can look at, no price.
function nudge1(f: OutreachFacts, repName: string): EmailDraft {
  return {
    subject: nudgeSubject(f),
    body: `${greetOwner(f)}

${specificOpener(f)}

Rang you about it a few minutes ago and missed you.

${mockupAsk(f)} If not, say so and I'll leave you be.

${signOff(repName)}`,
  };
}

// Nudge 2 — a few days later. Shorter, one angle, same free offer. No new
// argument: people reply to the second email because it's easy, not because
// it's more persuasive.
function nudge2(f: OutreachFacts, repName: string): EmailDraft {
  // Careful with this one: the reps are spread across southwest Florida, so
  // "I'm in Cape Coral too" is a coin-flip lie the moment the prospect is a
  // town over. The regional version is true for every rep and lands the same.
  const where = f.city ? `up the road from ${f.city}` : "in southwest Florida";
  return {
    subject: `re: ${nudgeSubject(f)}`,
    body: `${greetOwner(f)}

Following my note about how ${f.company} shows up online — still happy to build the mockup, and it costs you nothing either way.

It takes me an evening. You'd get a real homepage with your own reviews and photos on it, and you can do whatever you like with it, including nothing.

Want me to send it over? One word does it.

${signOff(repName)}

P.S. — I'm ${where}, so this isn't a call centre in another state.`,
  };
}

// Nudge 3 — the breakup email. Consistently the most-replied-to email in any
// cold sequence: closing the file makes people who were on the fence speak up.
function nudge3(f: OutreachFacts, repName: string): EmailDraft {
  const fact = shortFact(f);
  // Even the goodbye names their thing. A breakup email that could have been
  // sent to anyone reads like the mail merge finally running out of steps.
  const opening = fact
    ? `I've written twice about ${f.company} — ${fact} — and heard nothing back.`
    : `I've written twice about ${f.company}'s website and heard nothing back.`;
  return {
    subject: `closing your file — ${f.company.toLowerCase()}`,
    body: `${greetOwner(f)}

${opening} That's a fair answer on its own, so I'm closing the file and you won't hear from me again.

Before I do: if it was just bad timing, one word ("later") and I'll check back down the road. If you're all set, no reply needed at all.

Either way, good luck out there. The offer of a free mockup stands if it ever becomes the thing.

${signOff(repName)}`,
  };
}

export const NUDGE_LABELS = ["1st nudge", "2nd nudge", "Final nudge"];

// Build the right draft for a given touch. `touch` is 1-based (the nudge being
// sent now). Anything past 3 reuses the final nudge.
//
// Pass the whole company row, not just its name: the row is what carries the
// city, the trade and the dossier, and those are the difference between an
// email about them and an email about nobody. A bare string still works so
// older call sites keep compiling — it just produces the thinnest version.
export function followUpEmail(
  company: string | CompanyLike,
  repName: string,
  touch: number,
): EmailDraft {
  const f = outreachFacts(typeof company === "string" ? { name: company } : company);
  const t = Math.max(1, Math.min(3, touch));
  if (t === 1) return nudge1(f, repName);
  if (t === 2) return nudge2(f, repName);
  return nudge3(f, repName);
}

// Back-compat alias for the original single-template helper.
export function missedCallEmail(company: string | CompanyLike, repName: string): EmailDraft {
  return followUpEmail(company, repName, 1);
}

// ---- Email tab templates ----------------------------------------------------
// One-click starting points for the compose page. Each template auto-fills the
// company name, the contact's first name (when we have one), and the rep's
// name — the rep just tweaks and hits send.

export type TemplateInput = {
  company: string;
  firstName?: string | null;
  repName: string;
  /**
   * The whole company row when the caller has it. This is what turns a
   * template from a mail merge into an email about a specific business —
   * pass it wherever it's in scope.
   */
  row?: CompanyLike | null;
};
/** What the build functions actually receive: the input plus the derived facts. */
type BuiltInput = TemplateInput & { facts: OutreachFacts };
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

const RAW_TEMPLATES: { id: string; label: string; hint: string; build: (t: BuiltInput) => EmailDraft }[] = [
  {
    id: "intro",
    label: "Intro",
    hint: "First time reaching out",
    // Rewritten 2026-07-27. The old one opened "Barry here, from Nexraft — we
    // build and run websites for local businesses", quoted a monthly price to
    // a stranger, and would have read identically for any company on earth.
    // Now: their fact first, the free mockup as the only ask, no price.
    build: ({ company, firstName, repName, facts }) => ({
      subject: nudgeSubject(facts),
      body: `${firstName ? greet(firstName) : greetOwner(facts)}

${specificOpener(facts)}

${mockupAsk(facts)}

No pitch attached — if you see it and want nothing more, that's a fine outcome.

${signOff(repName)}`,
    }),
  },
  {
    id: "followup",
    label: "Follow-up",
    hint: "Nudge someone who went quiet",
    build: ({ company, firstName, repName, facts }) => ({
      subject: `re: ${nudgeSubject(facts)}`,
      body: `${firstName ? greet(firstName) : greetOwner(facts)}

My note about how ${company} turns up online probably got buried, so I'll bump it once and then stop.

The offer hasn't changed: I'll build you a homepage mockup, free, yours to keep, no strings. Takes me an evening and you're not on the hook for anything.

Yes, no, or "ask me in the fall" — any one-word reply works.

${signOff(repName)}`,
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
  id: t.id,
  label: t.label,
  hint: t.hint,
  build: (input) => {
    // Facts come from the row when the caller passed one, and fall back to
    // the bare name when it didn't — so a template is never worse than it was
    // and is a lot better wherever the row is in scope.
    const facts = outreachFacts(input.row ?? { name: input.company });
    return t.build({ ...input, company: facts.company, facts });
  },
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
// Money, at all, in a first-touch email. Owner's rule 2026-07-27: "dont
// discuss price." The old rule allowed our real plan prices through and only
// caught invented ones — which is why every draft still led with $299/month
// and got argued with before anything had been shown. The offer is a free
// mockup; the number is a conversation for after they've seen it and want it.
//
// Deliberately blunt: any dollar figure at all fails. That also catches the
// prospect's own prices ("$150 service calls"), which is fine — quoting a
// stranger's pricing back at them was never a good opening either.
const ANY_MONEY_RE = /\$\s?\d/;
const PRICE_TALK = [
  "plans start",
  "plans from",
  "starting at",
  "per month",
  "a month",
  "/month",
  "/mo",
  "monthly fee",
  "our pricing",
  "price point",
  "affordable",
  "budget-friendly",
];
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

export function draftQualityIssue(
  subject: string,
  body: string,
  /**
   * Facts that prove the email was written about THIS business — city, trade,
   * rating, review count, founding year, a named service. When any are given,
   * at least one has to appear in the copy or the draft is a mail merge by
   * definition and gets rejected. Omit (or pass an empty list) for a company
   * we know nothing about, where there is nothing to require.
   */
  mustMention: string[] = [],
): string | null {
  if (!subject.trim()) return "empty subject";
  if (subject.trim().length > 60) return "subject longer than 60 characters";
  const words = body.trim().split(/\s+/).filter(Boolean).length;
  if (words < 30) return `body too short (${words} words — needs 30+)`;
  if (words > 130) return `body too long (${words} words — keep it under 130)`;
  if (!body.includes("{{REP_NAME}}")) return "missing the {{REP_NAME}} sign-off placeholder";
  if (!body.includes("?")) return "no question — the email must end with one easy question";
  const joined = `${subject}\n${body}`;
  const lower = joined.toLowerCase();
  for (const phrase of BANNED_PHRASES) {
    if (lower.includes(phrase)) return `banned corporate phrase: "${phrase}"`;
  }
  for (const phrase of COLD_CLICHES) {
    if (lower.includes(phrase))
      return `cold-email cliché: "${phrase}" — open with a specific true fact about this business instead`;
  }
  if (ANY_MONEY_RE.test(joined)) {
    return "mentions a price — first-touch emails never discuss money, the offer is a free mockup";
  }
  for (const phrase of PRICE_TALK) {
    if (lower.includes(phrase)) return `talks about pricing ("${phrase}") — offer the free mockup instead`;
  }
  // The mail-merge test, enforced rather than merely requested in the prompt.
  const facts = mustMention.map((s) => s.trim().toLowerCase()).filter((s) => s.length > 1);
  if (facts.length > 0 && !facts.some((f) => lower.includes(f))) {
    return `nothing specific to this business — work in at least one of: ${mustMention.join(", ")}`;
  }
  return null;
}

export function aiDraftFromResearch(
  research: unknown,
  repName: string,
  /** The company row, when the caller has it — adds city and trade to the specificity check. */
  row?: CompanyLike | null,
): EmailDraft | null {
  try {
    const parsed = typeof research === "string" ? JSON.parse(research) : research;
    const ai = (parsed as { ai?: { email_subject?: unknown; email_body?: unknown } } | null)?.ai;
    const subject = typeof ai?.email_subject === "string" ? ai.email_subject.trim() : "";
    const body = typeof ai?.email_body === "string" ? ai.email_body.trim() : "";
    if (!subject || !body) return null;
    // Stored drafts must clear today's quality bar, not the one they were
    // written under — anything stale or sloppy (the pre-2026-07-21 "$100/month"
    // drafts, and now every draft that quotes a price or could have been sent
    // to anyone) silently falls back to the templates until the nightly
    // redraft pass rewrites it. The templates are themselves tailored now, so
    // falling back is no longer a downgrade to a mail merge.
    const facts = specificityTokens(outreachFacts({ ...(row ?? {}), research: parsed }));
    if (draftQualityIssue(subject, body, facts) !== null) return null;
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
