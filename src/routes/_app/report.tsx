import { useState } from "react";

import { createFileRoute } from "@tanstack/react-router";

import { runPublicSiteReport, type PublicSiteReport } from "../../lib/crm/data";
import { explainSiteIssue } from "../../lib/crm/constants";
import { LogoMark } from "../../components/crm/brand";
import { cx } from "../../components/crm/ui";

// Site report card — INTERNAL for now (Barry's call 2026-07-21): lives behind
// the CRM login so the team can grade any prospect's site and use the letter
// grade + plain-English defects as call/email ammo. When Barry's ready to use
// it as the public lead magnet on nexraft.com, move this file back to
// src/routes/report.tsx and drop the requireUser() in runPublicSiteReport.

export const Route = createFileRoute("/_app/report")({
  component: ReportPage,
});

const GRADE_COLORS: Record<string, string> = {
  A: "text-emerald-600",
  B: "text-emerald-600",
  C: "text-amber-600",
  D: "text-signal",
  F: "text-red-500",
};

function ReportPage() {
  const [business, setBusiness] = useState("");
  const [url, setUrl] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<PublicSiteReport | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (business.trim().length < 2) return setError("Tell us your business name.");
    if (!/.+@.+\..+/.test(email)) return setError("Enter a real email so we can send you the fixes.");
    if (url.trim().length < 4 || !url.includes(".")) return setError("Enter your website address, like yourbusiness.com");
    setBusy(true);
    try {
      const res = await runPublicSiteReport({
        data: { business: business.trim(), url: url.trim(), email: email.trim() },
      });
      if (!res.ok) {
        setError("We couldn't reach that address — double-check the spelling and try again.");
      } else {
        setReport(res);
      }
    } catch {
      setError("Something went wrong on our end — give it another try in a minute.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex justify-center px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="mb-5 flex items-center gap-2.5">
          <LogoMark size={34} radius={9} />
          <span className="text-lg font-semibold tracking-tight text-bone">
            Nexraft<span className="text-signal">.</span>
          </span>
        </div>

        <div className="rounded-xl border border-line bg-surface p-6 shadow-xl">
          {report?.grade ? (
            <ReportCard report={report} business={business} onReset={() => setReport(null)} />
          ) : (
            <>
              <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-signal">
                Free website report card
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight text-bone">
                How good is your website, really?
              </h1>
              <p className="mt-2 text-sm text-mute">
                We&apos;ll check it the same way your customers experience it — on their phone, in
                their browser — and grade it honestly. Takes about ten seconds.
              </p>

              <form onSubmit={submit} className="mt-5 space-y-3">
                <Field label="Business name">
                  <input
                    value={business}
                    onChange={(e) => setBusiness(e.target.value)}
                    placeholder="Sunshine Plumbing"
                    className={INPUT}
                    maxLength={120}
                  />
                </Field>
                <Field label="Your website">
                  <input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="sunshineplumbing.com"
                    className={INPUT}
                    maxLength={200}
                    inputMode="url"
                  />
                </Field>
                <Field label="Email — we'll send you the full breakdown">
                  <input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@yourbusiness.com"
                    className={INPUT}
                    maxLength={120}
                    inputMode="email"
                  />
                </Field>
                {error ? <p className="text-sm text-red-600">{error}</p> : null}
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full rounded-[3px] bg-signal px-4 py-2.5 font-mono text-[12px] font-bold uppercase tracking-[0.1em] text-ink transition-opacity hover:opacity-90 disabled:opacity-60"
                >
                  {busy ? "Checking your site…" : "Grade my website — free"}
                </button>
                <p className="text-center text-[11px] text-faint">
                  No spam, no strings. One honest grade.
                </p>
              </form>
            </>
          )}
        </div>

        <p className="mt-4 text-center text-[11px] text-faint">
          Built by Nexraft ·{" "}
          <a href="https://nexraft.com" className="text-mute hover:text-bone">
            nexraft.com
          </a>
        </p>
      </div>
    </div>
  );
}

function ReportCard({
  report,
  business,
  onReset,
}: {
  report: PublicSiteReport;
  business: string;
  onReset: () => void;
}) {
  const grade = report.grade!;
  const good = grade.letter === "A";
  return (
    <div>
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-signal">
        Report card{business ? ` — ${business}` : ""}
      </p>
      <div className="mt-3 flex items-center gap-5">
        <span
          className={cx(
            "text-7xl font-bold tracking-tight",
            GRADE_COLORS[grade.letter] ?? "text-bone",
          )}
        >
          {grade.letter}
        </span>
        <div>
          <p className="text-lg font-semibold leading-snug text-bone">{grade.headline}</p>
          <p className="mt-1 font-mono text-[11px] text-faint">{grade.score}/100</p>
        </div>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2">
        <div
          className={cx("h-full rounded-full", good ? "bg-emerald-500" : "bg-signal")}
          style={{ width: `${Math.max(4, grade.score)}%` }}
        />
      </div>

      {report.status === "dead" ? (
        <p className="mt-5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-600">
          Your website didn&apos;t load at all when we checked. Every customer searching for you
          right now is finding nothing — or finding a competitor.
        </p>
      ) : report.issues.length > 0 ? (
        <ul className="mt-5 space-y-3">
          {report.issues.map((issue, i) => (
            <li key={i} className="rounded-lg border border-line bg-ink/40 px-3 py-2.5">
              <p className="text-sm font-semibold text-bone">{issue}</p>
              <p className="mt-0.5 text-[13px] leading-snug text-mute">{explainSiteIssue(issue)}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-5 text-sm text-mute">
          We didn&apos;t find any of the big problems — nice work keeping it in shape.
        </p>
      )}

      <div className="mt-6 rounded-lg border border-signal/40 bg-signal-soft px-4 py-3.5">
        <p className="text-sm font-semibold text-bone">
          {good
            ? "Want it to actually bring in customers, not just look good?"
            : "We fix every one of these — and you never lift a finger."}
        </p>
        <p className="mt-1 text-[13px] leading-snug text-mute">
          Nexraft builds and runs professional websites for local businesses — design, hosting,
          updates, everything — for one flat monthly rate. We&apos;ll email you the full breakdown
          and reach out within one business day.
        </p>
      </div>

      <button
        type="button"
        onClick={onReset}
        className="mt-4 w-full rounded-[3px] border border-line-strong px-4 py-2 font-mono text-[11px] uppercase tracking-[0.1em] text-mute transition-colors hover:border-signal/40 hover:text-bone"
      >
        Check another site
      </button>
    </div>
  );
}

const INPUT =
  "w-full rounded-md border border-line bg-ink px-3 py-2 text-sm text-bone placeholder:text-faint focus:border-signal/60 focus:outline-none";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block font-mono text-[11px] uppercase tracking-[0.12em] text-mute">
        {label}
      </span>
      {children}
    </label>
  );
}
