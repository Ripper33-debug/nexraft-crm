import { createFileRoute, redirect } from "@tanstack/react-router";

// The standalone Email tab merged into Outreach (/followups) — one place for
// every email: the nudge queue on top, the free composer underneath. Old
// bookmarks land there instead of a dead page.
export const Route = createFileRoute("/_app/emails")({
  beforeLoad: () => {
    throw redirect({ to: "/followups" });
  },
});
