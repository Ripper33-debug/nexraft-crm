import { useEffect, useState } from "react";

import { addNote, getNotes, type NoteRow } from "../../lib/crm/data";
import { relativeTime } from "../../lib/crm/constants";
import { Avatar, Button, Eyebrow, Textarea } from "./ui";

type EntityType = "company" | "contact" | "deal";

// Threaded, team-visible comment log for a company / contact / deal. Drop it into
// any detail modal so whoever picks up a client can see who last touched it.
export function NotesThread({
  entityType,
  entityId,
}: {
  entityType: EntityType;
  entityId: string;
}) {
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const rows = await getNotes({ data: { entity_type: entityType, entity_id: entityId } });
      setNotes(rows);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, entityId]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const text = body.trim();
    if (!text) return;
    setSaving(true);
    try {
      await addNote({ data: { entity_type: entityType, entity_id: entityId, body: text } });
      setBody("");
      await load();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <Eyebrow>Team notes</Eyebrow>
      <form onSubmit={submit} className="space-y-2">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Add a note the whole team can see — e.g. “Called Tuesday, waiting on their logo files.”"
          className="min-h-16"
        />
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={saving || !body.trim()}>
            {saving ? "Posting…" : "Post note"}
          </Button>
        </div>
      </form>

      {loading ? (
        <p className="text-xs text-faint">Loading notes…</p>
      ) : notes.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-xs text-faint">
          No notes yet. The first note starts the shared history for this record.
        </p>
      ) : (
        <ul className="space-y-2.5">
          {notes.map((n) => (
            <li key={n.id} className="flex gap-2.5">
              <Avatar name={n.author_name ?? "?"} size={24} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-xs font-semibold text-bone">{n.author_name ?? "Unknown"}</span>
                  <span className="text-[11px] text-faint">{relativeTime(n.created_at)}</span>
                </div>
                <p className="mt-0.5 whitespace-pre-wrap text-sm text-mute">{n.body}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
