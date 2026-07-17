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

import { discoverLeads, importDiscoveredLead, type DiscoveredLead } from "./data";

export type AutoDiscoverConfig = { on: boolean; area: string };
export type AutoDiscoverStatus = {
  running: boolean;
  currentType: string | null;
  radiusKm: number; // how far out the scan has expanded
  imported: number; // this session
  assigned: number; // of those, how many were auto-assigned to a rep
  lastError: string | null;
  lastRunAt: number | null;
  paused: boolean; // hit the session cap
};

// The rotation of best-fit business types the engine sweeps through.
export const AUTO_TYPES = [
  "Roofers",
  "Plumbers",
  "Dentists",
  "Law firms",
  "Contractors",
  "Auto repair",
  "Salons",
  "Chiropractors",
  "Real estate agents",
  "Gyms",
  "Restaurants",
  "Cafes",
];

// Safety rails.
const SESSION_CAP = 60; // most auto-imports per open session
const TYPE_DELAY_MS = 30_000; // pause between business types
const PER_TYPE_MAX = 6; // most imports taken from a single search pass

// Expanding "radar" scan: start tight around the center, ring outward each pass.
const RADIUS_START = 10; // km
const RADIUS_STEP = 6; // grow each scan
const RADIUS_MAX = 90; // then hold at the outer edge

const STORAGE_KEY = "nx_autodiscover";

const DEFAULT_CONFIG: AutoDiscoverConfig = { on: false, area: "" };
const DEFAULT_STATUS: AutoDiscoverStatus = {
  running: false,
  currentType: null,
  radiusKm: RADIUS_START,
  imported: 0,
  assigned: 0,
  lastError: null,
  lastRunAt: null,
  paused: false,
};

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

// Runs one full engine session. `cancelled` lets the caller stop it (config off /
// unmount). `onImported` is fired so the layout can refresh the router when new
// leads land. Returns when cancelled or the session cap is reached.
export async function runAutoDiscovery(
  getArea: () => string,
  isCancelled: () => boolean,
  onImported: () => void,
) {
  patchStatus({ ...DEFAULT_STATUS, running: true });
  let ti = 0;
  let radius = RADIUS_START;
  while (!isCancelled()) {
    const area = getArea().trim();
    if (!area) {
      await sleep(2000);
      continue;
    }
    if (status.imported >= SESSION_CAP) {
      patchStatus({ running: true, paused: true, currentType: null });
      return; // done for this session
    }

    const type = AUTO_TYPES[ti % AUTO_TYPES.length];
    ti++;
    patchStatus({ currentType: type, radiusKm: radius, lastRunAt: Date.now() });

    try {
      const res = await discoverLeads({ data: { businessType: type, area, limit: 20, radiusKm: radius } });
      if (isCancelled()) break;
      if (!res.ok) {
        patchStatus({ lastError: res.error ?? "Search failed." });
      } else {
        patchStatus({ lastError: null });
        const targets = (res.leads as DiscoveredLead[])
          .filter((l) => l.band === "hot" && !l.already_in_crm)
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
                city: l.city,
                autoAssign: true, // let the server flip a coin: ~half go to a rep
              },
            });
            if (imp.ok && !imp.duplicate) {
              importedNow++;
              patchStatus({
                imported: status.imported + 1,
                assigned: status.assigned + (imp.assignedTo ? 1 : 0),
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

    // Ring outward for the next pass, holding at the outer edge.
    radius = Math.min(RADIUS_MAX, radius + RADIUS_STEP);

    if (isCancelled()) break;
    await sleep(TYPE_DELAY_MS);
  }
  patchStatus({ running: false, currentType: null });
}
