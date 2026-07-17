import { createFileRoute } from "@tanstack/react-router";

import { getGmailStatus } from "../../lib/crm/data";
import { Card, PageHeader, Eyebrow, Pill } from "../../components/crm/ui";

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
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-line-strong bg-gradient-to-b from-surface-2 to-surface px-3.5 py-2 text-sm font-semibold text-bone shadow-[0_1px_2px_rgba(0,0,0,0.25)] transition-all duration-150 hover:border-red-400/50 hover:text-red-300 active:translate-y-px"
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
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-gradient-to-b from-[#3ce0cd] to-signal-strong px-3.5 py-2 text-sm font-semibold text-ink shadow-[0_1px_2px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.3)] transition-all duration-150 hover:shadow-[0_2px_14px_rgba(20,184,166,0.4),inset_0_1px_0_rgba(255,255,255,0.3)] active:translate-y-px"
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
