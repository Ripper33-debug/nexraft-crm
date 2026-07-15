import { useEffect } from "react";
import { useRouter } from "@tanstack/react-router";

// ---------------------------------------------------------------------------
// Live refresh
//
// Quietly re-fetches the current page's data on a timer (and the moment the
// tab regains focus) so a teammate's changes show up within a few seconds
// without anyone hitting refresh. Two rules keep it from ever feeling like a
// jarring reload:
//
//   1. It never runs while the user is mid-edit — if a modal/form is open or
//      an input is focused, the tick is skipped, so typing is never disturbed.
//   2. The refetch is flagged "silent", so the top progress bar (which normally
//      signals a real navigation) stays hidden during these background syncs.
// ---------------------------------------------------------------------------

// Tiny external store the progress bar subscribes to, so it can tell a silent
// background sync apart from a genuine navigation.
let _syncing = false;
const _subs = new Set<() => void>();

export function isBackgroundSyncing() {
  return _syncing;
}

export function subscribeSyncing(cb: () => void) {
  _subs.add(cb);
  return () => {
    _subs.delete(cb);
  };
}

function setSyncing(v: boolean) {
  if (_syncing === v) return;
  _syncing = v;
  _subs.forEach((f) => f());
}

// True when the user is actively working and a background reload would be
// disruptive: any open dialog, or focus sitting in a text field / select.
function userIsBusy() {
  if (typeof document === "undefined") return false;
  if (document.querySelector('[role="dialog"]')) return true;
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return false;
}

export function useLiveRefresh(intervalMs = 10000) {
  const router = useRouter();

  useEffect(() => {
    let disposed = false;

    async function sync() {
      if (disposed || document.hidden || userIsBusy()) return;
      setSyncing(true);
      try {
        await router.invalidate();
      } catch {
        // Transient failure (e.g. dropped wifi) — the next tick will retry.
      } finally {
        setSyncing(false);
      }
    }

    const id = window.setInterval(sync, intervalMs);
    // Returning to the tab is exactly when fresh data matters most.
    const onFocus = () => {
      if (!document.hidden) sync();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);

    return () => {
      disposed = true;
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [router, intervalMs]);
}
