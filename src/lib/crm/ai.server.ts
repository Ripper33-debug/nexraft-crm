// AI layer for company research — config-gated on an API key, same pattern as
// Stripe (stripe.server.ts) and Gmail (gmail.server.ts): no SDK, plain fetch
// against the documented REST endpoint, and every caller treats a null result
// as "AI not available" so the rule-based research keeps working untouched
// when no key is set (or the call fails).
//
// Two providers are supported, picked automatically from the env:
//   - OpenRouter (openrouter.ai) — set OPENROUTER_API_KEY. Also used if the
//     ANTHROPIC_API_KEY value starts with "sk-or-" (that prefix means it's an
//     OpenRouter key pasted into the wrong variable — we route it correctly
//     instead of failing). This path runs Grok 4.5 by default (owner's pick,
//     and cheaper than the Claude options there — OpenRouter has no Haiku);
//     swap models any time by setting AI_MODEL to a full OpenRouter slug.
//   - Anthropic direct — set ANTHROPIC_API_KEY (a real "sk-ant-" key). Runs
//     Haiku, roughly a cent per company.
//
// What it produces per company: a plain-English brief a rep can read in ten
// seconds before dialing, and a first-contact email written ABOUT the company
// (not a template with the name swapped in). Either way this runs in batches
// inside a 60s serverless window.

import type { ResearchDossier } from "./data";
import { draftQualityIssue } from "./emails";

const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
// Which model runs on OpenRouter. Grok 4.5 per the owner's pick — it's also
// cheaper per token than the Claude options there. Overridable via AI_MODEL
// in Vercel (must be a full OpenRouter slug with a vendor prefix, e.g.
// "x-ai/grok-4.5-20260708" or "anthropic/claude-sonnet-5") so the model can
// be swapped without a code change.
const AI_MODEL_OVERRIDE = process.env.AI_MODEL?.trim();
const OPENROUTER_MODEL =
  AI_MODEL_OVERRIDE && AI_MODEL_OVERRIDE.includes("/")
    ? AI_MODEL_OVERRIDE
    : "x-ai/grok-4.5-20260708";

type AiProvider = { kind: "anthropic" | "openrouter"; key: string };

// OpenRouter keys always start with "sk-or-"; Anthropic's own start "sk-ant-".
function pickProvider(): AiProvider | null {
  const or = process.env.OPENROUTER_API_KEY;
  if (or) return { kind: "openrouter", key: or };
  const ant = process.env.ANTHROPIC_API_KEY;
  if (!ant) return null;
  if (ant.startsWith("sk-or-")) return { kind: "openrouter", key: ant };
  return { kind: "anthropic", key: ant };
}

export function isAiConfigured(): boolean {
  return pickProvider() !== null;
}

// The model an unconfigured caller would get by default — used by data.ts to
// stamp/fingerprint cached briefs so switching providers regenerates them.
export function aiDefaultModel(): string {
  return pickProvider()?.kind === "openrouter" ? OPENROUTER_MODEL : ANTHROPIC_MODEL;
}

// One prompt in, plain text out — the single place that knows both wire
// formats. Anthropic's /v1/messages takes the system prompt as its own field
// and returns content blocks; OpenRouter speaks the OpenAI chat-completions
// shape (system as a message, text under choices[0].message.content).
// Throws NO_KEY / AI_ERROR_<status> / AI_EMPTY so callers that want detail
// (generateBriefText in data.ts) get it; callers that treat AI as a bonus
// (aiResearchBrief below) just wrap it in try/catch.
export async function aiComplete(req: {
  system: string;
  user: string;
  maxTokens: number;
  model?: string;
  signal?: AbortSignal;
}): Promise<string> {
  const provider = pickProvider();
  if (!provider) throw new Error("NO_KEY");
  // OpenRouter slugs always carry a vendor prefix ("anthropic/..."). A bare
  // Anthropic model id (e.g. from AI_BRIEF_MODEL) doesn't exist there, so
  // fall back to our OpenRouter default instead of a guaranteed 404.
  const model =
    provider.kind === "openrouter"
      ? req.model && req.model.includes("/")
        ? req.model
        : OPENROUTER_MODEL
      : (req.model ?? ANTHROPIC_MODEL);
  const res =
    provider.kind === "openrouter"
      ? await fetch(OPENROUTER_ENDPOINT, {
          method: "POST",
          signal: req.signal,
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${provider.key}`,
          },
          body: JSON.stringify({
            model,
            max_tokens: req.maxTokens,
            messages: [
              { role: "system", content: req.system },
              { role: "user", content: req.user },
            ],
          }),
        })
      : await fetch(ANTHROPIC_ENDPOINT, {
          method: "POST",
          signal: req.signal,
          headers: {
            "content-type": "application/json",
            "x-api-key": provider.key,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model,
            max_tokens: req.maxTokens,
            system: req.system,
            messages: [{ role: "user", content: req.user }],
          }),
        });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`AI_ERROR_${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    content?: { type: string; text?: string }[]; // Anthropic shape
    choices?: { message?: { content?: string } }[]; // OpenRouter shape
  };
  const text =
    provider.kind === "openrouter"
      ? (data.choices?.[0]?.message?.content ?? "").trim()
      : (data.content ?? [])
          .filter((b) => b.type === "text")
          .map((b) => b.text ?? "")
          .join("\n")
          .trim();
  if (!text) throw new Error("AI_EMPTY");
  return text;
}

// Bumped whenever the SYSTEM prompt below changes in a way that should
// regenerate already-stored drafts. Stored on each brief as `v`; the redraft
// pass in data.ts walks companies whose brief carries an older (or no)
// version and rewrites just the AI layer from the saved dossier — no
// re-crawl. v2 (2026-07-21): Barry flagged that the drafts "all sound like
// cold emails" — rewrote the prompt around one specific hook, banned the
// mass-mail clichés, and pushed for neighbor-not-salesman voice.
export const AI_PROMPT_VERSION = 2;

export type AiBrief = {
  brief: string; // 2-3 sentence "what they are + how to pitch them"
  email_subject: string;
  email_body: string;
  /** Prompt version that produced this draft — missing means v1. */
  v?: number;
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

const SYSTEM = `You write sales intel for Nexraft, a web design agency that builds and maintains websites for local businesses (a one-time build fee plus a managed plan from $299/month — design, hosting, updates, everything handled for them). The reader is a sales rep about to cold-call or email the business described.

Respond with ONLY a JSON object, no markdown fences, in this exact shape:
{"brief": "...", "email_subject": "...", "email_body": "..."}

Rules:
- brief: 2-3 sentences. What the business is, the single strongest reason their current web presence is costing them customers, and the opening angle the rep should lead with. Concrete, no fluff.
- email_subject: 2-6 words, lowercase and casual, like a note from someone in town ("your google reviews", "question about the shop"). Specific to THIS business. Never salesy, never Title Case, no clickbait.
- email_body: 50-90 words, plain text, written to be read on a phone. Its only job is to get a REPLY, not to close a sale.

The one test that matters: if this email could be sent to a different business by swapping the name, it is WRONG. Delete it and start from what makes THIS business different — their exact rating and review count, how long they've been at it, a service they name, their town, the specific thing broken or missing about their site. Work at least two of those facts in, stated plainly ("4.9 stars across 212 reviews", "pouring concrete in Cape Coral since 2009") — numbers and proper nouns are what make it obviously written for them.

Voice: a neighbor who happens to build websites, texting between jobs. Contractions. Short sentences. It's fine to sound almost blunt. Never introduce yourself or your company in the first sentence — the first sentence is entirely about THEM. Never use the mass-mail phrases every business owner deletes on sight: "I noticed", "I came across", "reaching out", "my name is", "quick question", "just following up", "hope you're doing well", "we specialize in", "free consultation". If you catch yourself opening with "I", rewrite the sentence to start with them ("Your reviews...", "Joe's Plumbing shows up...", "Searched for a plumber in Naples and...").

Structure: (1) the single most specific TRUE observation about this business, and why it's costing them customers — the gap between how good they are and how they look online is the story; (2) one sentence on the fix (we handle everything — plans from $299/month); never quote any other price; (3) ONE question they can answer in a word or two ("worth a look?", "want me to send it over?") plus an easy out ("if not, just say so and I'll leave you be"). No bullet points, zero corporate speak. Sign off with just "{{REP_NAME}}" on its own line — the CRM fills the name in.

- If the facts include an owner name, address them by first name in the email.
- Never invent facts that are not in the input. If the facts are thin (no rating, no services), lean on what IS there — a dead site, no site at all, their trade and town — and stay plain rather than making details up.`;

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
    // Quality loop: the draft must clear the same bar the composer enforces
    // (draftQualityIssue — length, question, sign-off placeholder, real
    // pricing, no corporate speak). One rewrite attempt with the specific
    // failure fed back; still bad → return null so a weak draft is never
    // stored and the canned templates take over. "Best every time" beats
    // "always something".
    const facts = dossierFacts(company, dossier);
    let feedback: string | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const text = await aiComplete({
        system: SYSTEM,
        user: feedback
          ? `${facts}\n\nYour previous draft was rejected by our quality check: ${feedback}. Rewrite it, fix exactly that, and return the same JSON shape.`
          : facts,
        maxTokens: 600,
        signal: ctrl.signal,
      });
      // The model is told "JSON only", but strip fences defensively anyway.
      const raw = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
      const parsed = JSON.parse(raw) as Partial<AiBrief>;
      if (!parsed.brief || !parsed.email_subject || !parsed.email_body) return null;
      const brief = {
        brief: String(parsed.brief).slice(0, 1000),
        email_subject: String(parsed.email_subject).slice(0, 200),
        email_body: String(parsed.email_body).slice(0, 3000),
      };
      feedback = draftQualityIssue(brief.email_subject, brief.email_body);
      if (feedback === null) return { ...brief, v: AI_PROMPT_VERSION };
    }
    return null; // two strikes — ship the dossier without a draft
  } catch {
    return null; // AI is a bonus, never a blocker — same rule as ratings
  } finally {
    clearTimeout(timer);
  }
}
