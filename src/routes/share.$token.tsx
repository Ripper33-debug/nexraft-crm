import { createFileRoute } from "@tanstack/react-router";

import { getSharedProject, type SharedProject } from "../lib/crm/data";
import { LogoMark } from "../components/crm/brand";
import { cx } from "../components/crm/ui";

// Public, read-only build-progress page for CLIENTS (no login). Reached via the
// unguessable /share/<token> link a builder copies from the Projects board.
// Shows only client-safe info: the build %, the step checklist, and the launch
// date — never notes, owners, or anything else from the CRM.

const STATUS_LABELS: Record<string, string> = {
  kickoff: "Kickoff",
  design: "Design",
  build: "Build in progress",
  review: "Final review",
  launched: "Launched 🎉",
};

export const Route = createFileRoute("/share/$token")({
  loader: async ({ params }) => {
    const project = await getSharedProject({ data: { token: params.token } }).catch(() => null);
    return { project };
  },
  component: SharePage,
});

function SharePage() {
  const { project } = Route.useLoaderData() as { project: SharedProject | null };

  if (!project) {
    return (
      <Shell>
        <h1 className="text-xl font-semibold text-bone">This link isn&apos;t active</h1>
        <p className="mt-2 text-sm text-mute">
          The project link you followed doesn&apos;t exist or has been turned off. Reach out to your
          Nexraft contact and we&apos;ll sort it right away.
        </p>
      </Shell>
    );
  }

  const items = parseChecklist(project.checklist);
  const done = items.filter((i) => i.done).length;
  const pct = items.length > 0 ? Math.round((done / items.length) * 100) : 0;
  const launched = project.status === "launched";

  return (
    <Shell>
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-signal">
        Build progress
      </p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight text-bone">
        {project.company_name ?? project.name}
      </h1>
      <p className="mt-1 text-sm text-mute">
        {STATUS_LABELS[project.status] ?? project.status}
        {project.launch_date ? ` · target launch ${project.launch_date}` : ""}
      </p>

      <div className="mt-6 flex items-end justify-between">
        <span
          className={cx(
            "text-5xl font-bold tabular-nums tracking-tight",
            launched || pct >= 100 ? "text-emerald-600" : "text-signal",
          )}
        >
          {pct}%
        </span>
        <span className="pb-1 text-xs text-faint">
          {done} of {items.length} steps complete
        </span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2">
        <div
          className={cx(
            "h-full rounded-full transition-all",
            launched || pct >= 100 ? "bg-emerald-500" : "bg-signal",
          )}
          style={{ width: `${Math.max(4, pct)}%` }}
        />
      </div>

      <ul className="mt-6 space-y-2">
        {items.map((item, i) => (
          <li key={i} className="flex items-center gap-2.5 text-sm">
            <span
              className={cx(
                "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px]",
                item.done
                  ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-600"
                  : "border-line text-faint",
              )}
            >
              {item.done ? "✓" : ""}
            </span>
            <span className={item.done ? "text-mute line-through decoration-line" : "text-bone"}>
              {item.label}
            </span>
          </li>
        ))}
      </ul>

      {launched ? (
        <p className="mt-6 rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-600">
          Your website is live — congratulations! 🎉
        </p>
      ) : (
        <p className="mt-6 text-xs text-faint">
          This page updates live as we work — check back any time. Questions? Just reply to your
          email thread with us or give us a call.
        </p>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-ink px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-5 flex items-center gap-2.5">
          <LogoMark size={34} radius={9} />
          <span className="text-lg font-semibold tracking-tight text-bone">
            Nexraft<span className="text-signal">.</span>
          </span>
        </div>
        <div className="rounded-xl border border-line bg-surface p-6 shadow-xl">{children}</div>
        <p className="mt-4 text-center text-[11px] text-faint">
          Built by Nexraft ·{" "}
          <a href="https://nexraft.com" className="text-mute hover:text-bone">
            nexraft.com
          </a>
        </p>
      </div>
    </div>
  );
}

function parseChecklist(raw: string | null): { label: string; done: boolean }[] {
  try {
    const arr = JSON.parse(raw || "[]") as { label?: unknown; done?: unknown }[];
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((i) => typeof i?.label === "string")
      .map((i) => ({ label: i.label as string, done: Boolean(i.done) }));
  } catch {
    return [];
  }
}
