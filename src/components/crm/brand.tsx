// Nexraft brand marks, rebuilt as crisp vectors so they scale perfectly and can
// be recolored via CSS. Faithful to nexraft.com: a bone/cream "NEXRAFT."
// wordmark whose trailing period is the signature accent dot — no tile, no
// underline. The compact monogram carries the same bone "N" + accent dot.

// Light theme: the CRM's marks use near-black tile (neutral, clean) with
// the signal accent for the period dot.
const TILE = "#171717"; // clean near-black tile (Comp AI foreground)
const ACCENT = "#006b4f"; // Comp AI green dot — matches the app's primary accent
const BONE = "#fafafa"; // off-white for legibility inside the dark tile
const WORD = "var(--color-bone)"; // wordmark text follows the app's primary text color

// Square monogram tile (sidebar, favicon, mobile bar): bone "N" over the warm
// near-black tile with the green accent dot in the corner.
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

// Full wordmark for the auth screens: serif "Nexraft" in ink with the brass
// period — private-bank stationery, not a tech logotype.
export function FullLogo({ className = "" }: { className?: string }) {
  return (
    <div className={"inline-flex items-baseline " + className}>
      <span className="font-display text-3xl font-semibold tracking-[-0.01em]" style={{ color: WORD }}>
        Nexraft
      </span>
      <span className="font-display text-3xl font-semibold" style={{ color: ACCENT }}>
        .
      </span>
    </div>
  );
}

// Sidebar / header lockup: monogram + product name, flat product chrome.
// `onDark` renders the light-on-dark version for dark surfaces.
export function Wordmark({ small, onDark }: { small?: boolean; onDark?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="inline-flex">
        <LogoMark size={small ? 28 : 32} radius={small ? 7 : 8} />
      </span>
      <div className="leading-tight">
        <div
          className="font-display text-[15px] font-semibold tracking-[-0.01em]"
          style={{ color: onDark ? BONE : "var(--color-bone)" }}
        >
          Nexraft<span style={{ color: ACCENT }}>.</span>
        </div>
        {!small ? (
          <div
            className="font-mono text-[10px] uppercase tracking-[0.14em]"
            style={{ color: onDark ? "#8a8a8a" : "var(--color-faint)" }}
          >
            Sales OS
          </div>
        ) : null}
      </div>
    </div>
  );
}
