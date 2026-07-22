import { createFileRoute } from "@tanstack/react-router";

import { registerUser, sessionCookie } from "../../../lib/crm/auth.server";

function redirect(location: string, cookie?: string): Response {
  const headers = new Headers({ Location: location });
  if (cookie) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 303, headers });
}

export const Route = createFileRoute("/api/auth/signup")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const form = await request.formData();
        const result = await registerUser({
          name: String(form.get("name") ?? ""),
          email: String(form.get("email") ?? ""),
          password: String(form.get("password") ?? ""),
          code: String(form.get("code") ?? ""),
        });
        if (!result.ok) {
          return redirect(`/signup?error=${encodeURIComponent(result.error)}`);
        }
        // Land reps on My Day — the practical "what do I do next" home.
        return redirect("/today", sessionCookie(result.token));
      },
    },
  },
});
