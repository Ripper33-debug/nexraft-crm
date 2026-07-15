import { useEffect, useMemo, useState } from "react";

import { Button, Avatar, Modal, cx } from "./ui";
import { toast } from "./toast";
import { transferOwnership, shareRecord } from "../../lib/crm/data";
import { canAdministerRecord, canEditRecord, parseSharedIds } from "../../lib/crm/constants";

export type AccessEntity = "company" | "contact" | "deal";

type User = { id: string; name: string; email?: string; role?: string };
type Me = { id: string; role: string };

type AccessRecord = {
  id: string;
  owner_id: string | null;
  owner_name?: string | null;
  shared_with: string | null;
};

// The little control that sits in a row / card: a paper-plane "Send" button for
// people who own the record (or admins), a lock for people who can only view, or
// a quiet "shared with you" badge for teammates who've been granted edit rights.
export function RecordAccessButton({
  entity,
  record,
  users,
  me,
  onDone,
}: {
  entity: AccessEntity;
  record: AccessRecord;
  users: User[];
  me: Me;
  onDone?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const canAdmin = canAdministerRecord(me, record.owner_id);
  const canEdit = canEditRecord(me, record.owner_id, record.shared_with);
  const sharedCount = parseSharedIds(record.shared_with).length;

  if (canAdmin) {
    return (
      <>
        <button
          onClick={() => setOpen(true)}
          title={sharedCount ? `Send / sharing with ${sharedCount}` : "Send or share this record"}
          className="relative inline-flex items-center justify-center rounded-md p-1.5 text-faint transition-colors hover:bg-surface-2 hover:text-signal"
          aria-label="Send or share"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 2 11 13" />
            <path d="M22 2 15 22l-4-9-9-4 20-7z" />
          </svg>
          {sharedCount ? (
            <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-signal px-1 text-[9px] font-bold text-ink">
              {sharedCount}
            </span>
          ) : null}
        </button>
        <RecordAccessModal
          open={open}
          onClose={() => setOpen(false)}
          entity={entity}
          record={record}
          users={users}
          me={me}
          onDone={onDone}
        />
      </>
    );
  }

  if (canEdit) {
    return (
      <span
        title="Shared with you — you can edit this record"
        className="inline-flex items-center justify-center rounded-md p-1.5 text-signal/70"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      </span>
    );
  }

  return (
    <span
      title={record.owner_name ? `Owned by ${record.owner_name} — view only` : "View only"}
      className="inline-flex items-center justify-center rounded-md p-1.5 text-faint/70"
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    </span>
  );
}

// The Send / Share dialog: hand off ownership to one person, or grant edit access
// to several. Both are owner-or-admin only (enforced again on the server).
function RecordAccessModal({
  open,
  onClose,
  entity,
  record,
  users,
  me,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  entity: AccessEntity;
  record: AccessRecord;
  users: User[];
  me: Me;
  onDone?: () => void;
}) {
  const [tab, setTab] = useState<"handoff" | "share">("handoff");
  const [handoffTo, setHandoffTo] = useState("");
  const [shareIds, setShareIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  // Reset the form each time the dialog opens for a record.
  useEffect(() => {
    if (open) {
      setTab("handoff");
      setHandoffTo("");
      setShareIds(new Set(parseSharedIds(record.shared_with)));
    }
  }, [open, record.id, record.shared_with]);

  // Everyone except the current owner is a candidate to receive / share.
  const candidates = useMemo(
    () => users.filter((u) => u.id !== record.owner_id),
    [users, record.owner_id],
  );

  const label = { company: "company", contact: "contact", deal: "deal" }[entity];

  async function doHandoff() {
    if (!handoffTo) return;
    setBusy(true);
    try {
      await transferOwnership({ data: { entity, id: record.id, to_user_id: handoffTo } });
      const to = users.find((u) => u.id === handoffTo);
      toast(`Handed off to ${to?.name ?? "teammate"}`);
      onDone?.();
      onClose();
    } catch {
      toast("Couldn't hand it off — try again", "error");
    } finally {
      setBusy(false);
    }
  }

  async function doShare() {
    setBusy(true);
    try {
      await shareRecord({ data: { entity, id: record.id, user_ids: Array.from(shareIds) } });
      toast(shareIds.size ? `Shared with ${shareIds.size} teammate${shareIds.size > 1 ? "s" : ""}` : "Sharing turned off");
      onDone?.();
      onClose();
    } catch {
      toast("Couldn't update sharing — try again", "error");
    } finally {
      setBusy(false);
    }
  }

  function toggleShare(id: string) {
    setShareIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Modal open={open} onClose={onClose} title={`Send this ${label}`}>
      <div className="mb-4 flex items-center gap-1 rounded-lg border border-line bg-surface-2/60 p-1">
        {([
          ["handoff", "Hand off"],
          ["share", "Share access"],
        ] as const).map(([key, text]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cx(
              "flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
              tab === key ? "bg-signal-soft text-signal ring-1 ring-signal/30" : "text-mute hover:text-bone",
            )}
          >
            {text}
          </button>
        ))}
      </div>

      {tab === "handoff" ? (
        <div className="space-y-3">
          <p className="text-xs text-mute">
            Hand this {label} to a teammate — they become the new owner and can edit it. You keep view access
            {me.role === "admin" ? "" : ", but can no longer edit it"}.
          </p>
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {candidates.length === 0 ? (
              <p className="py-4 text-center text-xs text-faint">No other teammates to hand off to.</p>
            ) : (
              candidates.map((u) => (
                <button
                  key={u.id}
                  onClick={() => setHandoffTo(u.id)}
                  className={cx(
                    "flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors",
                    handoffTo === u.id
                      ? "border-signal/50 bg-signal-soft/40"
                      : "border-line bg-surface hover:border-line-strong",
                  )}
                >
                  <Avatar name={u.name} size={26} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-bone">{u.name}</span>
                    {u.email ? <span className="block truncate text-xs text-faint">{u.email}</span> : null}
                  </span>
                  {handoffTo === u.id ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2dd4bf" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  ) : null}
                </button>
              ))
            )}
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={doHandoff} disabled={busy || !handoffTo}>
              {busy ? "Handing off…" : "Hand off"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-mute">
            Pick teammates who can edit this {label} alongside you. You stay the owner. Uncheck everyone to make it
            yours only.
          </p>
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {candidates.length === 0 ? (
              <p className="py-4 text-center text-xs text-faint">No teammates to share with yet.</p>
            ) : (
              candidates.map((u) => {
                const on = shareIds.has(u.id);
                return (
                  <button
                    key={u.id}
                    onClick={() => toggleShare(u.id)}
                    className={cx(
                      "flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors",
                      on ? "border-signal/50 bg-signal-soft/40" : "border-line bg-surface hover:border-line-strong",
                    )}
                  >
                    <span
                      className={cx(
                        "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                        on ? "border-signal bg-signal/20 text-signal" : "border-line-strong text-transparent",
                      )}
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    </span>
                    <Avatar name={u.name} size={26} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-bone">{u.name}</span>
                      {u.email ? <span className="block truncate text-xs text-faint">{u.email}</span> : null}
                    </span>
                  </button>
                );
              })
            )}
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={doShare} disabled={busy}>
              {busy ? "Saving…" : "Save sharing"}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
