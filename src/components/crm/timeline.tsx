import { useEffect, useState } from "react";

import { getEntityTimeline, type FeedRow } from "../../lib/crm/data";
import { relativeTime } from "../../lib/crm/constants";
import { Avatar, Eyebrow } from "./ui";

type EntityType = "company" | "contact" | "deal";

// Colour + glyph per event kind, so the history scans at a glance.
function verbStyle(verb: string): { color: string; icon: string } {
  switch (verb) {
    case "won":
      return { color: "#22c55e", icon: "🏆" };
    case "lost":
      return { color: "#ef4444", icon: "✕" };
    case "note_added":
      return { color: "#2dd4bf", icon: "📝" };
    case "emailed":
      return { color: "#a855f7", icon: "✉" };
    case "created":
      return { color: "#38bdf8", icon: "✦" };
    case "stage_changed":
      return { color: "#38bdf8", icon: "→" };
    case "completed":
      return { color: "#a855f7", icon: "✓" };
    case "claimed":
    case "assigned":
    case "reassigned":
    case "shared":
      return { color: "#f59e0b", icon: "⇄" };
    case "triaged":
      return { color: "#eab308", icon: "☎" };
    case "archived":
    case "deleted":
      return { color: "#8a978f", icon: "🗑" };
    default:
      return { color: "#8a978f", icon: "•" };
  }
}

// Read-only activity history for one record, newest first. Fetches its own data
// so it can be dropped onto any detail page. Pass `reloadKey` and bump it to make
// the timeline re-pull (e.g. right after a note is posted elsewhere on the page).
export function Timeline({
  entityType,
  entityId,
  reloadKey = 0,
}: {
  entityType: EntityType;
  entityId: string;
  reloadKey?: number;
}) {
  const [events, setEvents] = useState<FeedRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getEntityTimeline({ data: { entity_type: entityType, entity_id: entityId } })
      .then((rows) => {
        if (!cancelled) setEvents(rows);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [entityType, entityId, reloadKey]);

  return (
    <div className="space-y-3">
      <Eyebrow>Activity</Eyebrow>
      {loading ? (
        <p className="text-xs text-faint">Loading history…</p>
      ) : events.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-xs text-faint">
          Nothing logged yet. Stage changes, notes, and emails will appear here as they happen.
        </p>
      ) : (
        <ul className="relative space-y-0 pl-1">
          {events.map((e, i) => {
            const st = verbStyle(e.verb);
            const last = i === events.length - 1;
            return (
              <li key={e.id} className="relative flex gap-3 pb-4">
                {!last ? (
                  <span className="absolute left-[13px] top-6 h-full w-px bg-line" aria-hidden="true" />
                ) : null}
                <span
                  className="z-10 mt-0.5 flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full text-[11px]"
                  style={{ backgroundColor: `${st.color}22`, color: st.color }}
                >
                  {st.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-snug text-mute">{e.summary}</p>
                  <div className="mt-0.5 flex items-center gap-2">
                    {e.actor_name ? <Avatar name={e.actor_name} size={16} /> : null}
                    <span className="text-[11px] text-faint">{relativeTime(e.created_at)}</span>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
