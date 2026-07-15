// Nexraft brand marks, rebuilt as crisp vectors so they scale perfectly and can
// be recolored via CSS. Faithful to the uploaded logo: bold white wordmark on a
// deep-green tile with a bright-green underline accent.

const TILE = "#0e1f17"; // deep green background
const ACCENT = "#35df80"; // bright green underline

// Square monogram tile (sidebar, favicon, mobile bar): white "N" over the deep
// green tile with the signature underline bar.
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
        d="M18 46V18h6.2l15.6 19.2V18H46v28h-6.2L24.2 26.8V46H18Z"
        fill="#ffffff"
      />
      <rect x="18" y="49.5" width="28" height="4.5" rx="2.25" fill={ACCENT} />
    </svg>
  );
}

// Full wordmark for the auth screens: "NEXRAFT" on a tile with the underline.
export function FullLogo({ className = "" }: { className?: string }) {
  return (
    <div
      className={"inline-flex flex-col items-center rounded-2xl px-6 py-4 " + className}
      style={{ backgroundColor: TILE }}
    >
      <span className="text-2xl font-extrabold tracking-[0.18em] text-white">NEXRAFT</span>
      <span
        className="mt-1.5 h-1 w-16 rounded-full"
        style={{ backgroundColor: ACCENT }}
      />
    </div>
  );
}

// Sidebar / header lockup: monogram + product name.
export function Wordmark({ small }: { small?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark size={small ? 28 : 32} radius={small ? 7 : 8} />
      <div className="leading-tight">
        <div className="text-sm font-semibold tracking-tight text-bone">
          Nexraft<span className="text-signal"> CRM</span>
        </div>
        {!small ? (
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">Sales OS</div>
        ) : null}
      </div>
    </div>
  );
}
