import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import {
  getBillingOverview,
  getCompanies,
  getContacts,
  createStripeInvoice,
  refreshInvoiceStatus,
  type InvoiceRow,
} from "../../lib/crm/data";
import {
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  Pill,
  Select,
  SummaryCard,
  Textarea,
} from "../../components/crm/ui";
import { toast } from "../../components/crm/toast";
import { relativeTime } from "../../lib/crm/constants";

// Admin-only Stripe invoicing. Config-gated exactly like Gmail: until
// STRIPE_SECRET_KEY lands in Vercel this page shows the setup steps, and the
// moment it's set the same page becomes a working billing desk — no deploy.

type Row = Record<string, unknown>;

export const Route = createFileRoute("/_app/billing")({
  beforeLoad: ({ context }) => {
    const user = (context as { user?: { role?: string } }).user;
    if (!user || user.role !== "admin") {
      throw redirect({ to: "/" });
    }
  },
  loader: async () => {
    const [billing, companies, contacts] = await Promise.all([
      getBillingOverview(),
      getCompanies(),
      getContacts().catch(() => [] as Row[]),
    ]);
    return { billing, companies: companies as Row[], contacts: contacts as Row[] };
  },
  component: BillingPage,
});

function statusTone(status: string): "ok" | "warn" | "danger" | "neutral" {
  if (status === "paid") return "ok";
  if (status === "open") return "warn";
  if (status === "void" || status === "uncollectible") return "danger";
  return "neutral";
}

function SetupCard() {
  return (
    <Card className="space-y-3 p-5">
      <div className="text-sm font-semibold text-bone">Connect Stripe to start invoicing</div>
      <p className="text-sm leading-relaxed text-mute">
        Billing is built and waiting on one key. Once it&apos;s in place, you can send hosted Stripe invoices to any
        company straight from this page — clients get a payment link by email and pay by card or bank.
      </p>
      <ol className="list-decimal space-y-1.5 pl-5 text-sm text-mute">
        <li>
          Open the{" "}
          <a
            className="text-signal underline-offset-2 hover:underline"
            href="https://dashboard.stripe.com/apikeys"
            target="_blank"
            rel="noreferrer"
          >
            Stripe dashboard → API keys
          </a>{" "}
          and copy the <span className="font-mono text-xs text-bone">Secret key</span> (starts with{" "}
          <span className="font-mono text-xs text-bone">sk_live_</span>).
        </li>
        <li>
          In Vercel, open the CRM project → Settings → Environment Variables and add{" "}
          <span className="font-mono text-xs text-bone">STRIPE_SECRET_KEY</span> with that value.
        </li>
        <li>Redeploy (or just wait for the next push) — this page lights up automatically.</li>
      </ol>
      <p className="text-xs text-faint">
        Tip: use a <span className="font-mono">sk_test_</span> key first to try it end-to-end without charging anyone.
      </p>
    </Card>
  );
}

function NewInvoiceModal({
  open,
  onClose,
  companies,
  contacts,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  companies: Row[];
  contacts: Row[];
  onCreated: () => void;
}) {
  const [companyId, setCompanyId] = useState("");
  const [email, setEmail] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [days, setDays] = useState("14");
  const [busy, setBusy] = useState(false);

  // Prefill the billing email from the company's first contact with one.
  const suggestedEmail = useMemo(() => {
    if (!companyId) return "";
    const hit = contacts.find((c) => c.company_id === companyId && typeof c.email === "string" && c.email);
    return (hit?.email as string) ?? "";
  }, [companyId, contacts]);

  function pickCompany(id: string) {
    setCompanyId(id);
    const hit = contacts.find((c) => c.company_id === id && typeof c.email === "string" && c.email);
    if (hit?.email) setEmail(hit.email as string);
  }

  async function submit() {
    const amt = Number(amount);
    if (!companyId) return toast("Pick a company.", "error");
    if (!email.trim() || !email.includes("@")) return toast("Enter the client's billing email.", "error");
    if (!Number.isFinite(amt) || amt <= 0) return toast("Enter an amount greater than zero.", "error");
    if (!description.trim()) return toast("Describe what this invoice is for.", "error");
    setBusy(true);
    try {
      const res = await createStripeInvoice({
        data: {
          company_id: companyId,
          email: email.trim(),
          amount: amt,
          description: description.trim(),
          days_until_due: Math.min(90, Math.max(1, Number(days) || 14)),
        },
      });
      if (!res.ok) {
        toast(res.error, "error");
        return;
      }
      toast("Invoice sent — Stripe emails the client a payment link.", "success");
      setCompanyId("");
      setEmail("");
      setAmount("");
      setDescription("");
      onClose();
      onCreated();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't create the invoice.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New invoice" wide>
      <div className="space-y-3">
        <Field label="Company">
          <Select value={companyId} onChange={(e) => pickCompany(e.target.value)}>
            <option value="">Choose a company…</option>
            {companies.map((c) => (
              <option key={c.id as string} value={c.id as string}>
                {c.name as string}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Billing email">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={suggestedEmail || "client@company.com"}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount (USD)">
            <Input
              type="number"
              min="1"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="2500"
            />
          </Field>
          <Field label="Due in (days)">
            <Input type="number" min="1" max="90" value={days} onChange={(e) => setDays(e.target.value)} />
          </Field>
        </div>
        <Field label="Description (appears on the invoice)">
          <Textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Website design & build — 50% deposit"
          />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? "Sending…" : "Create & send"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function BillingPage() {
  const { billing, companies, contacts } = Route.useLoaderData() as {
    billing: { configured: boolean; invoices: InvoiceRow[] };
    companies: Row[];
    contacts: Row[];
  };
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [refreshing, setRefreshing] = useState<string | null>(null);

  const invoices = billing.invoices;
  const openTotal = invoices.filter((i) => i.status === "open").reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const paidTotal = invoices.filter((i) => i.status === "paid").reduce((s, i) => s + (Number(i.amount) || 0), 0);

  async function refresh(inv: InvoiceRow) {
    setRefreshing(inv.id);
    try {
      const res = await refreshInvoiceStatus({ data: { id: inv.id } });
      if (!res.ok) {
        toast(res.error, "error");
        return;
      }
      toast(`Status: ${res.status}`, "success");
      void router.invalidate();
    } catch {
      toast("Couldn't reach Stripe.", "error");
    } finally {
      setRefreshing(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Billing"
        subtitle="Send hosted Stripe invoices and track what's outstanding."
        actions={
          billing.configured ? <Button onClick={() => setModalOpen(true)}>New invoice</Button> : undefined
        }
      />

      {!billing.configured ? (
        <SetupCard />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <SummaryCard label="Outstanding" value={`$${openTotal.toLocaleString()}`} accent />
            <SummaryCard label="Collected" value={`$${paidTotal.toLocaleString()}`} />
            <SummaryCard label="Open invoices" value={String(invoices.filter((i) => i.status === "open").length)} />
            <SummaryCard label="All invoices" value={String(invoices.length)} />
          </div>

          {invoices.length === 0 ? (
            <EmptyState
              title="No invoices yet"
              hint="Hit New invoice to bill your first client — Stripe emails them a hosted payment link."
            />
          ) : (
            <Card className="overflow-x-auto p-0">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
                    <th className="px-4 py-3 font-medium">Company</th>
                    <th className="px-4 py-3 font-medium">Description</th>
                    <th className="px-4 py-3 text-right font-medium">Amount</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Created</th>
                    <th className="px-4 py-3 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr key={inv.id} className="border-b border-line/60 last:border-0 hover:bg-surface-2/50">
                      <td className="px-4 py-3 font-medium text-bone">{inv.company_name ?? "—"}</td>
                      <td className="max-w-[220px] truncate px-4 py-3 text-mute" title={inv.description ?? ""}>
                        {inv.description ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-bone">
                        ${Number(inv.amount).toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        <Pill tone={statusTone(inv.status)}>{inv.status}</Pill>
                      </td>
                      <td className="px-4 py-3 text-faint" title={inv.created_at}>
                        {relativeTime(inv.created_at)}
                        {inv.creator_name ? ` · ${inv.creator_name}` : ""}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1.5">
                          {inv.hosted_url ? (
                            <a
                              href={inv.hosted_url}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded-md px-2 py-1 text-xs font-medium text-signal hover:bg-signal-soft"
                            >
                              Payment link
                            </a>
                          ) : null}
                          {inv.stripe_invoice_id ? (
                            <Button
                              variant="ghost"
                              disabled={refreshing === inv.id}
                              onClick={() => void refresh(inv)}
                            >
                              {refreshing === inv.id ? "…" : "Refresh"}
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </>
      )}

      <NewInvoiceModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        companies={companies}
        contacts={contacts}
        onCreated={() => void router.invalidate()}
      />
    </div>
  );
}
