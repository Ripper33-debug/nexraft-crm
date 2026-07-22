import { createFileRoute } from "@tanstack/react-router";

import { loginUser, sessionCookie } from "../../../lib/crm/auth.server";

function redirect(location: string, cookie?: string): Response {
  const headers = new Headers({ Location: location });
  if (cookie) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 303, headers });
}

export const Route = createFileRoute("/api/auth/login")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const form = await request.formData();
        const result = await loginUser({
          email: String(form.get("email") ?? ""),
          password: String(form.get("password") ?? ""),
        });
        if (!result.ok) {
          return redirect(`/login?error=${encodeURIComponent(result.error)}`);
        }
        // Land reps on My Day — the practical "what do I do next" home.
        return redirect("/today", sessionCookie(result.token));
      },
    },
  },
});
