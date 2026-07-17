import { createFileRoute } from "@tanstack/react-router";

import { userFromRequest } from "../../../lib/crm/auth.server";
import { connectFromCode, baseUrlFrom } from "../../../lib/crm/gmail.server";

const CLEAR_STATE = "nx_gmail_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

function back(status: string): Response {
  const headers = new Headers({ Location: `/settings?email=${status}` });
  headers.append("Set-Cookie", CLEAR_STATE);
  return new Response(null, { status: 302, headers });
}

// Google redirects the rep back here with a one-time code. We verify the CSRF
// state, exchange the code for tokens, and store the connection — then send them
// back to Settings with a status flag.
export const Route = createFileRoute("/api/gmail/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const oauthError = url.searchParams.get("error");
        if (oauthError) return back("denied");

        const user = await userFromRequest(request);
        if (!user) {
          const h = new Headers({ Location: "/login?error=" + encodeURIComponent("Please sign in first.") });
          h.append("Set-Cookie", CLEAR_STATE);
          return new Response(null, { status: 302, headers: h });
        }

        const stateCookie = readCookie(request, "nx_gmail_state");
        if (!code || !state || !stateCookie || state !== stateCookie) return back("badstate");

        try {
          await connectFromCode(user.id, code, baseUrlFrom(request));
          return back("connected");
        } catch {
          return back("failed");
        }
      },
    },
  },
});
