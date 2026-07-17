// A live radar scope for the auto-discovery sweep. Purely presentational: it
// takes the current engine status and renders a rotating beam, concentric range
// rings, an expanding radius, and a blip for each lead found (newest ping in).
// Animation only runs while the scan is on; off/paused states dim gracefully.

const R_START = 10; // km, matches autodiscover.ts
const R_MAX = 240;
const MAX_BLIPS = 40;

// Deterministic scatter so blips sit still between renders. Golden-angle spread
// for the bearing, a hashed fraction for the range.
function blipPos(i: number): { x: number; y: number } {
  const ang = i * 137.508 * (Math.PI / 180);
  const h = Math.sin(i * 99.13 + 0.7) * 10000;
  const rf = 0.2 + (h - Math.floor(h)) * 0.72; // 0.20 .. 0.92 of scope radius
  return { x: 50 + Math.cos(ang) * rf * 45, y: 50 + Math.sin(ang) * rf * 45 };
}

export function RadarScope({
  on,
  currentType,
  currentArea,
  radiusKm,
  imported,
  paused,
}: {
  on: boolean;
  currentType: string | null;
  currentArea?: string | null;
  radiusKm: number;
  imported: number;
  paused: boolean;
}) {
  // Expanding range ring as a fraction of the scope (grows 10km→240km).
  const frac = Math.max(0, Math.min(1, (radiusKm - R_START) / (R_MAX - R_START)));
  const ringPct = 20 + frac * 78; // 20% .. 98% diameter

  const total = Math.min(imported, MAX_BLIPS);
  const start = Math.max(0, imported - MAX_BLIPS); // keep newest when over cap
  const blips = Array.from({ length: total }, (_, k) => start + k);

  return (
    <div className="flex flex-col items-center">
      <div
        className="relative aspect-square w-full max-w-[260px] rounded-full border border-signal/25"
        style={{
          background:
            "radial-gradient(circle at center, rgba(45,212,191,0.08), rgba(11,16,13,0.9) 72%)",
          boxShadow: "inset 0 0 40px rgba(45,212,191,0.08)",
        }}
      >
        {/* concentric range rings */}
        {[33, 66].map((p) => (
          <div
            key={p}
            className="absolute rounded-full border border-signal/15"
            style={{ inset: `${(100 - p) / 2}%` }}
          />
        ))}
        {/* crosshairs */}
        <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-signal/10" />
        <div className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-signal/10" />

        {/* expanding radius ring */}
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border transition-all duration-1000 ease-out"
          style={{
            width: `${ringPct}%`,
            height: `${ringPct}%`,
            borderColor: "rgba(45,212,191,0.55)",
            boxShadow: on ? "0 0 12px rgba(45,212,191,0.25)" : "none",
          }}
        />

        {/* rotating sweep beam */}
        {on && !paused ? (
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background:
                "conic-gradient(from 0deg, rgba(45,212,191,0) 0deg, rgba(45,212,191,0) 288deg, rgba(45,212,191,0.05) 320deg, rgba(45,212,191,0.35) 356deg, rgba(45,212,191,0.7) 360deg)",
              animation: "nx-radar-spin 4s linear infinite",
              maskImage: "radial-gradient(circle at center, #000 99%, transparent 100%)",
              WebkitMaskImage: "radial-gradient(circle at center, #000 99%, transparent 100%)",
            }}
          />
        ) : null}

        {/* blips */}
        {blips.map((i) => {
          const { x, y } = blipPos(i);
          return (
            <div
              key={i}
              className="absolute"
              style={{ left: `${x}%`, top: `${y}%`, transform: "translate(-50%,-50%)" }}
            >
              <div
                className="absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-signal/60"
                style={{ animation: "nx-radar-ping 1.6s ease-out 1" }}
              />
              <div
                className="h-1.5 w-1.5 rounded-full bg-signal"
                style={{
                  boxShadow: "0 0 6px rgba(45,212,191,0.9)",
                  animation: "nx-blip-in 500ms ease-out both",
                }}
              />
            </div>
          );
        })}

        {/* center hub */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <div
            className="h-2 w-2 rounded-full bg-signal"
            style={{ boxShadow: "0 0 8px rgba(45,212,191,0.9)" }}
          />
        </div>

        {/* range readout */}
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 whitespace-nowrap font-mono text-[10px] tracking-wide text-signal/70">
          {on ? `~${radiusKm} km` : "standby"}
        </div>
      </div>

      <div className="mt-2 text-center text-[11px] text-mute">
        {paused ? (
          <span className="text-amber-300">Session limit reached — {imported} found</span>
        ) : on ? (
          <span>
            {currentType ? (
              <>
                <span className="text-signal">{currentType}</span>
                {currentArea ? <> · {currentArea}</> : null} · {imported} found
              </>
            ) : (
              <>Warming up… · {imported} found</>
            )}
          </span>
        ) : (
          <span className="text-faint">Radar on standby</span>
        )}
      </div>

      <style>{`
        @keyframes nx-radar-spin { to { transform: rotate(360deg); } }
        @keyframes nx-blip-in { from { opacity: 0; transform: scale(0); } to { opacity: 1; transform: scale(1); } }
        @keyframes nx-radar-ping { 0% { opacity: 0.8; transform: translate(-50%,-50%) scale(0.4); } 100% { opacity: 0; transform: translate(-50%,-50%) scale(2.6); } }
      `}</style>
    </div>
  );
}
