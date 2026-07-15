import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import {
  getActivities,
  getDeals,
  getContacts,
  getUsers,
  upsertActivity,
  toggleActivity,
  deleteActivity,
} from "../../lib/crm/data";
import { Button, Card, Field, Input, Modal, Select, Textarea, EmptyState, PageHeader, Pill } from "../../components/crm/ui";
import { ACTIVITY_TYPES } from "../../lib/crm/constants";

type Row = Record<string, unknown>;

export const Route = createFileRoute("/_app/activities")({
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
});

function isOverdue(due: unknown): boolean {
  if (!due) return false;
  return String(due).slice(0, 10) < new Date().toISOString().slice(0, 10);
}

function ActivitiesPage() {
  const { activities, deals, contacts, users } = Route.useLoaderData();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [showDone, setShowDone] = useState(false);

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
        title="Activities & follow-ups"
        subtitle="Calls, meetings, tasks and reminders."
        actions={
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-mute">
              <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} className="accent-signal" />
              Show completed
            </label>
            <Button
              onClick={() => {
                setEditing(null);
                setOpen(true);
              }}
            >
              + New activity
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
                  <button onClick={() => onDelete(a.id as string)} className="text-xs text-faint hover:text-red-400">
                    Delete
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
        {rows.length === 0 ? (
          <div className="p-4">
            <EmptyState title="Nothing here" hint="Log a call or set a follow-up reminder." />
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
