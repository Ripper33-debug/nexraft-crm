// An interactive US map for steering the auto-discover radar. Rendered as a
// stylized tile-grid map (each state a square, positioned roughly geographically)
// so it's compact, fully clickable, and matches the dark radar aesthetic without
// needing heavyweight geographic path data. Click a state to drop the radar there.

export type USState = { abbr: string; name: string; col: number; row: number };

// col: 0 (west) .. 10 (east); row: 0 (north) .. 6 (south).
export const US_STATES: USState[] = [
  { abbr: "AK", name: "Alaska", col: 0, row: 0 },
  { abbr: "WA", name: "Washington", col: 0, row: 1 },
  { abbr: "OR", name: "Oregon", col: 0, row: 2 },
  { abbr: "CA", name: "California", col: 0, row: 3 },
  { abbr: "HI", name: "Hawaii", col: 0, row: 5 },
  { abbr: "MT", name: "Montana", col: 1, row: 1 },
  { abbr: "ID", name: "Idaho", col: 1, row: 2 },
  { abbr: "NV", name: "Nevada", col: 1, row: 3 },
  { abbr: "AZ", name: "Arizona", col: 1, row: 4 },
  { abbr: "ND", name: "North Dakota", col: 2, row: 1 },
  { abbr: "WY", name: "Wyoming", col: 2, row: 2 },
  { abbr: "UT", name: "Utah", col: 2, row: 3 },
  { abbr: "NM", name: "New Mexico", col: 2, row: 4 },
  { abbr: "MN", name: "Minnesota", col: 3, row: 1 },
  { abbr: "SD", name: "South Dakota", col: 3, row: 2 },
  { abbr: "CO", name: "Colorado", col: 3, row: 3 },
  { abbr: "KS", name: "Kansas", col: 3, row: 4 },
  { abbr: "OK", name: "Oklahoma", col: 3, row: 5 },
  { abbr: "TX", name: "Texas", col: 3, row: 6 },
  { abbr: "IA", name: "Iowa", col: 4, row: 2 },
  { abbr: "NE", name: "Nebraska", col: 4, row: 3 },
  { abbr: "AR", name: "Arkansas", col: 4, row: 4 },
  { abbr: "LA", name: "Louisiana", col: 4, row: 5 },
  { abbr: "WI", name: "Wisconsin", col: 5, row: 1 },
  { abbr: "IL", name: "Illinois", col: 5, row: 2 },
  { abbr: "MO", name: "Missouri", col: 5, row: 3 },
  { abbr: "TN", name: "Tennessee", col: 5, row: 4 },
  { abbr: "MS", name: "Mississippi", col: 5, row: 5 },
  { abbr: "IN", name: "Indiana", col: 6, row: 2 },
  { abbr: "KY", name: "Kentucky", col: 6, row: 3 },
  { abbr: "NC", name: "North Carolina", col: 6, row: 4 },
  { abbr: "AL", name: "Alabama", col: 6, row: 5 },
  { abbr: "MI", name: "Michigan", col: 7, row: 1 },
  { abbr: "OH", name: "Ohio", col: 7, row: 2 },
  { abbr: "WV", name: "West Virginia", col: 7, row: 3 },
  { abbr: "SC", name: "South Carolina", col: 7, row: 4 },
  { abbr: "GA", name: "Georgia", col: 7, row: 5 },
  { abbr: "PA", name: "Pennsylvania", col: 8, row: 2 },
  { abbr: "VA", name: "Virginia", col: 8, row: 3 },
  { abbr: "DC", name: "District of Columbia", col: 8, row: 4 },
  { abbr: "FL", name: "Florida", col: 8, row: 6 },
  { abbr: "VT", name: "Vermont", col: 9, row: 0 },
  { abbr: "NY", name: "New York", col: 9, row: 1 },
  { abbr: "NJ", name: "New Jersey", col: 9, row: 2 },
  { abbr: "MD", name: "Maryland", col: 9, row: 3 },
  { abbr: "DE", name: "Delaware", col: 9, row: 4 },
  { abbr: "ME", name: "Maine", col: 10, row: 0 },
  { abbr: "NH", name: "New Hampshire", col: 10, row: 1 },
  { abbr: "MA", name: "Massachusetts", col: 10, row: 2 },
  { abbr: "CT", name: "Connecticut", col: 10, row: 3 },
  { abbr: "RI", name: "Rhode Island", col: 10, row: 4 },
];

// Given the engine's saved area string (e.g. "Florida, USA"), figure out which
// tile to highlight. Matches on the leading state name.
export function stateAbbrFromArea(area: string | null | undefined): string | null {
  if (!area) return null;
  const a = area.trim().toLowerCase();
  // Longest names first so "west virginia" wins over "virginia".
  const byLen = [...US_STATES].sort((x, y) => y.name.length - x.name.length);
  return byLen.find((s) => a.startsWith(s.name.toLowerCase()))?.abbr ?? null;
}

export function USStatePicker({
  selected,
  onPick,
}: {
  selected: string | null;
  onPick: (s: USState) => void;
}) {
  return (
    <div
      className="grid w-full max-w-[340px] gap-[3px]"
      style={{ gridTemplateColumns: "repeat(11, minmax(0, 1fr))" }}
      role="group"
      aria-label="Pick a state to search"
    >
      {US_STATES.map((s) => {
        const isSel = selected === s.abbr;
        return (
          <button
            key={s.abbr}
            type="button"
            title={s.name}
            aria-pressed={isSel}
            onClick={() => onPick(s)}
            style={{ gridColumnStart: s.col + 1, gridRowStart: s.row + 1 }}
            className={
              "flex aspect-square items-center justify-center rounded-[3px] border font-mono text-[8px] leading-none transition-colors sm:text-[9px] " +
              (isSel
                ? "border-signal bg-signal text-black shadow-[0_0_10px_rgba(45,212,191,0.5)]"
                : "border-white/5 bg-surface-2 text-mute hover:border-signal/40 hover:text-bone")
            }
          >
            {s.abbr}
          </button>
        );
      })}
    </div>
  );
}
