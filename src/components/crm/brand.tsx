// Nexraft brand marks, rebuilt as crisp vectors so they scale perfectly and can
// be recolored via CSS. Faithful to nexraft.com: a bone/cream "NEXRAFT."
// wordmark whose trailing period is the signature red-orange dot — no tile, no
// underline. The compact monogram carries the same bone "N" + orange dot.

const TILE = "#0e0e13"; // cool near-black tile — the logo chip stays dark on the light UI
const ACCENT = "#ff4d1c"; // Nexraft red-orange (the "." dot)
const BONE = "#e9e5db"; // cream — only used INSIDE the dark tile, where it still reads
const WORD = "var(--color-bone)"; // wordmark text follows the app's primary text color

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

// Full wordmark for the auth screens: bone "NEX", orange "RAFT" (Barry's call).
export function FullLogo({ className = "" }: { className?: string }) {
  return (
    <div className={"inline-flex items-baseline " + className}>
      <span
        className="font-display text-3xl font-extrabold uppercase tracking-[0.16em]"
        style={{ color: WORD }}
      >
        Nex
      </span>
      <span
        className="font-display text-3xl font-extrabold uppercase tracking-[0.16em]"
        style={{ color: ACCENT }}
      >
        raft
      </span>
    </div>
  );
}

// Sidebar / header lockup: monogram + product name. The mark tips in 3D toward
// the cursor on hover — a small "alive" moment every time you glance at it.
export function Wordmark({ small }: { small?: boolean }) {
  return (
    <div className="group flex items-center gap-2.5" style={{ perspective: "480px" }}>
      <span className="inline-flex transition-transform duration-300 ease-out will-change-transform group-hover:[transform:rotateY(-16deg)_rotateX(8deg)_scale(1.06)]">
        <LogoMark size={small ? 28 : 32} radius={small ? 7 : 8} />
      </span>
      <div className="leading-tight">
        <div className="font-display text-sm font-extrabold uppercase tracking-[0.08em] text-bone">
          Nex<span className="text-signal">raft</span>
        </div>
        {!small ? (
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">Sales OS</div>
        ) : null}
      </div>
    </div>
  );
}
