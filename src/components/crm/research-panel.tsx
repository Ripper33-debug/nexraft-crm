import { useRouter, useRouteContext } from "@tanstack/react-router";
import { useState } from "react";

import { researchCompany, type ResearchDossier } from "../../lib/crm/data";
import { Button, Card, Eyebrow, Pill } from "./ui";
import { relativeTime } from "../../lib/crm/constants";
import { toast } from "./toast";

type Row = Record<string, unknown>;

// Command Deck intel panel: shows the saved research dossier and lets a rep
// (re)run the dig on demand. The server does the crawling; this just renders
// whatever came back and refreshes the route so the note thread catches up.
// Shared between the company detail page and the pipeline deal modal, so a
// rep can work a deal — read the intel, copy the tailored email — without
// ever leaving the board.
export function ResearchPanel({ company }: { company: Row }) {
  const router = useRouter();
  const { user } = useRouteContext({ from: "/_app" }) as { user?: { name?: string; role?: string } };
  const [busy, setBusy] = useState(false);
  const [dossier, setDossier] = useState<ResearchDossier | null>(() => {
    try {
      return company.research ? (JSON.parse(company.research as string) as ResearchDossier) : null;
    } catch {
      return null;
    }
  });

  const run = async () => {
    setBusy(true);
    try {
      const res = await researchCompany({ data: { id: company.id as string } });
      setDossier(res.dossier);
      toast("🔎 Research done — findings saved to notes.");
      void router.invalidate();
    } catch {
      toast("Research failed — try again in a moment.");
    } finally {
      setBusy(false);
    }
  };

  const d = dossier;
  return (
    <Card className="relative p-4">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute right-0 top-0 h-2.5 w-2.5 border-r-2 border-t-2 border-signal"
      />
      <div className="flex items-center justify-between gap-3">
        <Eyebrow>Intel</Eyebrow>
        <div className="flex items-center gap-3">
          {d ? (
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-faint">
              {relativeTime(d.researched_at)}
            </span>
          ) : null}
          <Button size="sm" variant="outline" onClick={run} disabled={busy}>
            {busy ? "Digging…" : d ? "↻ Re-research" : "🔎 Research"}
          </Button>
        </div>
      </div>
      {!d ? (
        <p className="mt-3 text-sm text-faint">
          {busy
            ? "Reading their website, hunting contacts, checking reputation…"
            : "No dossier yet. Run research to pull what they do, who runs it, contacts, and pitch angles straight off their website."}
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          {d.summary ? <p className="text-sm leading-relaxed text-mute">{d.summary}</p> : null}
          {d.services.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {d.services.map((s) => (
                <Pill key={s} tone="neutral">{s}</Pill>
              ))}
            </div>
          ) : null}
          <div className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {d.established ? (
              <div><span className="text-faint">Since </span><span className="text-bone">{d.established}</span></div>
            ) : null}
            {d.serviceArea ? (
              <div><span className="text-faint">Serves </span><span className="text-bone">{d.serviceArea}</span></div>
            ) : null}
            {d.people.length > 0 ? (
              <div><span className="text-faint">Owner </span><span className="text-bone">{d.people.join(", ")}</span></div>
            ) : null}
            {d.rating !== null ? (
              <div>
                <span className="text-signal">{"★".repeat(Math.round(d.rating))}</span>
                <span className="ml-1.5 text-bone">{d.rating}</span>
                <span className="text-faint"> · {d.reviews ?? 0} reviews ({d.ratingSource})</span>
              </div>
            ) : null}
          </div>
          {d.emails.length > 0 || d.phones.length > 0 ? (
            <div className="font-mono text-xs text-mute">
              {[...d.emails, ...d.phones].join(" · ")}
            </div>
          ) : null}
          {d.socials.length > 0 ? (
            <div className="flex flex-wrap gap-3 text-xs">
              {d.socials.map((s) => (
                <a key={s} href={s} target="_blank" rel="noreferrer" className="text-signal hover:underline">
                  {s.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]}
                </a>
              ))}
            </div>
          ) : null}
          {d.angles.length > 0 ? (
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint">Pitch angles</div>
              <ul className="mt-1.5 space-y-1">
                {d.angles.map((a) => (
                  <li key={a} className="flex gap-2 text-sm text-mute">
                    <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 bg-signal" />
                    <span>{a}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {d.ai ? (
            <div className="rounded-lg border border-signal/25 bg-signal-soft/40 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-signal">AI call brief</div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    const body = (d.ai?.email_body ?? "").replace(/\{\{REP_NAME\}\}/g, user?.name ?? "");
                    const text = `Subject: ${d.ai?.email_subject ?? ""}\n\n${body}`;
                    try {
                      await navigator.clipboard.writeText(text);
                      toast("✉ Email draft copied — paste it into Outreach or Gmail.", "success");
                    } catch {
                      prompt("Copy the drafted email:", text);
                    }
                  }}
                >
                  Copy email draft
                </Button>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-bone">{d.ai.brief}</p>
              <div className="mt-3 border-t border-line/60 pt-2">
                <div className="text-xs text-faint">Drafted email · {d.ai.email_subject}</div>
                <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-mute">
                  {d.ai.email_body.replace(/\{\{REP_NAME\}\}/g, user?.name ?? "")}
                </p>
              </div>
            </div>
          ) : user?.role === "admin" ? (
            <p className="text-xs text-faint">
              No AI brief on this dossier — add OPENROUTER_API_KEY (or ANTHROPIC_API_KEY) in Vercel and hit ↻ Re-research to get a
              call-ready brief and a drafted email written about this business.
            </p>
          ) : null}
        </div>
      )}
    </Card>
  );
}
