// AI layer for company research — config-gated on ANTHROPIC_API_KEY, same
// pattern as Stripe (stripe.server.ts) and Gmail (gmail.server.ts): no SDK,
// plain fetch against the documented REST endpoint, and every caller treats a
// null result as "AI not available" so the rule-based research keeps working
// untouched when the key isn't set (or the call fails).
//
// What it produces per company: a plain-English brief a rep can read in ten
// seconds before dialing, and a first-contact email written ABOUT the company
// (not a template with the name swapped in). Model is Haiku — this runs in
// batches inside a 60s serverless window and costs roughly a cent per company.

import type { ResearchDossier } from "./data";

const API_ENDPOINT = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-4-5-20251001";

export function isAiConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

function apiKey(): string {
  const v = process.env.ANTHROPIC_API_KEY;
  if (!v) throw new Error("ANTHROPIC_API_KEY is not set.");
  return v;
}

export type AiBrief = {
  brief: string; // 2-3 sentence "what they are + how to pitch them"
  email_subject: string;
  email_body: string;
};

// Everything the model needs, distilled from the dossier — we never send raw
// crawled HTML, just the structured facts the rule-based pass already built.
function dossierFacts(
  company: { name: string; city: string | null; industry?: string | null },
  d: ResearchDossier,
): string {
  const lines: string[] = [
    `Business: ${company.name}${company.city ? ` (${company.city})` : ""}`,
  ];
  if (company.industry) lines.push(`Industry: ${company.industry}`);
  lines.push(
    `Website status: ${d.siteStatus === "none" ? "no website at all" : d.siteStatus === "dead" ? "website is down/gone" : "live"}`,
  );
  if (d.summary) lines.push(`What they do: ${d.summary}`);
  if (d.services.length > 0) lines.push(`Services: ${d.services.slice(0, 6).join(", ")}`);
  if (d.established) lines.push(`In business since: ${d.established}`);
  if (d.serviceArea) lines.push(`Service area: ${d.serviceArea}`);
  if (d.people.length > 0) lines.push(`Owner/people: ${d.people.join(", ")}`);
  if (d.rating !== null) lines.push(`Rating: ${d.rating}★ (${d.reviews ?? 0} reviews on ${d.ratingSource})`);
  if (d.angles.length > 0) lines.push(`Site problems we found: ${d.angles.join("; ")}`);
  return lines.join("\n");
}

const SYSTEM = `You write sales intel for Nexraft, a web design agency that builds and maintains websites for local businesses ($100/month, everything handled for them). The reader is a sales rep about to cold-call or email the business described.

Respond with ONLY a JSON object, no markdown fences, in this exact shape:
{"brief": "...", "email_subject": "...", "email_body": "..."}

Rules:
- brief: 2-3 sentences. What the business is, the single strongest reason their current web presence is costing them customers, and the opening angle the rep should lead with. Concrete, no fluff.
- email_subject: under 8 words, specific to THIS business, no clickbait.
- email_body: 90-130 words, plain text. Written about their specific situation (their industry, their rating, their site's actual problems). Anchor value in what one new customer is worth in their trade, never defend the price. Friendly, human, zero corporate speak. Sign off with just "{{REP_NAME}}" on its own line — the CRM fills the name in.
- If the facts include an owner name, address them by first name in the email.
- Never invent facts that are not in the input.`;

// One company in, one brief out. Hard 15s deadline so a slow/failed AI call
// can never stall a research batch — the dossier just ships without the brief.
export async function aiResearchBrief(
  company: { name: string; city: string | null; industry?: string | null },
  dossier: ResearchDossier,
  timeoutMs = 15_000,
): Promise<AiBrief | null> {
  if (!isAiConfigured()) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(API_ENDPOINT, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey(),
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 600,
        system: SYSTEM,
        messages: [{ role: "user", content: dossierFacts(company, dossier) }],
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = (data.content ?? []).find((b) => b.type === "text")?.text ?? "";
    // The model is told "JSON only", but strip fences defensively anyway.
    const raw = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const parsed = JSON.parse(raw) as Partial<AiBrief>;
    if (!parsed.brief || !parsed.email_subject || !parsed.email_body) return null;
    return {
      brief: String(parsed.brief).slice(0, 1000),
      email_subject: String(parsed.email_subject).slice(0, 200),
      email_body: String(parsed.email_body).slice(0, 3000),
    };
  } catch {
    return null; // AI is a bonus, never a blocker — same rule as ratings
  } finally {
    clearTimeout(timer);
  }
}
