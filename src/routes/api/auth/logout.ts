import { createFileRoute } from "@tanstack/react-router";

import { clearCookie, destroySession } from "../../../lib/crm/auth.server";

export const Route = createFileRoute("/api/auth/logout")({
  server: {
    handlers: {
      POST: async () => {
        await destroySession();
        const headers = new Headers({ Location: "/login" });
        headers.append("Set-Cookie", clearCookie());
        return new Response(null, { status: 303, headers });
      },
    },
  },
});
