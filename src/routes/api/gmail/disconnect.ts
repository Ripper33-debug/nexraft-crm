import { createFileRoute } from "@tanstack/react-router";

import { userFromRequest } from "../../../lib/crm/auth.server";
import { disconnect } from "../../../lib/crm/gmail.server";

// Removes the rep's stored Gmail connection (deletes the encrypted refresh token).
export const Route = createFileRoute("/api/gmail/disconnect")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const user = await userFromRequest(request);
        if (!user) {
          return new Response(null, {
            status: 302,
            headers: { Location: "/login?error=" + encodeURIComponent("Please sign in first.") },
          });
        }
        await disconnect(user.id);
        return new Response(null, { status: 302, headers: { Location: "/settings?email=disconnected" } });
      },
    },
  },
});
