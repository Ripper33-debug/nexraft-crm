// State picker for the auto-discover radar. Instead of a fiddly tile map, states
// are grouped into big, tappable regional buttons: pick a region to reveal its
// states, then tap a state to drop the radar there. Compact, readable, and easy
// to use on any screen, matching the dark radar aesthetic.

import { useState } from "react";

export type USState = { abbr: string; name: string };

type Region = { name: string; states: USState[] };

const S = (abbr: string, name: string): USState => ({ abbr, name });

// Roughly ordered to follow the sweep (Southeast first, since that's where the
// tour begins). Every state + DC appears exactly once.
export const US_REGIONS: Region[] = [
  {
    name: "Southeast",
    states: [
      S("FL", "Florida"),
      S("GA", "Georgia"),
      S("AL", "Alabama"),
      S("MS", "Mississippi"),
      S("LA", "Louisiana"),
      S("SC", "South Carolina"),
      S("NC", "North Carolina"),
      S("TN", "Tennessee"),
      S("AR", "Arkansas"),
      S("KY", "Kentucky"),
    ],
  },
  {
    name: "South Central",
    states: [S("TX", "Texas"), S("OK", "Oklahoma")],
  },
  {
    name: "Mid-Atlantic",
    states: [
      S("VA", "Virginia"),
      S("WV", "West Virginia"),
      S("MD", "Maryland"),
      S("DC", "District of Columbia"),
      S("DE", "Delaware"),
      S("NJ", "New Jersey"),
      S("PA", "Pennsylvania"),
      S("NY", "New York"),
    ],
  },
  {
    name: "Northeast",
    states: [
      S("CT", "Connecticut"),
      S("RI", "Rhode Island"),
      S("MA", "Massachusetts"),
      S("VT", "Vermont"),
      S("NH", "New Hampshire"),
      S("ME", "Maine"),
    ],
  },
  {
    name: "Midwest",
    states: [
      S("OH", "Ohio"),
      S("MI", "Michigan"),
      S("IN", "Indiana"),
      S("IL", "Illinois"),
      S("WI", "Wisconsin"),
      S("MN", "Minnesota"),
      S("IA", "Iowa"),
      S("MO", "Missouri"),
      S("KS", "Kansas"),
      S("NE", "Nebraska"),
    ],
  },
  {
    name: "Mountain",
    states: [
      S("CO", "Colorado"),
      S("UT", "Utah"),
      S("ID", "Idaho"),
      S("MT", "Montana"),
      S("WY", "Wyoming"),
      S("ND", "North Dakota"),
      S("SD", "South Dakota"),
    ],
  },
  {
    name: "Southwest",
    states: [S("AZ", "Arizona"), S("NM", "New Mexico"), S("NV", "Nevada")],
  },
  {
    name: "West Coast",
    states: [S("CA", "California"), S("OR", "Oregon"), S("WA", "Washington")],
  },
  {
    name: "Non-contiguous",
    states: [S("AK", "Alaska"), S("HI", "Hawaii")],
  },
];

// Flat list of every state, handy for name/abbr lookups.
export const US_STATES: USState[] = US_REGIONS.flatMap((r) => r.states);

// Given the engine's saved area string (e.g. "Florida, USA"), figure out which
// state to highlight. Matches on the leading state name.
export function stateAbbrFromArea(area: string | null | undefined): string | null {
  if (!area) return null;
  const a = area.trim().toLowerCase();
  // Longest names first so "west virginia" wins over "virginia".
  const byLen = [...US_STATES].sort((x, y) => y.name.length - x.name.length);
  return byLen.find((s) => a.startsWith(s.name.toLowerCase()))?.abbr ?? null;
}

function regionOfAbbr(abbr: string | null): string {
  if (!abbr) return US_REGIONS[0].name;
  return US_REGIONS.find((r) => r.states.some((s) => s.abbr === abbr))?.name ?? US_REGIONS[0].name;
}

export function USStatePicker({
  selected,
  onPick,
}: {
  selected: string | null;
  onPick: (s: USState) => void;
}) {
  const [openRegion, setOpenRegion] = useState<string>(() => regionOfAbbr(selected));
  const active = US_REGIONS.find((r) => r.name === openRegion) ?? US_REGIONS[0];

  return (
    <div className="w-full max-w-[380px]" role="group" aria-label="Pick a state to search">
      {/* Region selector */}
      <div className="flex flex-wrap gap-1.5">
        {US_REGIONS.map((r) => {
          const isOpen = r.name === active.name;
          const hasSel = selected != null && r.states.some((s) => s.abbr === selected);
          return (
            <button
              key={r.name}
              type="button"
              onClick={() => setOpenRegion(r.name)}
              aria-pressed={isOpen}
              className={
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors " +
                (isOpen
                  ? "border-signal/70 bg-signal/15 text-bone"
                  : "border-white/5 bg-surface-2 text-mute hover:border-signal/40 hover:text-bone") +
                (hasSel && !isOpen ? " ring-1 ring-signal/50" : "")
              }
            >
              {r.name}
            </button>
          );
        })}
      </div>

      {/* States within the open region */}
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {active.states.map((s) => {
          const isSel = selected === s.abbr;
          return (
            <button
              key={s.abbr}
              type="button"
              title={s.name}
              aria-pressed={isSel}
              onClick={() => onPick(s)}
              className={
                "rounded-md border px-2.5 py-1.5 text-xs transition-colors " +
                (isSel
                  ? "border-signal bg-signal text-black shadow-[0_0_10px_rgba(45,212,191,0.5)]"
                  : "border-white/5 bg-surface-2 text-bone hover:border-signal/50 hover:bg-surface-3")
              }
            >
              {s.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
