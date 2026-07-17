import { createFileRoute } from "@tanstack/react-router";

import { userFromRequest } from "../../../lib/crm/auth.server";
import { authUrl, baseUrlFrom, isGmailConfigured } from "../../../lib/crm/gmail.server";

function redirect(location: string, cookie?: string): Response {
  const headers = new Headers({ Location: location });
  if (cookie) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 302, headers });
}

// Kicks off the Google OAuth consent flow for the signed-in rep. Sets a short
// state cookie for CSRF protection, then bounces to Google.
export const Route = createFileRoute("/api/gmail/connect")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const user = await userFromRequest(request);
        if (!user) return redirect("/login?error=" + encodeURIComponent("Please sign in first."));
        if (!isGmailConfigured()) return redirect("/settings?email=notconfigured");

        const state = crypto.randomUUID();
        const url = authUrl(baseUrlFrom(request), state);
        return redirect(
          url,
          `nx_gmail_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
        );
      },
    },
  },
});
