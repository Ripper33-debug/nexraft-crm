import { createFileRoute, redirect } from "@tanstack/react-router";

// Reports merged into the Dashboard — same win/loss numbers, rep table and
// CSV export now live at the bottom of the home page. Old bookmarks land there.
export const Route = createFileRoute("/_app/reports")({
  beforeLoad: () => {
    throw redirect({ to: "/" });
  },
});
