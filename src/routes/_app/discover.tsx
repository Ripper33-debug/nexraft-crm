import { createFileRoute, useRouteContext } from "@tanstack/react-router";

import { getUsers } from "../../lib/crm/data";
import { toast } from "../../components/crm/toast";
import { useAutoConfig, useAutoStatus, setConfig } from "../../lib/crm/autodiscover";
import { LEAD_ENGINE_PAUSED } from "../../lib/crm/constants";
import { OrbStage } from "../../components/crm/orbstage";

// The Discover page is now a single living scene: the molten LEADS orb in the
// middle, every teammate orbiting it as a named orb, and lead-orbs firing from
// the center at whichever rep the radar assigns each find to. One switch —
// admin only — turns the radar on and off. Nothing else.
export const Route = createFileRoute("/_app/discover")({
  component: DiscoverPage,
  loader: async () => {
    const users = await getUsers();
    return { users };
  },
});

const DEFAULT_AREA = "Florida, USA";

function DiscoverPage() {
  const { users } = Route.useLoaderData();
  const { user } = useRouteContext({ from: "/_app" }) as { user?: { role?: string } };
  const isAdmin = user?.role === "admin";
  const config = useAutoConfig();
  const st = useAutoStatus();
  const live = !LEAD_ENGINE_PAUSED && config.on && !st.paused;

  function toggle() {
    if (!isAdmin) return;
    if (LEAD_ENGINE_PAUSED) {
      toast("Lead engine is paused for now — the team is working the companies they have.", "info");
      return;
    }
    const next = !config.on;
    setConfig({ on: next, area: config.area.trim() || DEFAULT_AREA });
    toast(next ? "Radar is live — hunting leads." : "Radar powered down.", "info");
  }

  return (
    <div className="p-4 md:p-6">
      <div className="relative h-[calc(100dvh-6.5rem)] min-h-[520px] overflow-hidden rounded-2xl border border-line bg-black shadow-2xl shadow-black/40">
        <OrbStage reps={users.map((u) => u.name)} live={live} feed={st.feed} />

        {/* Vignette so the scene falls off into darkness at the edges */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,0.55) 100%)",
          }}
        />

        {/* Status — top left */}
        <div className="pointer-events-none absolute left-5 top-5 select-none">
          <div className="flex items-center gap-2">
            <span
              className={
                "inline-block h-2 w-2 rounded-full " +
                (live ? "bg-signal shadow-[0_0_8px_rgba(249,110,60,0.9)]" : "bg-faint/40")
              }
            />
            <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-bone">
              {LEAD_ENGINE_PAUSED
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
            {st.lastError ? <span className="text-red-400"> · {st.lastError}</span> : null}
          </div>
        </div>

        {/* The switch — top right, admin only */}
        {isAdmin ? (
          <button
            type="button"
            onClick={toggle}
            aria-pressed={config.on}
            className={
              "group absolute right-5 top-5 flex items-center gap-3 rounded-full border px-4 py-2 transition-all duration-300 " +
              (config.on
                ? "border-signal/50 bg-signal-soft shadow-[0_0_24px_rgba(255,77,28,0.25)]"
                : "border-line-strong bg-surface/80 hover:border-signal/40")
            }
          >
            <span
              className={
                "font-mono text-[11px] font-bold uppercase tracking-[0.2em] " +
                (config.on ? "text-signal" : "text-mute group-hover:text-bone")
              }
            >
              {config.on ? "On" : "Off"}
            </span>
            <span
              className={
                "relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-300 " +
                (config.on ? "bg-signal" : "bg-surface-2")
              }
            >
              <span
                className={
                  "inline-block h-4 w-4 transform rounded-full bg-bone shadow transition-transform duration-300 " +
                  (config.on ? "translate-x-[18px]" : "translate-x-0.5")
                }
              />
            </span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
