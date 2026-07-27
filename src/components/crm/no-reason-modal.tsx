import { useState } from "react";

import { setCompanyCallOutcome } from "../../lib/crm/data";
import { NO_REASONS, noReasonLabel, type NoReasonKey } from "../../lib/crm/constants";
import { Button, Modal } from "./ui";
import { toast } from "./toast";

// Every "no" gets one question before it's filed.
//
// Buttons, not a text box: a rep with a phone in their hand will tap a button
// between calls and will never type a sentence — and free text can't be
// counted, which is the whole point. Skipping is allowed (a forced answer is
// just a lie in the data), but the ask happens every time.
//
// Lives here rather than in calls.tsx because a company can be marked "No" from
// four different screens, and a reason we only collect on one of them produces
// a tally that quietly under-counts whichever reason reps meet elsewhere.
export function NoReasonModal({
  company,
  onClose,
  onDone,
}: {
  company: Record<string, unknown>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const name = (company.name as string) || "this company";

  async function save(reason: NoReasonKey | null) {
    setBusy(true);
    try {
      await setCompanyCallOutcome({
        data: { id: company.id as string, outcome: "not_interested", no_reason: reason },
      });
      toast(reason ? `${name} → No · ${noReasonLabel(reason)}` : `${name} → No`);
      onDone();
    } catch {
      toast("Couldn't save — you may not own this one", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Why did ${name} say no?`}>
      <p className="text-sm text-mute">
        One tap. Enough of these and we can see whether it's the list, the opener or the price
        that's costing us — instead of guessing.
      </p>
      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {NO_REASONS.map((r) => (
          <button
            key={r.key}
            disabled={busy}
            onClick={() => void save(r.key)}
            className="rounded-lg border border-line bg-surface px-3 py-2.5 text-left text-sm text-bone transition-colors hover:border-signal/50 hover:bg-signal-soft/20 disabled:opacity-50"
          >
            {r.label}
          </button>
        ))}
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
        <button
          onClick={() => void save(null)}
          disabled={busy}
          className="text-xs text-faint underline-offset-2 hover:text-mute hover:underline disabled:opacity-50"
        >
          Skip — just mark it No
        </button>
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
      </div>
    </Modal>
  );
}
