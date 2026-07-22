import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import {
  getActivities,
  getDeals,
  getContacts,
  getUsers,
  upsertActivity,
  toggleActivity,
  deleteActivity,
} from "../../lib/crm/data";
import { Button, Card, Field, Input, Modal, Select, Textarea, EmptyState, PageHeader, Pill, PageSkeleton } from "../../components/crm/ui";
import { ACTIVITY_TYPES } from "../../lib/crm/constants";
import { downloadCsv, stampedName } from "../../lib/crm/csv";

type Row = Record<string, unknown>;

function exportActivities(rows: Row[]) {
  downloadCsv(
    stampedName("nexraft_activities"),
    rows.map((a) => ({
      Type: String(a.type ?? ""),
      Subject: String(a.subject ?? ""),
      Status: String(a.status ?? ""),
      "Due date": String(a.due_date ?? "").slice(0, 10),
      Deal: String(a.deal_name ?? ""),
      Owner: String(a.owner_name ?? ""),
      Notes: String(a.notes ?? ""),
    })),
  );
}

export const Route = createFileRoute("/_app/activities")({
  // ?new=true (from the global "+ New" button) lands here with the create
  // modal already open — same deep-link pattern as companies/contacts/pipeline.
  validateSearch: (search: Record<string, unknown>) => ({
    focus: typeof search.focus === "string" ? search.focus : undefined,
    new: search.new === true || search.new === "true" ? true : undefined,
  }),
  loader: async () => {
    const [activities, deals, contacts, users] = await Promise.all([
      getActivities(),
      getDeals(),
      getContacts(),
      getUsers(),
    ]);
    return { activities, deals, contacts, users };
  },
  component: ActivitiesPage,
  pendingComponent: () => <PageSkeleton cards={0} rows={7} />,
});

function isOverdue(due: unknown): boolean {
  if (!due) return false;
  return String(due).slice(0, 10) < new Date().toISOString().slice(0, 10);
}

function ActivitiesPage() {
  const { activities, deals, contacts, users } = Route.useLoaderData();
  const { user: me } = Route.useRouteContext();
  const isAdmin = me?.role === "admin";
  const router = useRouter();
  const { new: newParam } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [showDone, setShowDone] = useState(false);

  // Deep-link from the global "+ New → Task" button: open the create modal on
  // arrival, then clean the param so refresh/back doesn't re-open it.
  useEffect(() => {
    if (!newParam) return;
    setEditing(null);
    setOpen(true);
    void navigate({ search: { focus: undefined, new: undefined }, replace: true });
  }, [newParam, navigate]);

  async function onToggle(id: string, done: boolean) {
    await toggleActivity({ data: { id, done } });
    router.invalidate();
  }
  async function onDelete(id: string) {
    if (!confirm("Delete this activity?")) return;
    await deleteActivity({ data: { id } });
    router.invalidate();
  }

  const rows = (activities as Row[]).filter((a) => (showDone ? true : a.status !== "done"));

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <PageHeader
        title="Tasks & reminders"
        subtitle="Your to-dos with due dates — overdue ones float to the top."
        actions={
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-mute">
              <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} className="accent-signal" />
              Show completed
            </label>
            {isAdmin ? (
              <Button variant="outline" onClick={() => exportActivities(activities as Row[])}>
                Export CSV
              </Button>
            ) : null}
            <Button
              onClick={() => {
                setEditing(null);
                setOpen(true);
              }}
            >
              + New task
            </Button>
          </div>
        }
      />

      <Card className="mt-5 overflow-hidden">
        <ul className="divide-y divide-line/60">
          {rows.map((a) => {
            const done = a.status === "done";
            const overdue = !done && isOverdue(a.due_date);
            return (
              <li key={a.id as string} className="flex items-start gap-3 px-4 py-3">
                <input
                  type="checkbox"
                  checked={done}
                  onChange={(e) => onToggle(a.id as string, e.target.checked)}
                  className="mt-1 accent-signal"
                />
                <div className="min-w-0 flex-1">
                  <button
                    onClick={() => {
                      setEditing(a);
                      setOpen(true);
                    }}
                    className={
                      "text-left text-sm font-medium hover:text-signal " +
                      (done ? "text-faint line-through" : "text-bone")
                    }
                  >
                    {a.subject as string}
                  </button>
                  <div className="text-xs text-faint">
                    <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-mute">
                      {a.type as string}
                    </span>
                    {a.deal_name ? ` · ${a.deal_name as string}` : ""}
                    {a.owner_name ? ` · ${a.owner_name as string}` : ""}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {a.due_date ? (
                    <Pill tone={overdue ? "danger" : "neutral"}>{String(a.due_date).slice(0, 10)}</Pill>
                  ) : null}
                  <button onClick={() => onDelete(a.id as string)} className="text-xs text-faint hover:text-red-600">
                    Delete
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
        {rows.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title={
                !showDone && (activities as Row[]).length > 0
                  ? "Nothing outstanding"
                  : "No activities yet"
              }
              hint={
                !showDone && (activities as Row[]).length > 0
                  ? "Everything's done. Flip on “Show done” to see completed activities."
                  : "Activities are the calls, emails, and to-dos tied to your deals. Log one, and anything with a due date shows up as a follow-up."
              }
              action={
                !showDone && (activities as Row[]).length > 0 ? (
                  <Button variant="outline" onClick={() => setShowDone(true)}>
                    Show done
                  </Button>
                ) : (
                  <Button
                    onClick={() => {
                      setEditing(null);
                      setOpen(true);
                    }}
                  >
                    + New task
                  </Button>
                )
              }
            />
          </div>
        ) : null}
      </Card>

      <ActivityModal
        open={open}
        onClose={() => setOpen(false)}
        activity={editing}
        deals={deals as Row[]}
        contacts={contacts as Row[]}
        users={users as Row[]}
        onSaved={() => {
          setOpen(false);
          router.invalidate();
        }}
      />
    </div>
  );
}

function ActivityModal({
  open,
  onClose,
  activity,
  deals,
  contacts,
  users,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  activity: Row | null;
  deals: Row[];
  contacts: Row[];
  users: Row[];
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    const fd = new FormData(e.currentTarget);
    await upsertActivity({
      data: {
        id: (activity?.id as string) || undefined,
        type: String(fd.get("type") || "Note"),
        subject: String(fd.get("subject") || ""),
        deal_id: (fd.get("deal_id") as string) || null,
        contact_id: (fd.get("contact_id") as string) || null,
        owner_id: (fd.get("owner_id") as string) || null,
        status: (fd.get("status") as string) || "open",
        due_date: (fd.get("due_date") as string) || null,
        notes: (fd.get("notes") as string) || null,
      },
    });
    setSaving(false);
    onSaved();
  }
  return (
    <Modal open={open} onClose={onClose} title={activity ? "Edit activity" : "New activity"} wide>
      <form onSubmit={onSubmit} className="space-y-3">
        <Field label="Subject">
          <Input name="subject" required defaultValue={(activity?.subject as string) || ""} placeholder="Follow up on proposal" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <Select name="type" defaultValue={(activity?.type as string) || "Task"}>
              {ACTIVITY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Due date">
            <Input name="due_date" type="date" defaultValue={((activity?.due_date as string) || "").slice(0, 10)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Related deal">
            <Select name="deal_id" defaultValue={(activity?.deal_id as string) || ""}>
              <option value="">—</option>
              {deals.map((d) => (
                <option key={d.id as string} value={d.id as string}>
                  {d.name as string}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Related contact">
            <Select name="contact_id" defaultValue={(activity?.contact_id as string) || ""}>
              <option value="">—</option>
              {contacts.map((c) => (
                <option key={c.id as string} value={c.id as string}>
                  {`${c.first_name as string} ${(c.last_name as string) || ""}`.trim()}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Owner">
            <Select name="owner_id" defaultValue={(activity?.owner_id as string) || ""}>
              <option value="">—</option>
              {users.map((u) => (
                <option key={u.id as string} value={u.id as string}>
                  {u.name as string}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Status">
            <Select name="status" defaultValue={(activity?.status as string) || "open"}>
              <option value="open">Open</option>
              <option value="done">Done</option>
            </Select>
          </Field>
        </div>
        <Field label="Notes">
          <Textarea name="notes" defaultValue={(activity?.notes as string) || ""} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save activity"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
