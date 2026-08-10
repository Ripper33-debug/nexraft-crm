import { createFileRoute, useRouter, useRouteContext } from "@tanstack/react-router";

import { useState } from "react";

import { getUsers, getLeadEngineState, setLeadEnginePaused, runNewBusinessImport } from "../../lib/crm/data";
import { toast } from "../../components/crm/toast";
import { useAutoConfig, useAutoStatus, setConfig } from "../../lib/crm/autodiscover";
import { OrbStage } from "../../components/crm/orbstage";

// The Discover page is now a single living scene: the molten LEADS orb in the
// middle, every teammate orbiting it as a named orb, and lead-orbs firing from
// the center at whichever rep the radar assigns each find to. One switch —
// admin only — turns the radar on and off. Nothing else.
export const Route = createFileRoute("/_app/discover")({
  component: DiscoverPage,
  loader: async () => {
    const [users, engine] = await Promise.all([getUsers(), getLeadEngineState()]);
    return { users, engine };
  },
});

const DEFAULT_AREA = "Florida, USA";

function DiscoverPage() {
  const { users, engine } = Route.useLoaderData();
  const router = useRouter();
  const { user } = useRouteContext({ from: "/_app" }) as { user?: { role?: string } };
  const isAdmin = user?.role === "admin";
  const config = useAutoConfig();
  const st = useAutoStatus();
  const on = !engine.paused && config.on;
  const live = on && !st.paused;
  const [pulling, setPulling] = useState(false);

  // On-demand pull of yesterday's brand-new Florida registrations (the cron
  // does this every morning too — this button is for "show me right now").
  async function pullNewBusinesses() {
    if (!isAdmin || pulling) return;
    setPulling(true);
    try {
      const res = await runNewBusinessImport();
      if (!res.configured) {
        toast(
          "New-business feed isn't set up yet — add SUNBIZ_DAILY_API_KEY in Vercel (free key from sunbizdaily.com).",
          "error",
        );
      } else if (res.imported === 0) {
        toast(`Scanned ${res.scanned} fresh filings — nothing new for your areas today.`, "info");
      } else {
        toast(`🏢 Imported ${res.imported} brand-new businesses from yesterday's state filings.`, "info");
        void router.invalidate();
      }
    } catch {
      toast("Couldn't pull the new-business feed — try again.", "error");
    } finally {
      setPulling(false);
    }
  }

  // One switch does everything: flipping it on lifts the master pause (the
  // admin-only kill switch stored in the database) AND arms the local radar;
  // flipping it off pauses the engine for the whole team.
  async function toggle() {
    if (!isAdmin) return;
    const next = !on;
    try {
      await setLeadEnginePaused({ data: { paused: !next } });
    } catch {
      toast("Couldn't reach the server to flip the engine — try again.", "error");
      return;
    }
    setConfig({ on: next, area: config.area.trim() || DEFAULT_AREA });
    toast(next ? "Radar is live — hunting leads." : "Radar powered down for the whole team.", "info");
    void router.invalidate();
  }

  return (
    <div className="p-4 md:p-6">
      <div className="relative h-[calc(100dvh-6.5rem)] min-h-[520px] overflow-hidden rounded-md border border-line bg-black shadow-sm">
        <OrbStage reps={users.map((u) => u.name)} live={live} feed={st.feed} />

        {/* Vignette so the scene falls off into darkness at the edges */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,0.12) 100%)",
          }}
        />

        {/* Status — top left */}
        <div className="pointer-events-none absolute left-5 top-5 select-none">
          <div className="flex items-center gap-2">
            <span
              className={
                "inline-block h-2 w-2 rounded-full " +
                (live ? "bg-signal" : "bg-faint/40")
              }
            />
            <span className="text-xs font-medium text-bone">
              {engine.paused
                ? "Lead engine paused — working the book"
                : st.paused
                ? "Session cap reached"
                : live
                  ? st.currentType
                    ? `Scanning ${st.currentType} — ${st.currentArea ?? ""}`
                    : "Radar spinning up…"
                  : "Standing by"}
            </span>
          </div>
          <div className="mt-1.5 font-mono text-[11px] text-faint">
            {st.imported} leads this session · {st.assigned} fired at the team
            {st.lastError ? <span className="text-red-600"> · {st.lastError}</span> : null}
          </div>
        </div>

        {/* The switch — top right, admin only */}
        {isAdmin ? (
          <button
            type="button"
            onClick={() => void toggle()}
            aria-pressed={on}
            className={
              "group absolute right-5 top-5 flex items-center gap-3 rounded-full border px-4 py-2 transition-all duration-300 " +
              (on
                ? "border-signal/50 bg-signal-soft"
                : "border-line-strong bg-surface/80 hover:border-signal/40")
            }
          >
            <span
              className={
                "text-xs font-medium " +
                (on ? "text-signal" : "text-mute group-hover:text-bone")
              }
            >
              {on ? "On" : "Off"}
            </span>
            <span
              className={
                "relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-300 " +
                (on ? "bg-signal" : "bg-surface-2")
              }
            >
              <span
                className={
                  "inline-block h-4 w-4 transform rounded-full bg-bone shadow transition-transform duration-300 " +
                  (on ? "translate-x-[18px]" : "translate-x-0.5")
                }
              />
            </span>
          </button>
        ) : null}

        {/* New-business feed — below the switch, admin only. Brand-new state
            registrations = the highest-intent cold lead there is. */}
        {isAdmin ? (
          <button
            type="button"
            onClick={() => void pullNewBusinesses()}
            disabled={pulling}
            className="absolute right-5 top-[3.9rem] rounded-full border border-line-strong bg-surface/80 px-4 py-1.5 text-xs font-medium text-mute transition-all duration-300 hover:border-signal/40 hover:text-bone disabled:opacity-60"
          >
            {pulling ? "Pulling filings…" : "🏢 New businesses"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
