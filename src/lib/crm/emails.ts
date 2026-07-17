// Pure email templates + helpers shared by the Calls board and the Follow-ups
// queue. No server imports — safe on client and server. These power the "email
// them when they don't pick up" flow: a friendly, escalating set of nudges the
// rep sends from their own inbox via a pre-filled mailto draft (no account
// connection needed).

export type EmailDraft = { subject: string; body: string };

function firstName(repName: string): string {
  return (repName || "").split(" ")[0] || "the Nexraft team";
}

// Nudge 1 — right after a missed call. Warm, low-pressure "sorry we missed you".
function nudge1(company: string, rep: string, repName: string): EmailDraft {
  return {
    subject: `Sorry we missed you — ${company} & Nexraft`,
    body: `Hi there,

This is ${rep} from Nexraft — I just tried giving you a quick call about your website but couldn't reach you. No worries at all!

We build clean, professional websites for local businesses, and I'd love to show you what we could put together for ${company}. There's no pressure — just a quick chat whenever it suits you.

You can reply straight to this email or call me back and we'll find a time that works. Looking forward to connecting.

Talk soon,
${repName || "The Nexraft team"}
Nexraft`,
  };
}

// Nudge 2 — a few days later. Lead with a concrete idea / bit of value.
function nudge2(company: string, rep: string, repName: string): EmailDraft {
  return {
    subject: `A quick idea for ${company}'s website`,
    body: `Hi again,

${rep} from Nexraft here — following up on my note from earlier. I had a look at how ${company} shows up online and I think a clean, modern site could make it a lot easier for new customers to find you and get in touch.

We handle everything — design, copy, hosting — so it's genuinely hands-off for you. Most of our local clients are up and running in a couple of weeks.

Would you be open to a 10-minute call this week? Just reply with a time that suits and I'll make it work.

Best,
${repName || "The Nexraft team"}
Nexraft`,
  };
}

// Nudge 3 — final, graceful check-in. Leaves the door open without pestering.
function nudge3(company: string, rep: string, repName: string): EmailDraft {
  return {
    subject: `Should I close the loop, ${company}?`,
    body: `Hi there,

${rep} from Nexraft — I've reached out a couple of times about building a website for ${company} and don't want to crowd your inbox, so this is my last note for now.

If a new site isn't a priority right now, no problem at all — just let me know and I'll leave you be. And if the timing is simply off, I'm happy to check back down the road.

Either way, I'd love to help whenever you're ready.

All the best,
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

// A mailto: link that opens the rep's own email app with everything pre-filled.
export function mailtoLink(to: string, subject: string, body: string): string {
  const params = `subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  return `mailto:${encodeURIComponent(to)}?${params}`;
}
