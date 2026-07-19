import { createFileRoute } from "@tanstack/react-router";

import { runDueSweeps } from "../../../lib/crm/data";

// Daily lead sweep, hit by the Vercel cron (see vercel.json) every morning —
// the server-side sibling of the in-browser radar, so fresh leads land in the
// pool even when nobody has the CRM open.
//
// Auth: when CRON_SECRET is set in Vercel, requests must carry it as a Bearer
// token (Vercel's cron does this automatically once the env var exists). Without
// the secret the endpoint still works but leans on the engine's own throttle:
// a sweep that ran in the last 20 hours is never run again, so hammering the
// URL can't spam the pool or the map services.
export const Route = createFileRoute("/api/cron/sweep")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const secret = process.env.CRON_SECRET;
        if (secret) {
          const auth = request.headers.get("authorization") ?? "";
          if (auth !== `Bearer ${secret}`) {
            return new Response("Unauthorized", { status: 401 });
          }
        }
        try {
          const res = await runDueSweeps();
          return Response.json({ ok: true, ...res });
        } catch {
          return Response.json({ ok: false, error: "Sweep failed." }, { status: 500 });
        }
      },
    },
  },
});
