import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import {
  getPayroll,
  recordPayrollPayment,
  deletePayrollPayment,
  setPayCadence,
  type PayrollRep,
} from "../../lib/crm/data";
import {
  Button,
  Card,
  EmptyState,
  Modal,
  PageHeader,
  Field,
  Input,
  SummaryCard,
  Avatar,
  Pill,
} from "../../components/crm/ui";
import { toast } from "../../components/crm/toast";
import {
  formatMoney,
  relativeTime,
  PAY_CADENCES,
  payCadenceLabel,
  COMMISSION_RATE,
  COMMISSION_MONTHS,
  SALES_BONUS_AMOUNT,
  SALES_BONUS_THRESHOLD,
} from "../../lib/crm/constants";

const GATE_CODE = "1029";
const GATE_KEY = "nexraft_payroll_ok";

export const Route = createFileRoute("/_app/payroll")({
  loader: async () => {
    const data = await getPayroll();
    return data;
  },
  component: PayrollPage,
});

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function monthLabel(ym: string | null): string {
  if (!ym) return "";
  const d = new Date(ym + "-01T00:00:00Z");
  if (isNaN(d.getTime())) return ym;
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

// A light 4-digit lock so payroll isn't the first thing a teammate sees. It's a
// convenience screen, not real security — see the note in the page footer.
function Gate({ onUnlock }: { onUnlock: () => void }) {
  const [code, setCode] = useState("");
  const [err, setErr] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (code === GATE_CODE) {
      try {
        sessionStorage.setItem(GATE_KEY, "1");
      } catch {
        /* ignore */
      }
      onUnlock();
    } else {
      setErr(true);
      setCode("");
    }
  }

  return (
    <div className="mx-auto max-w-sm px-4 py-24">
      <Card className="p-6 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-signal-soft text-signal">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
        <h2 className="mt-4 text-lg font-semibold text-bone">Payroll is locked</h2>
        <p className="mt-1 text-sm text-mute">Enter the code to view sales commissions and payments.</p>
        <form onSubmit={submit} className="mt-5">
          <Input
            autoFocus
            inputMode="numeric"
            type="password"
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              setErr(false);
            }}
            placeholder="••••"
            className="text-center text-lg tracking-[0.5em]"
          />
          {err ? <p className="mt-2 text-xs text-red-400">That code didn't match. Try again.</p> : null}
          <Button type="submit" className="mt-4 w-full">
            Unlock
          </Button>
        </form>
      </Card>
    </div>
  );
}

// Record a commission / bonus payment to a rep, prefilled with what they're owed.
function PayModal({
  rep,
  onClose,
  onSaved,
}: {
  rep: PayrollRep | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [paidAt, setPaidAt] = useState(todayISO());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (rep) {
      setAmount(rep.owed > 0 ? String(Math.round(rep.owed)) : "");
      setPaidAt(todayISO());
      setNote("");
    }
  }, [rep]);

  async function save() {
    if (!rep || busy) return;
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      toast("Enter an amount greater than 0", "error");
      return;
    }
    setBusy(true);
    try {
      await recordPayrollPayment({
        data: { user_id: rep.id, amount: amt, paid_at: paidAt, note: note.trim() || null },
      });
      toast(`Logged ${formatMoney(amt)} to ${rep.name}`);
      onSaved();
      onClose();
    } catch {
      toast("Couldn't save that payment", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={!!rep} onClose={onClose} title={rep ? `Pay ${rep.name}` : "Pay"}>
      {rep ? (
        <>
          <div className="mb-4 rounded-lg border border-line bg-surface px-3 py-2 text-xs text-mute">
            Owed right now: <span className="font-semibold text-bone">{formatMoney(rep.owed)}</span>{" "}
            <span className="text-faint">
              ({formatMoney(rep.earned)} earned − {formatMoney(rep.paid)} paid)
            </span>
          </div>
          <Field label="Amount">
            <Input
              autoFocus
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              placeholder="0"
            />
          </Field>
          <div className="mt-3">
            <Field label="Paid on">
              <Input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
            </Field>
          </div>
          <div className="mt-3">
            <Field label="Note (optional)">
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. July commission" />
            </Field>
          </div>
          <div className="mt-5 flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={save} disabled={busy}>
              {busy ? "Saving…" : "Log payment"}
            </Button>
          </div>
        </>
      ) : null}
    </Modal>
  );
}

function RepCard({
  rep,
  onPay,
  onChanged,
}: {
  rep: PayrollRep;
  onPay: (r: PayrollRep) => void;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busyCadence, setBusyCadence] = useState(false);

  async function changeCadence(cadence: "monthly" | "biweekly") {
    if (rep.cadence === cadence || busyCadence) return;
    setBusyCadence(true);
    try {
      await setPayCadence({ data: { user_id: rep.id, cadence } });
      onChanged();
    } catch {
      toast("Couldn't update pay cadence", "error");
    } finally {
      setBusyCadence(false);
    }
  }

  async function removePayment(p: { id: string; amount: number; paid_at: string; note: string | null }) {
    try {
      await deletePayrollPayment({ data: { id: p.id } });
      onChanged();
      toast("Payment removed", "info", {
        label: "Undo",
        onClick: async () => {
          await recordPayrollPayment({
            data: { user_id: rep.id, amount: p.amount, paid_at: p.paid_at, note: p.note },
          });
          onChanged();
        },
      });
    } catch {
      toast("Couldn't remove that payment", "error");
    }
  }

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Avatar name={rep.name} size={34} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-bone">{rep.name}</span>
            {rep.bonusEarned > 0 ? <Pill tone="signal">Bonus earned</Pill> : null}
          </div>
          <div className="text-xs text-mute">
            {rep.salesTotal} signed · {formatMoney(rep.monthlyBook)}/mo in retainers
          </div>
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-line bg-surface p-0.5">
          {PAY_CADENCES.map((c) => (
            <button
              key={c.id}
              onClick={() => changeCadence(c.id)}
              disabled={busyCadence}
              className={
                "rounded-md px-2.5 py-1 text-[11px] font-semibold transition-all " +
                (rep.cadence === c.id ? "bg-signal-soft text-signal" : "text-mute hover:text-bone")
              }
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <div className="rounded-lg border border-line bg-surface px-3 py-2">
          <div className="font-mono text-[10px] uppercase tracking-wider text-faint">Earned</div>
          <div className="tnum mt-0.5 text-lg font-semibold text-bone">{formatMoney(rep.earned)}</div>
        </div>
        <div className="rounded-lg border border-line bg-surface px-3 py-2">
          <div className="font-mono text-[10px] uppercase tracking-wider text-faint">Paid</div>
          <div className="tnum mt-0.5 text-lg font-semibold text-mute">{formatMoney(rep.paid)}</div>
        </div>
        <div className="rounded-lg border border-signal/30 bg-signal-soft/20 px-3 py-2">
          <div className="font-mono text-[10px] uppercase tracking-wider text-signal">Owed</div>
          <div className="tnum mt-0.5 text-lg font-semibold text-signal">{formatMoney(rep.owed)}</div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <button
          onClick={() => setOpen((o) => !o)}
          className="text-xs font-medium text-mute hover:text-signal"
        >
          {open ? "Hide details" : `Details — ${rep.deals.length} deals, ${rep.payments.length} payments`}
        </button>
        <Button size="sm" onClick={() => onPay(rep)} disabled={rep.owed <= 0}>
          {rep.owed > 0 ? `Pay ${formatMoney(rep.owed)}` : "Nothing owed"}
        </Button>
      </div>

      {open ? (
        <div className="mt-4 space-y-4 border-t border-line pt-4">
          {rep.bonusEarned > 0 ? (
            <div className="rounded-lg border border-signal/30 bg-signal-soft/20 px-3 py-2 text-xs text-signal">
              🎉 {formatMoney(rep.bonusEarned)} bonus — signed {rep.bestMonthCount} in {monthLabel(rep.bonusMonth)}{" "}
              (hit {SALES_BONUS_THRESHOLD}+ in a month).
            </div>
          ) : rep.bestMonthCount > 0 ? (
            <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs text-faint">
              Best month so far: {rep.bestMonthCount} signed. {SALES_BONUS_THRESHOLD - rep.bestMonthCount} more
              in a single month unlocks the {formatMoney(SALES_BONUS_AMOUNT)} bonus.
            </div>
          ) : null}

          <div>
            <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-faint">
              Signed retainers ({formatMoney(rep.commissionEarned)} earned so far)
            </div>
            {rep.deals.length === 0 ? (
              <p className="text-xs text-faint">No signed deals yet.</p>
            ) : (
              <div className="divide-y divide-line/50 overflow-hidden rounded-lg border border-line">
                {rep.deals.map((d) => (
                  <div key={d.id} className="flex items-center gap-2 bg-surface px-3 py-2 text-xs">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-bone">{d.company_name || d.name}</div>
                      <div className="text-faint">
                        {d.monthly > 0 ? `${formatMoney(d.monthly)}/mo` : "No retainer"} · signed{" "}
                        {relativeTime(d.signed_at)}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-bone">{formatMoney(d.earned)}</div>
                      <div className="text-faint">
                        {d.monthly > 0 ? `mo ${d.earnedMonths}/${COMMISSION_MONTHS}` : "—"}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-faint">Payments</div>
            {rep.payments.length === 0 ? (
              <p className="text-xs text-faint">Nothing paid out yet.</p>
            ) : (
              <div className="divide-y divide-line/50 overflow-hidden rounded-lg border border-line">
                {rep.payments.map((p) => (
                  <div key={p.id} className="flex items-center gap-2 bg-surface px-3 py-2 text-xs">
                    <div className="min-w-0 flex-1">
                      <div className="text-bone">{formatMoney(p.amount)}</div>
                      <div className="truncate text-faint">
                        {p.paid_at}
                        {p.note ? ` · ${p.note}` : ""}
                      </div>
                    </div>
                    <button
                      onClick={() => removePayment(p)}
                      className="shrink-0 rounded-md px-2 py-1 text-faint transition-colors hover:bg-surface-2 hover:text-red-400"
                      aria-label="Remove payment"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function PayrollPage() {
  const { reps } = Route.useLoaderData();
  const router = useRouter();
  const [unlocked, setUnlocked] = useState(false);
  const [paying, setPaying] = useState<PayrollRep | null>(null);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(GATE_KEY) === "1") setUnlocked(true);
    } catch {
      /* ignore */
    }
  }, []);

  const totals = useMemo(() => {
    return (reps as PayrollRep[]).reduce(
      (acc, r) => {
        acc.earned += r.earned;
        acc.paid += r.paid;
        acc.owed += r.owed;
        return acc;
      },
      { earned: 0, paid: 0, owed: 0 },
    );
  }, [reps]);

  // Reps with any activity first (most owed at the top), then the rest.
  const sorted = useMemo(() => {
    return [...(reps as PayrollRep[])].sort((a, b) => {
      const aAct = a.salesTotal + a.payments.length;
      const bAct = b.salesTotal + b.payments.length;
      if ((aAct > 0) !== (bAct > 0)) return bAct - aAct > 0 ? 1 : -1;
      if (b.owed !== a.owed) return b.owed - a.owed;
      return a.name.localeCompare(b.name);
    });
  }, [reps]);

  if (!unlocked) return <Gate onUnlock={() => setUnlocked(true)} />;

  const active = sorted.filter((r) => r.salesTotal + r.payments.length > 0);
  const idle = sorted.filter((r) => r.salesTotal + r.payments.length === 0);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
      <PageHeader
        title="Payroll"
        subtitle={`Reps earn ${Math.round(COMMISSION_RATE * 100)}% of each signed retainer for ${COMMISSION_MONTHS} months, plus a ${formatMoney(SALES_BONUS_AMOUNT)} bonus the first month they sign ${SALES_BONUS_THRESHOLD}.`}
        actions={
          <button
            onClick={() => {
              try {
                sessionStorage.removeItem(GATE_KEY);
              } catch {
                /* ignore */
              }
              setUnlocked(false);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-mute transition-colors hover:border-line-strong hover:text-bone"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            Lock
          </button>
        }
      />

      <div className="mt-5 grid grid-cols-3 gap-3">
        <SummaryCard label="Earned to date" value={formatMoney(totals.earned)} sub="commission + bonuses" />
        <SummaryCard label="Paid out" value={formatMoney(totals.paid)} sub="recorded payments" />
        <SummaryCard label="Owed now" value={formatMoney(totals.owed)} sub="still to pay" accent />
      </div>

      {active.length === 0 ? (
        <Card className="mt-5 p-4">
          <EmptyState
            title="No signed deals yet"
            hint="When a rep marks a company Signed on the Calls board, their commission shows up here."
          />
        </Card>
      ) : (
        <div className="mt-5 space-y-3">
          {active.map((r) => (
            <RepCard key={r.id} rep={r} onPay={setPaying} onChanged={() => router.invalidate()} />
          ))}
        </div>
      )}

      {idle.length > 0 ? (
        <details className="mt-5">
          <summary className="cursor-pointer text-xs font-medium text-faint hover:text-mute">
            {idle.length} teammate{idle.length > 1 ? "s" : ""} with no sales yet
          </summary>
          <div className="mt-3 space-y-3">
            {idle.map((r) => (
              <RepCard key={r.id} rep={r} onPay={setPaying} onChanged={() => router.invalidate()} />
            ))}
          </div>
        </details>
      ) : null}

      <p className="mt-6 text-[11px] leading-relaxed text-faint">
        Cadence is per-rep — {PAY_CADENCES.map((c) => c.label).join(" or ")} — and just changes how you
        plan payouts; the earned/owed math is the same either way. The {GATE_CODE.length}-digit lock keeps
        payroll off casual glances but isn't strong security, so don't treat it as protecting sensitive pay
        data from someone determined.
      </p>

      <PayModal rep={paying} onClose={() => setPaying(null)} onSaved={() => router.invalidate()} />
    </div>
  );
}
