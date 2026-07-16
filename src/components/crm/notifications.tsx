import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "@tanstack/react-router";

import { getNotifications, markNotificationsSeen, type NotificationRow } from "../../lib/crm/data";
import { Avatar } from "./ui";
import { relativeTime } from "../../lib/crm/constants";

// Where a notification points, given the entity it's about.
function targetFor(n: NotificationRow): { to: string; id: string } | null {
  if (!n.entity_id) return null;
  if (n.entity_type === "company") return { to: "/companies", id: n.entity_id };
  if (n.entity_type === "contact") return { to: "/contacts", id: n.entity_id };
  if (n.entity_type === "deal") return { to: "/pipeline", id: n.entity_id };
  return null;
}

export function NotificationBell() {
  const router = useRouter();
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  const unseen = items.filter((n) => !n.seen).length;

  const load = useCallback(async () => {
    try {
      const rows = await getNotifications();
      setItems(rows as NotificationRow[]);
    } catch {
      // ignore — non-critical
    }
  }, []);

  // Initial load + gentle polling so handoffs show up without a refresh.
  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    // Opening clears the unread badge (but keeps the list visible).
    if (next && unseen > 0) {
      setItems((prev) => prev.map((n) => ({ ...n, seen: true })));
      try {
        await markNotificationsSeen({ data: {} });
      } catch {
        // ignore
      }
    }
  }

  function openItem(n: NotificationRow) {
    setOpen(false);
    const t = targetFor(n);
    if (t) router.navigate({ to: t.to, search: { focus: t.id } });
  }

  return (
    <div ref={boxRef} className="relative">
      <button
        onClick={toggle}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-surface text-mute transition-colors hover:border-line-strong hover:text-bone"
        aria-label="Notifications"
        title="Notifications"
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unseen > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-signal px-1 text-[10px] font-bold text-ink">
            {unseen > 9 ? "9+" : unseen}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 z-[120] mt-2 w-80 overflow-hidden rounded-xl border border-line bg-surface shadow-xl shadow-black/40">
          <div className="border-b border-line px-4 py-2.5">
            <span className="text-sm font-semibold text-bone">Notifications</span>
          </div>
          <ul className="max-h-96 divide-y divide-line/60 overflow-y-auto">
            {items.length === 0 ? (
              <li className="px-4 py-8 text-center text-sm text-faint">
                Nothing yet — you'll hear about records handed to or shared with you.
              </li>
            ) : (
              items.map((n) => (
                <li key={n.id}>
                  <button
                    onClick={() => openItem(n)}
                    className="flex w-full items-start gap-2.5 px-4 py-2.5 text-left transition-colors hover:bg-surface-2/60"
                  >
                    {n.actor_name ? <Avatar name={n.actor_name} size={24} /> : null}
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-mute">{n.summary}</div>
                      <div className="mt-0.5 text-[11px] text-faint">{relativeTime(n.created_at)}</div>
                    </div>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
