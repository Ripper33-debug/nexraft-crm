import { useEffect, useState, useSyncExternalStore } from "react";
import { createFileRoute, redirect, Link, Outlet, useLocation, useRouterState } from "@tanstack/react-router";

import { getMe, getFollowupCount } from "../lib/crm/data";
import { Avatar } from "../components/crm/ui";
import { CommandPalette, CommandPaletteTrigger } from "../components/crm/command-palette";
import { NotificationBell } from "../components/crm/notifications";
import { Wordmark } from "../components/crm/brand";
import { Toaster } from "../components/crm/toast";
import { WelcomeTour } from "../components/crm/tour";
import { AutoDiscovery } from "../components/crm/auto-discovery";
import { useLiveRefresh, subscribeSyncing, isBackgroundSyncing } from "../lib/crm/live";
import { useKonamiCode, installConsoleEgg } from "../lib/crm/easter-eggs";

// Thin top progress bar that appears while a route loader is in flight — the
// small "this app is alive" cue that polished tools have. Background live-sync
// refetches are flagged "silent" so this bar stays hidden for them.
function RouteProgress() {
  const isLoading = useRouterState({ select: (s) => s.isLoading });
  const silent = useSyncExternalStore(subscribeSyncing, isBackgroundSyncing, () => false);
  const show = isLoading && !silent;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[110] h-0.5">
      <div
        className={
          "h-full bg-signal transition-all duration-300 ease-out " +
          (show ? "w-2/3 opacity-100" : "w-full opacity-0")
        }
        style={{ boxShadow: "0 0 8px rgba(45,212,191,0.6)" }}
      />
    </div>
  );
}

export const Route = createFileRoute("/_app")({
  beforeLoad: async () => {
    try {
      const user = await getMe();
      return { user };
    } catch {
      throw redirect({ to: "/login", search: { error: "" } });
    }
  },
  loader: async ({ context }) => {
    // Pull the follow-up count alongside the user so the nav badge is ready on
    // first paint. It's a single cheap COUNT — refreshes with live-sync.
    let followupCount = 0;
    try {
      const r = await getFollowupCount();
      followupCount = r.count;
    } catch {
      /* non-critical — just show no badge */
    }
    return { user: context.user, followupCount };
  },
  component: AppLayout,
  errorComponent: RouteError,
});

// Friendly, recoverable fallback for any error thrown while rendering a page.
// Without this, an unexpected data shape or render throw white-screens the whole
// app; here the shell survives and the user gets a "try again" + a way home.
function RouteError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-ink px-6">
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-8 text-center shadow-xl shadow-black/20">
        <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-signal-soft text-signal">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          </svg>
        </div>
        <h1 className="font-display text-lg font-semibold text-bone">Something went sideways</h1>
        <p className="mt-2 text-sm leading-relaxed text-mute">
          This page hit an unexpected snag. Your data is safe — nothing was changed. Try again, or head
          back to the dashboard.
        </p>
        {error?.message ? (
          <p className="mt-3 break-words rounded-lg bg-surface-2 px-3 py-2 text-left font-mono text-[11px] text-faint">
            {error.message}
          </p>
        ) : null}
        <div className="mt-5 flex items-center justify-center gap-2">
          <button
            onClick={reset}
            className="rounded-lg bg-signal px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-signal-strong"
          >
            Try again
          </button>
          <Link
            to="/"
            className="rounded-lg border border-line-strong bg-surface px-4 py-2 text-sm font-medium text-bone transition-colors hover:bg-surface-2"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}

type NavItem = { to: string; label: string; icon: string; admin?: boolean; badgeKey?: "followups" };
type NavGroup = { label?: string; items: NavItem[] };

// Grouped so the list scans at a glance instead of reading as one long column.
// "Main" is the day-to-day sales flow; the rest is grouped by purpose.
const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      { to: "/", label: "Dashboard", icon: "M3 12l9-9 9 9M5 10v10h5v-6h4v6h5V10" },
      { to: "/calls", label: "Calls", icon: "M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" },
      { to: "/followups", label: "Follow-ups", icon: "M4 4h16v12H5.17L4 17.17V4zm4 4h8M8 11h5", badgeKey: "followups" },
      { to: "/pipeline", label: "Pipeline", icon: "M3 6h18M6 12h12M10 18h4" },
      { to: "/opportunities", label: "Opportunities", icon: "M12 3l2.09 4.26L19 8.27l-3.5 3.36.83 4.87L12 14.5l-4.33 2 .83-4.87L5 8.27l4.91-1.01z" },
      { to: "/discover", label: "Discover", icon: "M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.35-4.35" },
      { to: "/companies", label: "Companies", icon: "M4 21V5a1 1 0 011-1h9a1 1 0 011 1v16M15 21V9h4a1 1 0 011 1v11M8 8h3M8 12h3M8 16h3" },
      { to: "/contacts", label: "Contacts", icon: "M16 14a4 4 0 10-8 0M12 7a3 3 0 100 6 3 3 0 000-6zM4 20c0-2 3-3 8-3s8 1 8 3" },
    ],
  },
  {
    label: "Insights",
    items: [
      { to: "/activities", label: "Activities", icon: "M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" },
      { to: "/reports", label: "Reports", icon: "M3 3v18h18M7 15l3-4 3 3 4-6" },
    ],
  },
  {
    label: "Admin",
    items: [
      { to: "/team", label: "Team", admin: true, icon: "M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-4-4 4 4 0 004 4zm6-2a3 3 0 10-2-5.24" },
      { to: "/payroll", label: "Payroll", admin: true, icon: "M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" },
    ],
  },
  {
    items: [
      { to: "/settings", label: "Settings", icon: "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" },
      { to: "/help", label: "Help", icon: "M12 22a10 10 0 100-20 10 10 0 000 20zM9.1 9a3 3 0 015.82 1c0 2-3 2.5-3 4M12 17h.01" },
    ],
  },
];

function NavLink({
  item,
  active,
  badge,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  badge?: number;
  onNavigate?: () => void;
}) {
  return (
    <Link
      to={item.to}
      onClick={onNavigate}
      className={
        "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150 md:py-2 " +
        (active
          ? "bg-gradient-to-r from-signal-soft to-signal-soft/30 text-signal shadow-[inset_0_0_0_1px_rgba(45,212,191,0.15)]"
          : "text-mute hover:bg-surface-2 hover:text-bone")
      }
    >
      {active ? (
        <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-signal shadow-[0_0_8px_rgba(45,212,191,0.7)]" />
      ) : null}
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d={item.icon} />
      </svg>
      {item.label}
      {badge && badge > 0 ? (
        <span
          className="ml-auto inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-amber-500/20 px-1.5 text-[11px] font-semibold text-amber-300 ring-1 ring-amber-500/30"
          title={`${badge} follow-up${badge === 1 ? "" : "s"} waiting`}
        >
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
    </Link>
  );
}

function NavLinks({
  pathname,
  isAdmin,
  followupCount,
  onNavigate,
}: {
  pathname: string;
  isAdmin: boolean;
  followupCount: number;
  onNavigate?: () => void;
}) {
  return (
    <>
      {NAV_GROUPS.map((group, gi) => {
        const items = group.items.filter((item) => !item.admin || isAdmin);
        if (items.length === 0) return null;
        return (
          <div key={gi} className="flex flex-col gap-1">
            {group.label ? (
              <div className="px-3 pb-0.5 pt-3 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-faint">
                {group.label}
              </div>
            ) : null}
            {items.map((item) => {
              const active = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
              const badge = item.badgeKey === "followups" ? followupCount : undefined;
              return <NavLink key={item.to} item={item} active={active} badge={badge} onNavigate={onNavigate} />;
            })}
          </div>
        );
      })}
    </>
  );
}

function AppLayout() {
  const { user, followupCount } = Route.useLoaderData();
  const pathname = useLocation().pathname;
  const isAdmin = user.role === "admin";

  // Mobile slide-in drawer. Closes on route change so a tap that navigates
  // never leaves the menu hanging open over the new page.
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);
  // Lock body scroll while the drawer is open so the page behind doesn't move.
  useEffect(() => {
    if (!menuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [menuOpen]);

  // Quietly pull teammates' changes every ~10s (and on tab focus), pausing
  // whenever a form is open so nobody's typing is ever interrupted.
  useLiveRefresh(10000);

  // Tiny surprises: a console hello + the Konami code.
  useKonamiCode();
  useEffect(() => {
    installConsoleEgg();
  }, []);

  return (
    <div className="flex min-h-dvh bg-ink">
      <RouteProgress />
      <Toaster />
      <AutoDiscovery />
      <WelcomeTour name={user.name} />
      <CommandPalette isAdmin={isAdmin} />
      {/* Sidebar (desktop) */}
      <aside className="hidden w-60 flex-col border-r border-line bg-surface md:flex">
        <div className="border-b border-line/60 px-5 py-4">
          <Wordmark />
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-3 py-2">
          <NavLinks pathname={pathname} isAdmin={isAdmin} followupCount={followupCount} />
        </nav>
        <div className="border-t border-line px-3 py-3">
          <div className="flex items-center gap-2.5 px-2 pb-2">
            <Avatar name={user.name} size={30} />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm font-medium text-bone">{user.name}</span>
                {isAdmin ? (
                  <span className="rounded-sm bg-signal-soft px-1 py-0.5 font-mono text-[9px] uppercase tracking-wider text-signal">
                    Admin
                  </span>
                ) : null}
              </div>
              <div className="truncate text-xs text-faint">{user.email}</div>
            </div>
          </div>
          <form method="post" action="/api/auth/logout">
            <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-mute hover:bg-surface-2 hover:text-bone">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
              </svg>
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Desktop top bar with global search */}
        <header className="hidden items-center gap-4 border-b border-line bg-surface/80 px-6 py-2.5 backdrop-blur md:flex">
          <CommandPaletteTrigger />
          <div className="ml-auto">
            <NotificationBell />
          </div>
        </header>

        {/* Mobile top bar */}
        <header className="flex items-center justify-between border-b border-line bg-surface px-4 py-3 md:hidden">
          <button
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
            className="-ml-1 flex h-9 w-9 items-center justify-center rounded-lg text-mute hover:bg-surface-2 hover:text-bone"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12h18M3 6h18M3 18h18" />
            </svg>
          </button>
          <Wordmark small />
          <NotificationBell />
        </header>
        <div className="border-b border-line bg-surface px-3 py-2 md:hidden">
          <CommandPaletteTrigger />
        </div>

        {/* Mobile slide-in drawer */}
        {menuOpen ? (
          <div className="fixed inset-0 z-[120] md:hidden">
            <div
              onClick={() => setMenuOpen(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              style={{ animation: "nx-fade-in 150ms ease-out" }}
            />
            <div
              className="absolute inset-y-0 left-0 flex w-[82%] max-w-xs flex-col border-r border-line bg-surface shadow-2xl shadow-black/50"
              style={{ animation: "nx-drawer-in 200ms ease-out" }}
            >
              <div className="flex items-center justify-between border-b border-line/60 px-5 py-4">
                <Wordmark />
                <button
                  onClick={() => setMenuOpen(false)}
                  aria-label="Close menu"
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-mute hover:bg-surface-2 hover:text-bone"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-3">
                <NavLinks pathname={pathname} isAdmin={isAdmin} followupCount={followupCount} onNavigate={() => setMenuOpen(false)} />
              </nav>
              <div className="border-t border-line px-3 py-3">
                <div className="flex items-center gap-2.5 px-2 pb-2">
                  <Avatar name={user.name} size={30} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium text-bone">{user.name}</span>
                      {isAdmin ? (
                        <span className="rounded-sm bg-signal-soft px-1 py-0.5 font-mono text-[9px] uppercase tracking-wider text-signal">
                          Admin
                        </span>
                      ) : null}
                    </div>
                    <div className="truncate text-xs text-faint">{user.email}</div>
                  </div>
                </div>
                <form method="post" action="/api/auth/logout">
                  <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-mute hover:bg-surface-2 hover:text-bone">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
                    </svg>
                    Sign out
                  </button>
                </form>
              </div>
            </div>
            <style>{`@keyframes nx-fade-in{from{opacity:0}to{opacity:1}}@keyframes nx-drawer-in{from{transform:translateX(-100%)}to{transform:translateX(0)}}`}</style>
          </div>
        ) : null}

        <main className="flex-1 overflow-x-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
