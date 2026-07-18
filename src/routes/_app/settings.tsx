import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { getGmailStatus } from "../../lib/crm/data";
import { Card, PageHeader, Eyebrow, Pill } from "../../components/crm/ui";
import {
  type ThemePref,
  getThemePref,
  setThemePref,
  watchSystemTheme,
} from "../../lib/crm/theme";

type GmailStatus = { configured: boolean; connected: boolean; email: string | null };

// Human-readable flash for the `?email=` flag the OAuth routes redirect back with.
const FLASH: Record<string, { tone: "ok" | "warn" | "danger"; text: string }> = {
  connected: { tone: "ok", text: "Gmail connected — you can now send outreach from your own address." },
  disconnected: { tone: "warn", text: "Gmail disconnected. You can reconnect any time." },
  denied: { tone: "warn", text: "Connection cancelled — Google didn't grant access." },
  badstate: { tone: "danger", text: "Security check failed. Please try connecting again." },
  failed: { tone: "danger", text: "Something went wrong connecting Gmail. Please try again." },
  notconfigured: {
    tone: "warn",
    text: "Gmail sending isn't set up on the server yet. Ask your admin to finish the Google setup.",
  },
};

export const Route = createFileRoute("/_app/settings")({
  validateSearch: (search: Record<string, unknown>) => ({
    email: typeof search.email === "string" ? search.email : undefined,
  }),
  loader: async () => {
    const gmail = (await getGmailStatus()) as GmailStatus;
    return { gmail };
  },
  component: SettingsPage,
});

// Small preview chip for a theme option — a miniature of the app shell so the
// choice is legible at a glance, not just a word.
function ThemeSwatch({
  bg,
  card,
  text,
  accent,
}: {
  bg: string;
  card: string;
  text: string;
  accent: string;
}) {
  return (
    <span
      className="flex h-9 w-12 shrink-0 flex-col justify-between overflow-hidden rounded-md border border-black/10 p-1 shadow-inner"
      style={{ backgroundColor: bg }}
      aria-hidden
    >
      <span className="flex items-center gap-0.5">
        <span className="h-1 w-1 rounded-full" style={{ backgroundColor: accent }} />
        <span className="h-1 w-4 rounded-full" style={{ backgroundColor: text, opacity: 0.7 }} />
      </span>
      <span
        className="h-3 w-full rounded-sm"
        style={{ backgroundColor: card, border: `1px solid ${accent}33` }}
      />
    </span>
  );
}

const THEME_OPTIONS: {
  value: ThemePref;
  label: string;
  hint: string;
  swatch: { bg: string; card: string; text: string; accent: string };
}[] = [
  {
    value: "daylight",
    label: "Warm Paper",
    hint: "Bright, warm — easy all day",
    swatch: { bg: "#f3efe7", card: "#ffffff", text: "#1c211d", accent: "#0d6e66" },
  },
  {
    value: "midnight",
    label: "Dark",
    hint: "Warm charcoal, easy at night",
    swatch: { bg: "#100e0b", card: "#221e18", text: "#ece7dd", accent: "#3bb5a6" },
  },
  {
    value: "system",
    label: "System",
    hint: "Match your device setting",
    swatch: { bg: "#8a8378", card: "#cfc9bd", text: "#1c211d", accent: "#0d6e66" },
  },
];

function AppearanceCard() {
  // Preference is client-only (localStorage); hydrate after mount so SSR and the
  // first client render agree, then reflect the blocking-script's choice.
  const [pref, setPref] = useState<ThemePref>("daylight");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setPref(getThemePref());
    setReady(true);
    // Keep the shell in sync with the OS while "System" is selected.
    return watchSystemTheme(() => getThemePref());
  }, []);

  function choose(next: ThemePref) {
    setPref(next);
    setThemePref(next); // applies data-theme + persists immediately
  }

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Eyebrow className="mb-1">Appearance</Eyebrow>
          <p className="text-sm leading-relaxed text-mute">
            Choose how the CRM looks. <strong className="text-bone">Warm Paper</strong> is a bright,
            warm light mode; <strong className="text-bone">Dark</strong> is its warm-charcoal
            counterpart. Your choice is saved on this device and applies instantly.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-2 border-t border-line pt-4 sm:grid-cols-3">
        {THEME_OPTIONS.map((opt) => {
          const active = ready && pref === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => choose(opt.value)}
              aria-pressed={active}
              className={
                "flex items-center gap-3 rounded-xl border p-3 text-left transition-all duration-150 active:translate-y-px " +
                (active
                  ? "border-signal bg-signal-soft shadow-[0_0_0_1px_var(--color-signal)]"
                  : "border-line bg-surface-2 hover:border-line-strong")
              }
            >
              <ThemeSwatch {...opt.swatch} />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5">
                  <span className="text-sm font-semibold text-bone">{opt.label}</span>
                  {active ? (
                    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 text-signal" fill="currentColor">
                      <path
                        fillRule="evenodd"
                        d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4l3.3 3.3 6.8-6.8a1 1 0 0 1 1.4 0Z"
                        clipRule="evenodd"
                      />
                    </svg>
                  ) : null}
                </span>
                <span className="mt-0.5 block truncate text-xs text-faint">{opt.hint}</span>
              </span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

function SettingsPage() {
  const { gmail } = Route.useLoaderData();
  const { email: flag } = Route.useSearch();
  const flash = flag ? FLASH[flag] : undefined;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <PageHeader
        title="Settings"
        subtitle="Connect the tools you use so the CRM can work on your behalf. These settings are personal to you."
      />

      {flash ? (
        <div className="mt-4">
          <Pill tone={flash.tone}>{flash.text}</Pill>
        </div>
      ) : null}

      <div className="mt-6 space-y-4">
        <AppearanceCard />

        <Card className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Eyebrow className="mb-1">Email — send from your own address</Eyebrow>
              <p className="text-sm leading-relaxed text-mute">
                Connect your Google Workspace account once and the CRM can send outreach and follow-up
                emails straight from your real address. Replies land in your own inbox, and every send is
                logged on the company's timeline. The CRM only ever <strong className="text-bone">sends</strong>{" "}
                mail — it can't read your inbox.
              </p>
            </div>
            {gmail.connected ? (
              <Pill tone="ok">Connected</Pill>
            ) : gmail.configured ? (
              <Pill tone="neutral">Not connected</Pill>
            ) : (
              <Pill tone="warn">Setup needed</Pill>
            )}
          </div>

          <div className="mt-4 border-t border-line pt-4">
            {!gmail.configured ? (
              <p className="text-sm text-faint">
                Gmail sending hasn't been configured on the server yet. Once the Google credentials are in
                place, a “Connect Gmail” button will appear here.
              </p>
            ) : gmail.connected ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm text-mute">
                  Connected as{" "}
                  <span className="font-mono text-bone">{gmail.email || "your Google account"}</span>
                </div>
                {/* POST to the disconnect route — deletes the stored token. */}
                <form method="post" action="/api/gmail/disconnect">
                  <button
                    type="submit"
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-line-strong bg-surface-2 px-3.5 py-2 text-sm font-semibold text-bone shadow-[0_1px_2px_rgba(0,0,0,0.25)] transition-all duration-150 hover:border-red-400/50 hover:text-red-300 active:translate-y-px"
                  >
                    Disconnect
                  </button>
                </form>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-faint">
                  You'll be sent to Google to approve access, then brought right back here.
                </p>
                {/* Plain link — the connect route is a GET that bounces to Google. */}
                <a
                  href="/api/gmail/connect"
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-signal hover:bg-signal-strong px-3.5 py-2 text-sm font-semibold text-ink transition-all duration-150 active:translate-y-px"
                >
                  Connect Gmail
                </a>
              </div>
            )}
          </div>
        </Card>

        <p className="text-xs text-faint">
          More settings will show up here as we add them. For how the rest of the CRM works, see the{" "}
          <a href="/help" className="text-signal hover:underline">
            How it works
          </a>{" "}
          guide.
        </p>
      </div>
    </div>
  );
}
