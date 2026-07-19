// Nexraft brand marks, rebuilt as crisp vectors so they scale perfectly and can
// be recolored via CSS. Faithful to nexraft.com: a bone/cream "NEXRAFT."
// wordmark whose trailing period is the signature red-orange dot — no tile, no
// underline. The compact monogram carries the same bone "N" + orange dot.

const TILE = "#0e0e13"; // cool near-black tile (matches --color-surface)
const ACCENT = "#ff4d1c"; // Nexraft red-orange (the "." dot)
const BONE = "#e9e5db"; // cream wordmark

// Square monogram tile (sidebar, favicon, mobile bar): bone "N" over the warm
// near-black tile with the signature orange dot in the corner.
export function LogoMark({ size = 32, radius = 8 }: { size?: number; radius?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Nexraft"
    >
      <rect width="64" height="64" rx={radius * (64 / size)} fill={TILE} />
      <path
        d="M16 47V17h6.4l16 19.8V17H45v30h-6.4L22.4 27.2V47H16Z"
        fill={BONE}
      />
      <circle cx="47.5" cy="45.5" r="3.6" fill={ACCENT} />
    </svg>
  );
}

// Full wordmark for the auth screens: bone "NEXRAFT" with the orange period.
export function FullLogo({ className = "" }: { className?: string }) {
  return (
    <div className={"inline-flex items-baseline " + className}>
      <span
        className="font-display text-3xl font-extrabold uppercase tracking-[0.16em]"
        style={{ color: BONE }}
      >
        Nexraft
      </span>
      <span className="font-display text-3xl font-extrabold" style={{ color: ACCENT }}>
        .
      </span>
    </div>
  );
}

// Sidebar / header lockup: monogram + product name.
export function Wordmark({ small }: { small?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark size={small ? 28 : 32} radius={small ? 7 : 8} />
      <div className="leading-tight">
        <div className="font-display text-sm font-extrabold uppercase tracking-[0.08em] text-bone">
          Nexraft<span className="text-signal">_._</span>
        </div>
        {!small ? (
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">Sales OS</div>
        ) : null}
      </div>
    </div>
  );
}
