import { createFileRoute, redirect, Link, Outlet, useLocation } from "@tanstack/react-router";

import { getMe } from "../lib/crm/data";

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

const NAV = [
  { to: "/", label: "Dashboard", icon: "M3 12l9-9 9 9M5 10v10h5v-6h4v6h5V10" },
  { to: "/pipeline", label: "Pipeline", icon: "M3 6h18M6 12h12M10 18h4" },
  { to: "/contacts", label: "Contacts", icon: "M16 14a4 4 0 10-8 0M12 7a3 3 0 100 6 3 3 0 000-6zM4 20c0-2 3-3 8-3s8 1 8 3" },
  { to: "/companies", label: "Companies", icon: "M4 21V5a1 1 0 011-1h9a1 1 0 011 1v16M15 21V9h4a1 1 0 011 1v11M8 8h3M8 12h3M8 16h3" },
  { to: "/activities", label: "Activities", icon: "M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" },
];

function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <>
      {NAV.map((item) => {
        const active = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
        return (
          <Link
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            className={
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors " +
              (active ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:bg-slate-100")
            }
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d={item.icon} />
            </svg>
            {item.label}
          </Link>
        );
      })}
    </>
  );
}

function AppLayout() {
  const { user } = Route.useLoaderData();
  const pathname = useLocation().pathname;

  return (
    <div className="flex min-h-dvh bg-slate-50">
      {/* Sidebar (desktop) */}
      <aside className="hidden w-60 flex-col border-r border-slate-200 bg-white md:flex">
        <div className="flex items-center gap-2 px-5 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">
            N
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-900">Nexraft CRM</div>
            <div className="text-[11px] text-slate-400">Sales pipeline</div>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-3 py-2">
          <NavLinks pathname={pathname} />
        </nav>
        <div className="border-t border-slate-200 px-3 py-3">
          <div className="px-2 pb-2">
            <div className="truncate text-sm font-medium text-slate-800">{user.name}</div>
            <div className="truncate text-xs text-slate-400">{user.email}</div>
          </div>
          <form method="post" action="/api/auth/logout">
            <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
              </svg>
              Sign out
            </button>
          </form>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 md:hidden">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-xs font-bold text-white">
              N
            </div>
            <span className="text-sm font-semibold">Nexraft CRM</span>
          </div>
          <form method="post" action="/api/auth/logout">
            <button className="text-xs font-medium text-slate-500">Sign out</button>
          </form>
        </header>
        <nav className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-white px-3 py-2 md:hidden">
          <NavLinks pathname={pathname} />
        </nav>

        <main className="flex-1 overflow-x-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
