import { useRef, useState } from "react";
import { useRouter } from "@tanstack/react-router";

import { runResearchBatch } from "../../lib/crm/data";
import { Button } from "./ui";
import { toast } from "./toast";

// Admin lever for the research engine: one click walks the ENTIRE backlog —
// it keeps requesting batches until every company has a dossier (or you click
// again to stop). Progress lives in the button label; the tab must stay open
// while it works. Each batch is its own serverless call, so stopping midway
// loses nothing — everything already researched is saved.
//
// Lives here rather than on the Team page because the un-researched pile is a
// lead-gen problem, not an admin-settings one: a company nobody has audited has
// no known reason to call, so the Calls queue holds it back. This button is
// what turns that pile into callable leads, and it belongs next to the count.
export function ResearchAllButton({
  size,
  className,
  onDone,
}: {
  size?: "sm";
  className?: string;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [left, setLeft] = useState<number | null>(null);
  // Ref, not state: the running loop's closure must see the stop click even
  // though re-renders have replaced the component's locals since it started.
  const stopRef = useRef(false);
  const run = async () => {
    if (running) {
      stopRef.current = true;
      setRunning(false);
      toast("⏸ Research stopped — everything done so far is saved.");
      return;
    }
    setRunning(true);
    stopRef.current = false;
    let total = 0;
    try {
      // Loop until the queue is empty. Hard ceiling of 200 batches (1,200
      // companies) so a bug can never leave this spinning forever.
      for (let i = 0; i < 200; i++) {
        const res = await runResearchBatch();
        total += res.enriched;
        setLeft(res.remaining);
        if (stopRef.current) return;
        if (res.remaining === 0 || res.enriched === 0) break;
      }
      toast(
        total === 0
          ? "🔎 All caught up — every company already has a dossier."
          : `🔎 Done — researched ${total} compan${total === 1 ? "y" : "ies"}. Selling points are on each company page.`,
      );
    } catch {
      toast(
        total > 0
          ? `Research hit a snag after ${total} companies — click again to continue.`
          : "Research failed to start — try again in a moment.",
      );
    } finally {
      setRunning(false);
      setLeft(null);
      // Freshly researched companies change which bucket they're counted in,
      // so the page that shows those counts has to reload them.
      onDone ? onDone() : void router.invalidate();
    }
  };
  return (
    <Button variant="outline" size={size} className={className} onClick={run}>
      {running
        ? left !== null
          ? `Digging… ${left} left (click to stop)`
          : "Digging… (click to stop)"
        : "🔎 Research all"}
    </Button>
  );
}
