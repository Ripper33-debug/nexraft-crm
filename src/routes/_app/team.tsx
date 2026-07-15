import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import {
  getTeamOverview,
  getUserDetail,
  getSignupCode,
  adminCreateUser,
  adminUpdateRole,
  adminResetPassword,
  adminDeleteUser,
  type TeamMemberRow,
} from "../../lib/crm/data";
import {
  Button,
  Card,
  Field,
  Input,
  Select,
  Modal,
  PageHeader,
  SummaryCard,
  Eyebrow,
  OwnerChip,
  Avatar,
  Pill,
  StageBadge,
} from "../../components/crm/ui";
import { formatMoney } from "../../lib/crm/constants";

export const Route = createFileRoute("/_app/team")({
  beforeLoad: ({ context }) => {
    const user = (context as { user?: { role?: string } }).user;
    if (!user || user.role !== "admin") {
      throw redirect({ to: "/" });
    }
  },
  loader: async () => {
    const [team, code] = await Promise.all([getTeamOverview(), getSignupCode()]);
    return { team, code: code.code };
  },
  component: TeamPage,
});

type Detail = Awaited<ReturnType<typeof getUserDetail>>;

function TeamPage() {
  const { team, code } = Route.useLoaderData();
  const router = useRouter();
  const rows = team as TeamMemberRow[];

  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [resetFor, setResetFor] = useState<TeamMemberRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => router.invalidate();

  const totals = rows.reduce(
    (acc, r) => ({
      open_value: acc.open_value + Number(r.open_value),
      won_value: acc.won_value + Number(r.won_value),
      open_count: acc.open_count + Number(r.open_count),
    }),
    { open_value: 0, won_value: 0, open_count: 0 },
  );

  async function openDetail(id: string) {
    setDetailLoading(true);
    try {
      const d = await getUserDetail({ data: { id } });
      setDetail(d);
    } finally {
      setDetailLoading(false);
    }
  }

  async function changeRole(r: TeamMemberRow) {
    setBusy(true);
    setError(null);
    const next = r.role === "admin" ? "member" : "admin";
    const res = await adminUpdateRole({ data: { id: r.id, role: next } });
    if (!res.ok) setError(res.error);
    await refresh();
    setBusy(false);
  }

  async function removeUser(r: TeamMemberRow) {
    if (!confirm(`Remove ${r.name}? Their records stay but become unassigned.`)) return;
    setBusy(true);
    setError(null);
    const res = await adminDeleteUser({ data: { id: r.id } });
    if (!res.ok) setError(res.error);
    await refresh();
    setBusy(false);
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <PageHeader
        title="Team"
        subtitle="Admin view — everything your team has in the CRM."
        actions={<Button onClick={() => setAddOpen(true)}>+ Add teammate</Button>}
      />

      {error ? (
        <div className="mt-4 rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-400">{error}</div>
      ) : null}

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard label="Team members" value={String(rows.length)} />
        <SummaryCard label="Open pipeline" value={formatMoney(totals.open_value)} sub={`${totals.open_count} deals`} accent />
        <SummaryCard label="Won (all time)" value={formatMoney(totals.won_value)} />
        <div className="rounded-xl border border-line bg-surface p-4">
          <Eyebrow>Team access code</Eyebrow>
          <div className="mt-2 font-mono text-lg font-semibold text-signal">{code}</div>
          <div className="mt-0.5 text-xs text-faint">Share so teammates can sign up</div>
        </div>
      </div>

      <Card className="mt-4 overflow-hidden">
        <div className="border-b border-line px-4 py-3">
          <Eyebrow>Per-member breakdown</Eyebrow>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                <th className="px-4 py-2.5 font-medium">Member</th>
                <th className="px-4 py-2.5 font-medium">Open pipeline</th>
                <th className="px-4 py-2.5 font-medium">Won</th>
                <th className="px-4 py-2.5 font-medium">Companies</th>
                <th className="px-4 py-2.5 font-medium">Contacts</th>
                <th className="px-4 py-2.5 font-medium">Follow-ups</th>
                <th className="px-4 py-2.5 font-medium">Role</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-line/60 last:border-0 hover:bg-surface-2/60">
                  <td className="px-4 py-2.5">
                    <button onClick={() => openDetail(r.id)} className="inline-flex items-center gap-2 text-left">
                      <Avatar name={r.name} size={22} />
                      <span>
                        <span className="block font-medium text-bone hover:text-signal">{r.name}</span>
                        <span className="block text-xs text-faint">{r.email}</span>
                      </span>
                    </button>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-bone">{formatMoney(Number(r.open_value))}</div>
                    <div className="text-xs text-faint">{r.open_count} open</div>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="text-mute">{formatMoney(Number(r.won_value))}</div>
                    <div className="text-xs text-faint">{r.won_count} won</div>
                  </td>
                  <td className="px-4 py-2.5 text-mute">{r.companies_count}</td>
                  <td className="px-4 py-2.5 text-mute">{r.contacts_count}</td>
                  <td className="px-4 py-2.5">
                    {Number(r.overdue_activities) > 0 ? (
                      <Pill tone="danger">{r.overdue_activities} overdue</Pill>
                    ) : (
                      <span className="text-mute">{r.open_activities} open</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {r.role === "admin" ? <Pill tone="signal">Admin</Pill> : <Pill tone="neutral">Member</Pill>}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        disabled={busy}
                        onClick={() => changeRole(r)}
                        className="text-xs text-mute hover:text-signal disabled:opacity-50"
                      >
                        {r.role === "admin" ? "Make member" : "Make admin"}
                      </button>
                      <span className="text-line-strong">·</span>
                      <button
                        disabled={busy}
                        onClick={() => {
                          setResetFor(r);
                          setError(null);
                        }}
                        className="text-xs text-mute hover:text-signal disabled:opacity-50"
                      >
                        Reset password
                      </button>
                      <span className="text-line-strong">·</span>
                      <button
                        disabled={busy}
                        onClick={() => removeUser(r)}
                        className="text-xs text-faint hover:text-red-400 disabled:opacity-50"
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <MemberDetailModal
        detail={detail}
        loading={detailLoading}
        onClose={() => setDetail(null)}
      />

      <AddTeammateModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSaved={async () => {
          setAddOpen(false);
          await refresh();
        }}
      />

      <ResetPasswordModal
        member={resetFor}
        onClose={() => setResetFor(null)}
        onSaved={() => setResetFor(null)}
      />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <Eyebrow className="mb-1.5">{title}</Eyebrow>
      {children}
    </div>
  );
}

function MemberDetailModal({
  detail,
  loading,
  onClose,
}: {
  detail: Detail | null;
  loading: boolean;
  onClose: () => void;
}) {
  if (!detail && !loading) return null;
  return (
    <Modal open onClose={onClose} title={detail ? detail.user.name : "Loading…"} wide>
      {loading || !detail ? (
        <div className="py-8 text-center text-sm text-mute">Loading…</div>
      ) : (
        <div className="space-y-5">
          <div className="flex items-center gap-3">
            <Avatar name={detail.user.name} size={40} />
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium text-bone">{detail.user.name}</span>
                {detail.user.role === "admin" ? <Pill tone="signal">Admin</Pill> : null}
              </div>
              <div className="text-xs text-faint">{detail.user.email}</div>
            </div>
          </div>

          <Section title={`Deals (${detail.deals.length})`}>
            {detail.deals.length === 0 ? (
              <p className="text-sm text-faint">No deals owned.</p>
            ) : (
              <ul className="divide-y divide-line/60 rounded-lg border border-line">
                {detail.deals.map((d) => (
                  <li key={d.id as string} className="flex items-center justify-between gap-2 px-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm text-bone">{d.name as string}</div>
                      <div className="truncate text-xs text-faint">{(d.company_name as string) || "No company"}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="font-mono text-xs text-signal">{formatMoney(Number(d.value))}</span>
                      <StageBadge stage={d.stage as string} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <div className="grid gap-4 sm:grid-cols-2">
            <Section title={`Companies (${detail.companies.length})`}>
              {detail.companies.length === 0 ? (
                <p className="text-sm text-faint">None.</p>
              ) : (
                <ul className="space-y-1">
                  {detail.companies.map((c) => (
                    <li key={c.id as string} className="text-sm text-bone">
                      {c.name as string}
                      {c.city ? <span className="text-faint"> · {c.city as string}</span> : null}
                    </li>
                  ))}
                </ul>
              )}
            </Section>
            <Section title={`Contacts (${detail.contacts.length})`}>
              {detail.contacts.length === 0 ? (
                <p className="text-sm text-faint">None.</p>
              ) : (
                <ul className="space-y-1">
                  {detail.contacts.map((c) => (
                    <li key={c.id as string} className="text-sm text-bone">
                      {`${c.first_name as string} ${(c.last_name as string) || ""}`.trim()}
                      {c.title ? <span className="text-faint"> · {c.title as string}</span> : null}
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>

          <Section title={`Activities (${detail.activities.length})`}>
            {detail.activities.length === 0 ? (
              <p className="text-sm text-faint">None.</p>
            ) : (
              <ul className="divide-y divide-line/60 rounded-lg border border-line">
                {detail.activities.map((a) => (
                  <li key={a.id as string} className="flex items-center justify-between gap-2 px-3 py-2">
                    <div className="min-w-0">
                      <div className={"truncate text-sm " + (a.status === "done" ? "text-faint line-through" : "text-bone")}>
                        {a.subject as string}
                      </div>
                      <div className="text-xs text-faint">{a.type as string}{a.deal_name ? ` · ${a.deal_name as string}` : ""}</div>
                    </div>
                    {a.due_date ? <Pill tone="neutral">{String(a.due_date).slice(0, 10)}</Pill> : null}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      )}
    </Modal>
  );
}

function AddTeammateModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const res = await adminCreateUser({
      data: {
        name: String(fd.get("name") || ""),
        email: String(fd.get("email") || ""),
        password: String(fd.get("password") || ""),
        role: (String(fd.get("role") || "member") as "admin" | "member"),
      },
    });
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onSaved();
  }

  return (
    <Modal open={open} onClose={onClose} title="Add teammate">
      <form onSubmit={onSubmit} className="space-y-3">
        {error ? <div className="rounded-lg bg-red-500/15 px-3 py-2 text-xs text-red-400">{error}</div> : null}
        <Field label="Full name">
          <Input name="name" required placeholder="Their name" />
        </Field>
        <Field label="Email">
          <Input name="email" type="email" required placeholder="teammate@nexraft.com" />
        </Field>
        <Field label="Temporary password">
          <Input name="password" type="text" required minLength={8} placeholder="At least 8 characters" />
        </Field>
        <Field label="Role">
          <Select name="role" defaultValue="member">
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </Select>
        </Field>
        <p className="text-xs text-faint">
          They can sign in right away with this email and password, then change it later.
        </p>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Adding…" : "Add teammate"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ResetPasswordModal({
  member,
  onClose,
  onSaved,
}: {
  member: TeamMemberRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!member) return null;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!member) return;
    setSaving(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    try {
      await adminResetPassword({
        data: { id: member.id, password: String(fd.get("password") || "") },
      });
      setSaving(false);
      onSaved();
    } catch {
      setSaving(false);
      setError("Couldn't reset the password. Please try again.");
    }
  }

  return (
    <Modal open onClose={onClose} title={`Reset password — ${member.name}`}>
      <form onSubmit={onSubmit} className="space-y-3">
        {error ? <div className="rounded-lg bg-red-500/15 px-3 py-2 text-xs text-red-400">{error}</div> : null}
        <Field label="New password">
          <Input name="password" type="text" required minLength={8} placeholder="At least 8 characters" />
        </Field>
        <p className="text-xs text-faint">
          This signs {member.name} out everywhere. Share the new password with them directly.
        </p>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Set password"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
