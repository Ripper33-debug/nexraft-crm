// ==================== Auto-discovery engine ====================
// Keeps quietly finding new local businesses while the CRM is open. When it's
// switched on with an area, it rotates through the best-fit business types,
// searches each via the keyless OpenStreetMap discovery, and auto-imports the
// strongest matches (band "hot" = no website + reachable) straight into the open
// pool, where they surface ranked on Opportunities for anyone to claim.
//
// It's deliberately gentle: one business type at a time, spaced out, hot-only so
// the pipeline fills with genuine prospects rather than noise, and capped per
// session so it can never run away. State lives in a tiny observable store so the
// engine (mounted app-wide in the layout) and the Discover page controls share
// exactly the same on/off + live status.

import { useSyncExternalStore } from "react";

import {
  discoverLeads,
  importDiscoveredLead,
  getConversionInsights,
  getLeadEngineState,
  type DiscoveredLead,
} from "./data";

export type AutoDiscoverConfig = { on: boolean; area: string };
export type AutoDiscoverStatus = {
  running: boolean;
  currentType: string | null;
  currentArea: string | null; // which state the scan is currently sweeping
  progress: number; // 0..1 through the current state's industry sweep
  imported: number; // this session
  assigned: number; // of those, how many were auto-assigned to a rep
  lastError: string | null;
  lastRunAt: number | null;
  paused: boolean; // hit the session cap
  // Rolling feed of the most recent auto-imports, newest last. `rep` is the
  // name of the rep the lead was auto-assigned to (null = landed in the open
  // pool). The orb stage on /discover watches this to fire lead-orbs from the
  // center at the right rep.
  feed: { id: number; lead: string; rep: string | null }[];
};

// The scan works one state at a time: it sweeps every industry across the whole
// state, then moves to the next. Starts from whichever state the user picks, then
// follows this order (a rough Southeast-first sweep up and across the country).
type Anchor = { label: string; query: string };
export const STATE_TOUR: Anchor[] = [
  ...[
    "Florida", "Georgia", "Alabama", "Mississippi", "Louisiana",
    "South Carolina", "North Carolina", "Tennessee", "Arkansas", "Texas",
    "Oklahoma", "Kentucky", "Virginia", "West Virginia", "Maryland",
    "Delaware", "New Jersey", "Pennsylvania", "New York", "Connecticut",
    "Rhode Island", "Massachusetts", "Vermont", "New Hampshire", "Maine",
    "Ohio", "Michigan", "Indiana", "Illinois", "Wisconsin",
    "Minnesota", "Iowa", "Missouri", "Kansas", "Nebraska",
    "South Dakota", "North Dakota", "Montana", "Wyoming", "Colorado",
    "New Mexico", "Arizona", "Utah", "Nevada", "Idaho",
    "Washington", "Oregon", "California", "Alaska", "Hawaii",
  ].map((name) => ({ label: name, query: `${name}, USA` })),
  // Once the US sweep wraps, the radar rolls north into Canada, province by
  // province, so the same engine keeps mining no-website businesses up there.
  ...[
    "Ontario", "Quebec", "British Columbia", "Alberta", "Manitoba",
    "Saskatchewan", "Nova Scotia", "New Brunswick",
    "Newfoundland and Labrador", "Prince Edward Island",
  ].map((name) => ({ label: name, query: `${name}, Canada` })),
];

// The rotation of best-fit business types the engine sweeps through. Ordered
// roughly by fit: home-service trades first (highest no-website rates + real
// retainer budgets), then professional/medical, then hospitality. Every label
// here must map to an osmFilters() branch in data.ts so the scan can find it.
export const AUTO_TYPES = [
  "Roofers",
  "Plumbers",
  "Electricians",
  "HVAC",
  "Contractors",
  "Landscapers",
  "Auto repair",
  "Dentists",
  "Veterinarians",
  "Med spas",
  "Chiropractors",
  "Accountants",
  "Law firms",
  "Real estate agents",
  "Salons",
  "Gyms",
  "Restaurants",
  "Cafes",
];

// Safety rails.
const SESSION_CAP = 250; // most auto-imports per open session (state sweep needs room)
const TYPE_DELAY_MS = 30_000; // pause between industry searches
const PER_TYPE_MAX = 6; // most imports taken from a single industry search

const STORAGE_KEY = "nx_autodiscover";
const CURSOR_KEY = "nx_autodiscover_cursor";

// The scan's bookmark: which state it was sweeping and how far through the
// industry rotation it was. Saved after every search so closing the CRM and
// coming back resumes exactly where it left off instead of restarting from the
// picked state and re-covering old ground.
type ScanCursor = { state: string; ti: number };

function loadCursor(): ScanCursor | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(CURSOR_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ScanCursor>;
    if (typeof parsed.state !== "string" || typeof parsed.ti !== "number") return null;
    return { state: parsed.state, ti: parsed.ti };
  } catch {
    return null;
  }
}

function saveCursor(cursor: ScanCursor) {
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(CURSOR_KEY, JSON.stringify(cursor));
    }
  } catch {
    /* ignore */
  }
}

// Learn from the pipeline: industries that have actually produced wins or
// "interested" calls get a second pass in every state's rotation, so the radar
// spends more of its time hunting what has historically turned into money.
// Falls back to the plain rotation if insights aren't available.
async function buildRotation(): Promise<string[]> {
  try {
    const { insights } = await getConversionInsights();
    const score = new Map<string, number>();
    for (const i of insights) {
      score.set(i.industry.toLowerCase(), i.won * 3 + i.interested);
    }
    const winners = AUTO_TYPES.filter((t) => (score.get(t.toLowerCase()) ?? 0) > 0)
      .sort((a, b) => (score.get(b.toLowerCase()) ?? 0) - (score.get(a.toLowerCase()) ?? 0))
      .slice(0, 3);
    return winners.length > 0 ? [...AUTO_TYPES, ...winners] : [...AUTO_TYPES];
  } catch {
    return [...AUTO_TYPES];
  }
}

const DEFAULT_CONFIG: AutoDiscoverConfig = { on: false, area: "" };
const DEFAULT_STATUS: AutoDiscoverStatus = {
  running: false,
  currentType: null,
  currentArea: null,
  progress: 0,
  imported: 0,
  assigned: 0,
  lastError: null,
  lastRunAt: null,
  paused: false,
  feed: [],
};

const FEED_MAX = 8;
let feedSeq = 0;

let config: AutoDiscoverConfig = DEFAULT_CONFIG;
let status: AutoDiscoverStatus = DEFAULT_STATUS;
let hydrated = false;

const listeners = new Set<() => void>();
function emit() {
  for (const l of listeners) l();
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

// Pull persisted config the first time we're on the client.
function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AutoDiscoverConfig>;
      config = { on: Boolean(parsed.on), area: typeof parsed.area === "string" ? parsed.area : "" };
    }
  } catch {
    /* ignore malformed storage */
  }
}

export function getConfig(): AutoDiscoverConfig {
  hydrate();
  return config;
}
export function getStatus(): AutoDiscoverStatus {
  return status;
}

export function setConfig(next: AutoDiscoverConfig) {
  config = next;
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    }
  } catch {
    /* ignore */
  }
  emit();
}

function patchStatus(patch: Partial<AutoDiscoverStatus>) {
  status = { ...status, ...patch };
  emit();
}

// Stable snapshots for SSR so useSyncExternalStore stays happy.
export function useAutoConfig(): AutoDiscoverConfig {
  return useSyncExternalStore(subscribe, getConfig, () => DEFAULT_CONFIG);
}
export function useAutoStatus(): AutoDiscoverStatus {
  return useSyncExternalStore(subscribe, getStatus, () => DEFAULT_STATUS);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Rotate the fixed state tour so it BEGINS with whichever state the user picked,
// then follows the rest of the list in order. e.g. pick "Florida, USA" → the
// sweep starts in Florida and rolls on to Georgia, Alabama, … from there.
function buildStateTour(start: string): Anchor[] {
  const startLabel = start.replace(/,\s*(USA|Canada)$/i, "").trim().toLowerCase();
  const idx = STATE_TOUR.findIndex((s) => s.label.toLowerCase() === startLabel);
  if (idx < 0) {
    // Unknown label — just search it first, then the whole standard tour.
    const first = { label: start.replace(/,\s*(USA|Canada)$/i, "").trim(), query: start };
    return [first, ...STATE_TOUR];
  }
  return [...STATE_TOUR.slice(idx), ...STATE_TOUR.slice(0, idx)];
}

// Runs one full engine session. `cancelled` lets the caller stop it (config off /
// unmount). `onImported` is fired so the layout can refresh the router when new
// leads land. Returns when cancelled or the session cap is reached.
export async function runAutoDiscovery(
  getArea: () => string,
  isCancelled: () => boolean,
  onImported: () => void,
) {
  // Master pause: an admin can switch the whole engine off from Discover, so
  // the radar never starts a session while that kill switch is on. If the
  // check itself fails, err on the side of staying quiet.
  const engine = await getLeadEngineState().catch(() => ({ paused: true }));
  if (engine.paused) {
    patchStatus({ ...DEFAULT_STATUS, running: false, paused: true });
    return;
  }
  patchStatus({ ...DEFAULT_STATUS, running: true });
  // Weight the industry rotation by what's actually converted (wins/interest
  // double up), then pick up from the saved bookmark if there is one.
  const rotation = await buildRotation();
  const cursor = loadCursor();
  let ti = cursor ? ((cursor.ti % rotation.length) + rotation.length) % rotation.length : 0;
  let ai = 0; // which state in the tour we're sweeping
  let resumedFrom = cursor?.state ?? null;
  while (!isCancelled()) {
    const start = getArea().trim();
    if (!start) {
      await sleep(2000);
      continue;
    }
    if (status.imported >= SESSION_CAP) {
      patchStatus({ running: true, paused: true, currentType: null, currentArea: null, progress: 1 });
      return; // done for this session
    }

    // The tour is the states in order, but rotated to begin with whichever state
    // the user picked — so it starts there (e.g. Florida) and moves on state by
    // state from that point.
    const tour = buildStateTour(start);
    // First pass only: jump to the bookmarked state so the sweep resumes where
    // it left off last session rather than restarting from the picked state.
    if (resumedFrom) {
      const idx = tour.findIndex((s) => s.label.toLowerCase() === resumedFrom?.toLowerCase());
      if (idx >= 0) ai = idx;
      resumedFrom = null;
    }
    const state = tour[ai % tour.length];

    const type = rotation[ti % rotation.length];
    const progress = (ti % rotation.length) / rotation.length;
    ti++;
    patchStatus({ currentType: type, currentArea: state.label, progress, lastRunAt: Date.now() });

    try {
      // No radiusKm → discoverLeads searches the whole state's bounding box.
      const res = await discoverLeads({ data: { businessType: type, area: state.query, limit: 40 } });
      if (isCancelled()) break;
      if (!res.ok) {
        patchStatus({ lastError: res.error ?? "Search failed." });
      } else {
        patchStatus({ lastError: null });
        // Good-fit only: businesses with NO website (they need exactly what we
        // sell) that score "hot", aren't already in the CRM, AND have a phone or
        // email — no point importing a lead we've got no way to contact.
        const targets = (res.leads as DiscoveredLead[])
          .filter(
            (l) =>
              l.band === "hot" &&
              !l.website &&
              !l.already_in_crm &&
              (Boolean(l.phone) || Boolean(l.email)),
          )
          .slice(0, PER_TYPE_MAX);
        let importedNow = 0;
        for (const l of targets) {
          if (isCancelled() || status.imported >= SESSION_CAP) break;
          try {
            const imp = await importDiscoveredLead({
              data: {
                name: l.name,
                industry: l.industry,
                website: l.website,
                phone: l.phone,
                email: l.email,
                city: l.city,
                autoAssign: true, // let the server flip a coin: ~half go to a rep
              },
            });
            if (imp.ok && !imp.duplicate) {
              importedNow++;
              feedSeq++;
              patchStatus({
                imported: status.imported + 1,
                assigned: status.assigned + (imp.assignedTo ? 1 : 0),
                feed: [
                  ...status.feed.slice(-(FEED_MAX - 1)),
                  { id: feedSeq, lead: l.name, rep: imp.assignedTo ?? null },
                ],
              });
            }
          } catch {
            /* skip this lead, keep going */
          }
        }
        if (importedNow > 0) onImported();
      }
    } catch {
      patchStatus({ lastError: "Couldn't reach the map service." });
    }

    // Sweep EVERY industry across the whole state first (dentists, plumbers,
    // roofers, …) so a state is fully mined before we move on. Once every industry
    // has been swept for this state, hop to the next state in the tour.
    if (ti % rotation.length === 0) {
      ai++;
    }
    // Bookmark AFTER the advance so a resume lands on the next unsearched
    // state+industry, not back at the start of ground we've already covered.
    saveCursor({ state: tour[ai % tour.length].label, ti: ti % rotation.length });

    if (isCancelled()) break;
    await sleep(TYPE_DELAY_MS);
  }
  patchStatus({ running: false, currentType: null, currentArea: null });
}
