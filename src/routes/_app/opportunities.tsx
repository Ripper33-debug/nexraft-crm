import { createFileRoute, redirect } from "@tanstack/react-router";

// The Opportunities tab folded into the rest of the app: hot unclaimed leads
// show on My Day, and unowned companies have a Claim button right on the
// Companies list. Old bookmarks land on Companies.
export const Route = createFileRoute("/_app/opportunities")({
  beforeLoad: () => {
    throw redirect({ to: "/companies", search: { focus: undefined, new: undefined } });
  },
});
