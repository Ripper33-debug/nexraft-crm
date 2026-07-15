import { createFileRoute, redirect, Link, Outlet, useLocation, useRouterState } from "@tanstack/react-router";

import { getMe } from "../lib/crm/data";
import { Avatar } from "../components/crm/ui";
import { GlobalSearch } from "../components/crm/search";
import { Wordmark } from "../components/crm/brand";
import { Toaster } from "../components/crm/toast";

// Thin top progress bar that appears while a route loader is in flight — the
// small "this app is alive" cue that polished tools have.
function RouteProgress() {
  const isLoading = useRouterState({ select: (s) => s.isLoading });
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[110] h-0.5">
      <div
        className={
          "h-full bg-signal transition-all duration-300 ease-out " +
          (isLoading ? "w-2/3 opacity-100" : "w-full opacity-0")
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
  loader: ({ context }) => ({ user: context.user }),
  component: AppLayout,
});

type NavItem = { to: string; label: string; icon: string; admin?: boolean };

const NAV: NavItem[] = [
  { to: "/", label: "Dashboard", icon: "M3 12l9-9 9 9M5 10v10h5v-6h4v6h5V10" },
  { to: "/pipeline", label: "Pipeline", icon: "M3 6h18M6 12h12M10 18h4" },
  { to: "/contacts", label: "Contacts", icon: "M16 14a4 4 0 10-8 0M12 7a3 3 0 100 6 3 3 0 000-6zM4 20c0-2 3-3 8-3s8 1 8 3" },
  { to: "/companies", label: "Companies", icon: "M4 21V5a1 1 0 011-1h9a1 1 0 011 1v16M15 21V9h4a1 1 0 011 1v11M8 8h3M8 12h3M8 16h3" },
  { to: "/activities", label: "Activities", icon: "M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" },
  { to: "/reports", label: "Reports", icon: "M3 3v18h18M7 15l3-4 3 3 4-6" },
  { to: "/team", label: "Team", admin: true, icon: "M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-4-4 4 4 0 004 4zm6-2a3 3 0 10-2-5.24" },
];

function NavLinks({
  pathname,
  isAdmin,
  onNavigate,
}: {
  pathname: string;
  isAdmin: boolean;
  onNavigate?: () => void;
}) {
  return (
    <>
      {NAV.filter((item) => !item.admin || isAdmin).map((item) => {
        const active = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
        return (
          <Link
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            className={
              "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors " +
              (active
                ? "bg-signal-soft text-signal"
                : "text-mute hover:bg-surface-2 hover:text-bone")
            }
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d={item.icon} />
            </svg>
            {item.label}
            {item.admin ? (
              <span className="ml-auto rounded-sm bg-surface-2 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-faint group-hover:text-mute">
                Admin
              </span>
            ) : null}
          </Link>
        );
      })}
    </>
  );
}

function AppLayout() {
  const { user } = Route.useLoaderData();
  const pathname = useLocation().pathname;
  const isAdmin = user.role === "admin";

  return (
    <div className="flex min-h-dvh bg-ink">
      <RouteProgress />
      <Toaster />
      {/* Sidebar (desktop) */}
      <aside className="hidden w-60 flex-col border-r border-line bg-surface md:flex">
        <div className="px-5 py-4">
          <Wordmark />
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-3 py-2">
          <NavLinks pathname={pathname} isAdmin={isAdmin} />
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
          <GlobalSearch />
        </header>

        {/* Mobile top bar */}
        <header className="flex items-center justify-between border-b border-line bg-surface px-4 py-3 md:hidden">
          <Wordmark small />
          <form method="post" action="/api/auth/logout">
            <button className="text-xs font-medium text-mute">Sign out</button>
          </form>
        </header>
        <div className="border-b border-line bg-surface px-3 py-2 md:hidden">
          <GlobalSearch />
        </div>
        <nav className="flex gap-1 overflow-x-auto border-b border-line bg-surface px-3 py-2 md:hidden">
          <NavLinks pathname={pathname} isAdmin={isAdmin} />
        </nav>

        <main className="flex-1 overflow-x-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
