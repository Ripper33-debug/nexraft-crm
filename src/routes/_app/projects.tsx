import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import {
  getProjects,
  updateProject,
  archiveProject,
  isBuilder,
  PROJECT_STATUSES,
  type ProjectRow,
  type ProjectChecklistItem,
} from "../../lib/crm/data";
import {
  Button,
  Card,
  EmptyState,
  Eyebrow,
  OwnerChip,
  PageHeader,
  Pill,
  Select,
  SummaryCard,
  Textarea,
  cx,
} from "../../components/crm/ui";
import { toast } from "../../components/crm/toast";
import { relativeTime } from "../../lib/crm/constants";

// Client-build delivery board. Every won deal shows up here automatically
// (getProjects backfills from Launched-stage deals), so the sales pipeline and
// the delivery pipeline can never drift apart.

const STATUS_LABELS: Record<string, string> = {
  kickoff: "Kickoff",
  design: "Design",
  build: "Build",
  review: "Client review",
  launched: "Launched",
};

const STATUS_BLURBS: Record<string, string> = {
  kickoff: "Just signed — schedule the kickoff call and collect assets.",
  design: "Concepts and drafts in front of the client.",
  build: "In active development.",
  review: "Waiting on client sign-off.",
  launched: "Live on the internet. Ring the bell.",
};

export const Route = createFileRoute("/_app/projects")({
  loader: async ({ context }) => {
    const projects = await getProjects();
    const me =
      (context as { user?: { role?: string; email?: string; name?: string } }).user ?? null;
    // Barry & Michael build the sites, so only they (and admins) get edit
    // controls — the rest of the team sees the same board read-only.
    return { projects, canBuild: isBuilder(me) };
  },
  component: ProjectsPage,
});

function parseChecklist(raw: string | null): ProjectChecklistItem[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as ProjectChecklistItem[];
    return Array.isArray(parsed) ? parsed.filter((i) => i && typeof i.label === "string") : [];
  } catch {
    return [];
  }
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2.5">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
        <div
          className={cx(
            "h-full rounded-full transition-all duration-500",
            pct >= 100 ? "bg-emerald-400" : "bg-signal shadow-[0_0_8px_rgba(249,83,30,0.5)]",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      {/* The number everyone actually asks about: "how far along is the build?" */}
      <span
        className={cx(
          "text-sm font-bold tabular-nums",
          pct >= 100 ? "text-emerald-400" : "text-signal",
        )}
        title={`${done} of ${total} checklist steps done`}
      >
        {pct}%
      </span>
    </div>
  );
}

function ProjectCard({
  project,
  canBuild,
  onChanged,
}: {
  project: ProjectRow;
  canBuild: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [notes, setNotes] = useState(project.notes ?? "");
  const checklist = parseChecklist(project.checklist);
  const done = checklist.filter((i) => i.done).length;
  const launched = project.status === "launched";

  async function save(patch: Partial<Parameters<typeof updateProject>[0]["data"]>, successMsg?: string) {
    setBusy(true);
    try {
      const res = await updateProject({ data: { id: project.id, ...patch } });
      if (res && "ok" in res && !res.ok) {
        toast(res.error || "Couldn't save.", "error");
        return;
      }
      if (successMsg) toast(successMsg, "success");
      onChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't save.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function toggleItem(index: number) {
    const next = checklist.map((item, i) => (i === index ? { ...item, done: !item.done } : item));
    const nowDone = next.filter((i) => i.done).length;
    await save(
      { checklist: JSON.stringify(next) },
      nowDone === next.length && next.length > 0 ? "Checklist complete — ready to launch 🚀" : undefined,
    );
  }

  return (
    <Card className={cx("space-y-3 p-4", launched && "opacity-80")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-bone" title={project.name}>
            {project.name}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-faint">
            {project.company_name ? <span className="truncate">{project.company_name}</span> : null}
            <OwnerChip name={project.owner_name} />
            <span title={project.updated_at}>updated {relativeTime(project.updated_at)}</span>
          </div>
        </div>
        {launched ? (
          <Pill tone="ok">Launched</Pill>
        ) : done === checklist.length && checklist.length > 0 ? (
          <Pill tone="signal">Ready to launch</Pill>
        ) : null}
      </div>

      <ProgressBar done={done} total={checklist.length} />

      <div className="flex items-center gap-2">
        {canBuild ? (
          <Select
            value={project.status}
            disabled={busy}
            onChange={(e) => {
              const status = e.target.value as (typeof PROJECT_STATUSES)[number];
              void save({ status }, status === "launched" ? `${project.name} is live 🎉` : undefined);
            }}
            aria-label="Project status"
          >
            {PROJECT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        ) : (
          <Pill tone={launched ? "ok" : "signal"}>{STATUS_LABELS[project.status] ?? project.status}</Pill>
        )}
        <Button variant="ghost" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Hide details" : "Details"}
        </Button>
      </div>

      {expanded ? (
        <div className="space-y-3 border-t border-line pt-3">
          <ul className="space-y-1.5">
            {checklist.map((item, i) => (
              <li key={`${i}-${item.label}`}>
                {canBuild ? (
                  <label className="flex cursor-pointer items-start gap-2.5 rounded-md px-1.5 py-1 text-sm hover:bg-surface-2">
                    <input
                      type="checkbox"
                      checked={item.done}
                      disabled={busy}
                      onChange={() => void toggleItem(i)}
                      className="mt-0.5 h-4 w-4 accent-[#f9531e]"
                    />
                    <span className={cx("leading-snug", item.done ? "text-faint line-through" : "text-mute")}>
                      {item.label}
                    </span>
                  </label>
                ) : (
                  <div className="flex items-start gap-2.5 px-1.5 py-1 text-sm">
                    <span className={cx("mt-0.5 w-4 text-center text-xs", item.done ? "text-emerald-400" : "text-faint")}>
                      {item.done ? "✓" : "○"}
                    </span>
                    <span className={cx("leading-snug", item.done ? "text-faint line-through" : "text-mute")}>
                      {item.label}
                    </span>
                  </div>
                )}
              </li>
            ))}
            {checklist.length === 0 ? <li className="text-xs text-faint">No checklist on this project.</li> : null}
          </ul>

          <div className="space-y-1">
            <Eyebrow>Launch date</Eyebrow>
            {canBuild ? (
              <input
                type="date"
                defaultValue={project.launch_date ?? ""}
                disabled={busy}
                onChange={(e) => void save({ launch_date: e.target.value || null })}
                className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-bone outline-none focus:border-signal/60"
                aria-label="Launch date"
              />
            ) : (
              <div className="text-sm text-mute">
                {project.launch_date || <span className="text-faint">Not set yet</span>}
              </div>
            )}
          </div>

          <div className="space-y-1">
            <Eyebrow>Notes</Eyebrow>
            {canBuild ? (
              <Textarea
                rows={3}
                value={notes}
                disabled={busy}
                onChange={(e) => setNotes(e.target.value)}
                onBlur={() => {
                  if ((project.notes ?? "") !== notes) void save({ notes });
                }}
                placeholder="Anything the next person picking this up should know…"
              />
            ) : (
              <p className="whitespace-pre-wrap text-sm text-mute">
                {project.notes || <span className="text-faint">No notes yet.</span>}
              </p>
            )}
          </div>

          {canBuild ? (
            <div className="flex justify-end">
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  if (!window.confirm(`Archive ${project.name}? It disappears from the board.`)) return;
                  setBusy(true);
                  archiveProject({ data: { id: project.id } })
                    .then(() => {
                      toast("Project archived.", "success");
                      onChanged();
                    })
                    .catch(() => toast("Couldn't archive.", "error"))
                    .finally(() => setBusy(false));
                }}
              >
                Archive
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

function ProjectsPage() {
  const { projects, canBuild } = Route.useLoaderData() as { projects: ProjectRow[]; canBuild: boolean };
  const router = useRouter();
  const onChanged = () => void router.invalidate();

  const active = projects.filter((p) => p.status !== "launched");
  const launched = projects.filter((p) => p.status === "launched");
  const inReview = active.filter((p) => p.status === "review").length;
  const readyCount = active.filter((p) => {
    const list = parseChecklist(p.checklist);
    return list.length > 0 && list.every((i) => i.done);
  }).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Projects"
        subtitle={
          canBuild
            ? "Every signed deal becomes a build. Walk each one down the checklist to launch."
            : "Every signed deal becomes a build. Barry & Michael keep this board updated — check any project's % to see how far along it is."
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard label="Active builds" value={String(active.length)} accent />
        <SummaryCard label="In client review" value={String(inReview)} />
        <SummaryCard label="Ready to launch" value={String(readyCount)} />
        <SummaryCard label="Launched" value={String(launched.length)} />
      </div>

      {projects.length === 0 ? (
        <EmptyState
          title="No projects yet"
          hint="Win a deal (move it to Launched in the pipeline) and it shows up here automatically with a build checklist."
        />
      ) : (
        <div className="space-y-8">
          {PROJECT_STATUSES.filter((s) => s !== "launched").map((status) => {
            const group = active.filter((p) => p.status === status);
            if (group.length === 0) return null;
            return (
              <section key={status} className="space-y-3">
                <div className="flex items-baseline gap-2">
                  <Eyebrow>
                    {STATUS_LABELS[status]} · {group.length}
                  </Eyebrow>
                  <span className="text-xs text-faint">{STATUS_BLURBS[status]}</span>
                </div>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {group.map((p) => (
                    <ProjectCard key={p.id} project={p} canBuild={canBuild} onChanged={onChanged} />
                  ))}
                </div>
              </section>
            );
          })}

          {launched.length > 0 ? (
            <section className="space-y-3">
              <div className="flex items-baseline gap-2">
                <Eyebrow>Launched · {launched.length}</Eyebrow>
                <span className="text-xs text-faint">{STATUS_BLURBS.launched}</span>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {launched.map((p) => (
                  <ProjectCard key={p.id} project={p} canBuild={canBuild} onChanged={onChanged} />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
