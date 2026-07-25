"use client";

import { useMemo, useState } from "react";
import { DataTable, EmptyState, Field, Modal, Pill, SearchInput, Segmented, StatCard, useMoneyInput, useToast } from "@/components/ui/kit";
import { downloadCsv } from "@/lib/csv";
import { pesos } from "@/lib/endorsement-catalog";
import { formatDateTime, fullName, todayIso, useSystem } from "@/lib/system/store";
import type { EnrollmentView, Role } from "@/lib/system/types";
import { PageHeader, Panel } from "./shared";
import { PaymentModal } from "./module-enrollments";

const filters = ["Verification queue", "Today", "All payments"] as const;

export function PaymentsModule({ role }: { role: Role }) {
  const { state, views, recordPayment, setPaymentVerification, createExpense, createRequest } = useSystem();
  const canRecordPayment = role === "Cashier";
  const toast = useToast();
  const [filter, setFilter] = useState<(typeof filters)[number]>("Verification queue");
  const [query, setQuery] = useState("");
  const [payFor, setPayFor] = useState<EnrollmentView | null>(null);
  const [picker, setPicker] = useState(false);
  const [expenseOpen, setExpenseOpen] = useState(false);

  const all = views();
  const byEnrollment = useMemo(() => new Map(all.map((item) => [item.enrollment.id, item])), [all]);

  const payments = useMemo(
    () =>
      state.ledger
        .filter((entry) => entry.type === "payment")
        .sort((left, right) => right.recordedAt.localeCompare(left.recordedAt)),
    [state.ledger],
  );

  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();
    return payments.filter((entry) => {
      const item = byEnrollment.get(entry.enrollmentId);
      const matchesFilter =
        (filter === "Verification queue" && entry.verification === "Pending") ||
        (filter === "Today" && entry.recordedAt.slice(0, 10) === todayIso()) ||
        filter === "All payments";
      const haystack = `${entry.reference} ${entry.referenceNumber ?? ""} ${entry.method ?? ""} ${item ? fullName(item.trainee) : ""} ${item?.enrollment.reference ?? ""}`.toLowerCase();
      return matchesFilter && (!term || haystack.includes(term));
    });
  }, [byEnrollment, filter, payments, query]);

  const verifiedToday = payments.filter(
    (entry) => entry.verification === "Verified" && entry.recordedAt.slice(0, 10) === todayIso(),
  );
  const collectionsToday = verifiedToday.reduce((sum, entry) => sum + entry.amountCentavos, 0);
  const pendingCount = payments.filter((entry) => entry.verification === "Pending").length;
  const outstanding = all.reduce((sum, item) => sum + item.balanceCentavos, 0);

  const byMethod = state.paymentChannels
    .filter((channel) => channel.active)
    .map((channel) => ({
      method: channel.name,
      total: verifiedToday.filter((entry) => entry.method === channel.name).reduce((sum, entry) => sum + entry.amountCentavos, 0),
      count: verifiedToday.filter((entry) => entry.method === channel.name).length,
    }));

  return (
    <div className="page">
      <PageHeader
        eyebrow="Cashier operations"
        title="Payments"
        description="Post collections, verify online proofs, issue receipts, and keep every balance current."
        actions={
          canRecordPayment ? (
            <>
              <button className="secondary-button" onClick={() => setExpenseOpen(true)}>
                Expense voucher
              </button>
              <button className="primary-button" onClick={() => setPicker(true)}>
                + Record payment
              </button>
            </>
          ) : undefined
        }
      />

      <div className="finance-strip">
        <div className="finance-lead">
          <span>Verified collections today</span>
          <strong>{pesos(collectionsToday)}</strong>
          <small>{verifiedToday.length} posted transactions</small>
        </div>
        {byMethod.map((entry) => (
          <article key={entry.method}>
            <span>{entry.method}</span>
            <strong>{pesos(entry.total)}</strong>
            <small>
              {entry.count} payment{entry.count === 1 ? "" : "s"}
            </small>
          </article>
        ))}
      </div>

      <div className="stat-grid stat-grid-3">
        <StatCard label="Awaiting verification" value={String(pendingCount)} note="Online proofs to confirm" tone={1} icon="!" onClick={() => setFilter("Verification queue")} />
        <StatCard label="Outstanding balances" value={pesos(outstanding)} note={`${all.filter((item) => item.balanceCentavos > 0).length} enrollments`} tone={5} icon="₱" />
        <StatCard label="Receipts issued" value={String(payments.filter((entry) => entry.receiptNumber).length)} note="All time" tone={2} icon="◈" />
      </div>

      <Panel padded={false}>
        <div className="toolbar">
          <SearchInput value={query} onChange={setQuery} placeholder="Search payment, trainee, or transaction reference" />
          <Segmented options={filters} value={filter} onChange={setFilter} />
        </div>
        {rows.length === 0 ? (
          <EmptyState
            icon="✓"
            title={filter === "Verification queue" ? "Nothing waiting for verification" : "No payments match"}
            text={
              filter === "Verification queue"
                ? "Online payments submitted from the trainee portal appear here for cashier confirmation."
                : "Try a different filter or search term."
            }
          />
        ) : (
          <DataTable columns={["Payment", "Trainee", "Method", "Received", "Verification", "Amount", ""]} minWidth={980}>
            {rows.map((entry) => {
              const item = byEnrollment.get(entry.enrollmentId);
              return (
                <tr key={entry.id}>
                  <td>
                    <strong>{entry.reference}</strong>
                    <small>{entry.receiptNumber ?? "No receipt yet"}</small>
                  </td>
                  <td>
                    <strong>{item ? fullName(item.trainee) : "—"}</strong>
                    <small>{item?.enrollment.reference}</small>
                  </td>
                  <td>
                    {entry.method}
                    <small>{entry.referenceNumber ? `Ref ${entry.referenceNumber}` : entry.receivingAccount}</small>
                  </td>
                  <td>{formatDateTime(entry.recordedAt)}</td>
                  <td>
                    <Pill tone={entry.verification === "Verified" ? "green" : entry.verification === "Rejected" ? "red" : "amber"}>
                      {entry.verification}
                    </Pill>
                  </td>
                  <td>
                    <strong>{pesos(entry.amountCentavos)}</strong>
                  </td>
                  <td className="cell-actions">
                    {entry.verification === "Pending" ? (
                      <>
                        <button
                          className="ghost-button"
                          onClick={() => {
                            setPaymentVerification(entry.id, "Verified");
                            toast("success", "Payment verified and receipt issued.");
                          }}
                        >
                          Verify
                        </button>
                        <button
                          className="ghost-button ghost-danger"
                          onClick={() => {
                            setPaymentVerification(entry.id, "Rejected");
                            toast("warning", "Proof returned to the trainee.");
                          }}
                        >
                          Return
                        </button>
                      </>
                    ) : (
                      <span className="muted-text">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </Panel>

      {canRecordPayment && <CashierDrawerPanel />}
      {canRecordPayment && <ChannelHistoryPanel payments={payments} channels={state.paymentChannels.filter((c) => c.active && c.requiresReference)} />}

      {picker && (
        <Panel title="Choose an enrollment to bill" description="Only enrollments with an open balance are listed.">
          <div className="pick-list">
            {all
              .filter((item) => item.balanceCentavos > 0)
              .map((item) => (
                <button
                  key={item.enrollment.id}
                  className="pick-row"
                  onClick={() => {
                    setPayFor(item);
                    setPicker(false);
                  }}
                >
                  <div>
                    <strong>{fullName(item.trainee)}</strong>
                    <small>
                      {item.enrollment.reference} · {item.enrollment.courseName}
                    </small>
                  </div>
                  <strong className="value-danger">{pesos(item.balanceCentavos)}</strong>
                </button>
              ))}
            {all.every((item) => item.balanceCentavos === 0) && (
              <EmptyState icon="✓" title="Every enrollment is settled" text="There is no open balance to collect right now." />
            )}
          </div>
          <button className="secondary-button" onClick={() => setPicker(false)}>
            Close
          </button>
        </Panel>
      )}

      {expenseOpen && (
        <ExpenseVoucherModal
          categories={state.expenseCategories.filter((category) => category.active).map((category) => category.name)}
          onClose={() => setExpenseOpen(false)}
          onCreate={(input) => {
            const expense = createExpense(input);
            // Expense approvals flow through the Requests module.
            createRequest({
              type: "Expenses",
              traineeName: expense.payee,
              reason: `${expense.category} · ${expense.purpose}`,
              payload: { expenseId: expense.id },
            });
            toast("success", `${expense.expenseNumber} created — sent to Accounting for approval in Requests.`);
            setExpenseOpen(false);
          }}
        />
      )}

      <PaymentModal
        key={payFor?.enrollment.id}
        target={payFor}
        onClose={() => setPayFor(null)}
        onSubmit={({ remarks, ...input }) => {
          const entry = recordPayment({ ...input, description: remarks });
          if (entry) {
            toast(
              "success",
              entry.verification === "Verified"
                ? `Payment posted. Receipt ${entry.receiptNumber} issued.`
                : "Payment recorded and queued for verification.",
            );
          }
          setPayFor(null);
        }}
      />
    </div>
  );
}

function ExpenseVoucherModal({
  categories,
  onClose,
  onCreate,
}: {
  categories: string[];
  onClose: () => void;
  onCreate: (input: {
    category: string;
    itemUnit: string;
    quantity: number;
    purpose: string;
    payor: string;
    amountCentavos: number;
    modeOfPayment: string;
    remarks: string;
  }) => void;
}) {
  const [category, setCategory] = useState(categories[0]);
  const [itemUnit, setItemUnit] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [purpose, setPurpose] = useState("");
  const [payor, setPayor] = useState("");
  const [modeOfPayment, setModeOfPayment] = useState("Cash");
  const [remarks, setRemarks] = useState("");
  const money = useMoneyInput("");
  const invalid = !purpose.trim() || money.centavos <= 0;
  return (
    <Modal
      open
      title="Expense voucher"
      description="Auto-generates a voucher number and sends it to the Accounting Manager for approval."
      onClose={onClose}
      wide
      footer={
        <>
          <button className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary-button"
            disabled={invalid}
            onClick={() =>
              onCreate({
                category,
                itemUnit: itemUnit.trim(),
                quantity: Math.max(1, Number(quantity) || 1),
                purpose: purpose.trim(),
                payor: payor.trim(),
                amountCentavos: money.centavos,
                modeOfPayment,
                remarks: remarks.trim(),
              })
            }
          >
            Create voucher
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Category">
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            {categories.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </Field>
        <Field label="Item / Unit">
          <input value={itemUnit} onChange={(event) => setItemUnit(event.target.value)} placeholder="e.g. Bond paper / ream" />
        </Field>
        <Field label="Quantity">
          <input type="number" min={1} value={quantity} onChange={(event) => setQuantity(event.target.value)} />
        </Field>
        <Field label="Mode of payment">
          <select value={modeOfPayment} onChange={(event) => setModeOfPayment(event.target.value)}>
            <option>Cash</option>
            <option>Check</option>
            <option>Bank transfer</option>
            <option>GCash</option>
          </select>
        </Field>
        <Field label="Description*" full>
          <input value={purpose} onChange={(event) => setPurpose(event.target.value)} placeholder="What is this expense for?" />
        </Field>
        <Field label="Payor / Payee">
          <input value={payor} onChange={(event) => setPayor(event.target.value)} placeholder="Who is being paid" />
        </Field>
        <Field label="Amount (PHP)*">
          <input inputMode="decimal" value={money.raw} onChange={(event) => money.setRaw(event.target.value)} placeholder="0.00" />
        </Field>
        <Field label="Remarks" full>
          <input value={remarks} onChange={(event) => setRemarks(event.target.value)} placeholder="Optional note" />
        </Field>
      </div>
    </Modal>
  );
}

/**
 * Cashier's daily drawer: she reports her opening float and physical closing
 * count; received (all channels) and disbursement (refunds + paid vouchers) are
 * computed for today, and the variance flags a short or over drawer.
 */
function CashierDrawerPanel() {
  const { state } = useSystem();
  const [openingPesos, setOpeningPesos] = useState("");
  const [countedPesos, setCountedPesos] = useState("");
  const today = todayIso();

  const openingCentavos = Math.max(0, Math.round(Number(openingPesos || "0") * 100));
  const receivedCentavos = state.ledger
    .filter((entry) => entry.type === "payment" && entry.verification === "Verified" && entry.recordedAt.slice(0, 10) === today)
    .reduce((sum, entry) => sum + entry.amountCentavos, 0);
  const disbursementCentavos =
    state.ledger
      .filter((entry) => (entry.type === "refund" || entry.type === "reversal") && entry.recordedAt.slice(0, 10) === today)
      .reduce((sum, entry) => sum + entry.amountCentavos, 0) +
    state.expenses
      .filter((expense) => (expense.status === "Paid" || expense.status === "Approved") && (expense.decidedAt ?? expense.createdAt).slice(0, 10) === today)
      .reduce((sum, expense) => sum + expense.amountCentavos, 0);
  const expectedCentavos = openingCentavos + receivedCentavos - disbursementCentavos;
  const counted = countedPesos.trim() === "" ? null : Math.max(0, Math.round(Number(countedPesos) * 100));
  const variance = counted === null ? null : counted - expectedCentavos;

  return (
    <Panel title="Opening / Closing" description="Report today's opening float and closing count. Received and disbursement are computed live.">
      <div className="cashier-drawer">
        <div className="cashier-drawer-inputs">
          <Field label="Opening balance (₱)" hint="Cash float at the start of the day">
            <input type="number" min={0} step="1" value={openingPesos} placeholder="0.00" onChange={(event) => setOpeningPesos(event.target.value)} />
          </Field>
          <Field label="Closing count (₱)" hint="Physical cash counted at end of day">
            <input type="number" min={0} step="1" value={countedPesos} placeholder="0.00" onChange={(event) => setCountedPesos(event.target.value)} />
          </Field>
        </div>
        <div className="stat-grid stat-grid-4">
          <StatCard label="Opening" value={pesos(openingCentavos)} note="Reported float" tone={0} icon="₱" />
          <StatCard label="Received today" value={pesos(receivedCentavos)} note="All channels · verified" tone={2} icon="↧" />
          <StatCard label="Disbursement" value={pesos(disbursementCentavos)} note="Refunds + paid vouchers" tone={5} icon="↥" />
          <StatCard label="Expected closing" value={pesos(expectedCentavos)} note="Opening + received − disbursed" tone={3} icon="◈" />
        </div>
        {counted !== null && (
          <div className={`cashier-drawer-variance ${variance === 0 ? "ok" : variance! > 0 ? "over" : "short"}`}>
            <span>Counted {pesos(counted)} vs expected {pesos(expectedCentavos)}</span>
            <strong>{variance === 0 ? "Balanced" : `${variance! > 0 ? "Over" : "Short"} ${pesos(Math.abs(variance!))}`}</strong>
          </div>
        )}
      </div>
    </Panel>
  );
}

const HISTORY_RANGES = ["Daily", "7 Days", "15 Days", "30 Days"] as const;

/** Per-channel received transaction history (GCash / PSBank / UnionBank …) over
 * a Daily / 7 / 15 / 30-day window, with CSV export. */
function ChannelHistoryPanel({
  payments,
  channels,
}: {
  payments: { reference: string; enrollmentId: string; method?: string; referenceNumber?: string; amountCentavos: number; receiptNumber?: string; recordedAt: string; verification: string }[];
  channels: { id: string; name: string }[];
}) {
  const { state } = useSystem();
  const toast = useToast();
  const [channel, setChannel] = useState(channels[0]?.name ?? "");
  const [rangePreset, setRangePreset] = useState<(typeof HISTORY_RANGES)[number]>("Daily");

  const days = rangePreset === "Daily" ? 1 : rangePreset === "7 Days" ? 7 : rangePreset === "15 Days" ? 15 : 30;
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - (days - 1));
  const fromIso = fromDate.toISOString().slice(0, 10);

  const history = payments
    .filter((entry) => entry.verification === "Verified" && entry.method === channel && entry.recordedAt.slice(0, 10) >= fromIso)
    .sort((left, right) => right.recordedAt.localeCompare(left.recordedAt));
  const total = history.reduce((sum, entry) => sum + entry.amountCentavos, 0);
  const traineeFor = (enrollmentId: string) => {
    const enrollment = state.enrollments.find((item) => item.id === enrollmentId);
    const trainee = state.trainees.find((item) => item.id === enrollment?.traineeId);
    return trainee ? fullName(trainee) : "—";
  };

  return (
    <Panel
      title="Transaction history"
      description="Verified collections over the selected window."
      action={
        <button
          className="secondary-button"
          disabled={history.length === 0}
          onClick={() => {
            downloadCsv(`transaction-history-${channel}-${rangePreset.replace(" ", "")}-${fromIso}.csv`, [
              [`${channel} received · ${rangePreset} · from ${fromIso}`],
              [],
              ["Payment", "Trainee", "Reference", "Amount", "Receipt", "Received at"],
              ...history.map((entry) => [
                entry.reference,
                traineeFor(entry.enrollmentId),
                entry.referenceNumber ?? "",
                (entry.amountCentavos / 100).toFixed(2),
                entry.receiptNumber ?? "",
                entry.recordedAt,
              ]),
              [],
              ["Total received", (total / 100).toFixed(2)],
            ]);
            toast("success", `${channel} transaction history exported (${rangePreset}).`);
          }}
        >
          Download CSV
        </button>
      }
    >
      <div className="toolbar toolbar-wrap">
        <label className="inline-field">
          <span>Channel</span>
          <select value={channel} onChange={(event) => setChannel(event.target.value)}>
            {channels.map((item) => (
              <option key={item.id}>{item.name}</option>
            ))}
          </select>
        </label>
        <Segmented options={HISTORY_RANGES} value={rangePreset} onChange={setRangePreset} />
        <div className="toolbar-end total-block">
          <span>{channel} received</span>
          <strong>{pesos(total)}</strong>
        </div>
      </div>
      {history.length === 0 ? (
        <EmptyState icon="₱" title="No received transactions" text={`No verified ${channel} collections in the selected window.`} />
      ) : (
        <DataTable columns={["Payment", "Trainee", "Reference", "Received", "Amount", "Receipt"]} minWidth={860}>
          {history.map((entry) => (
            <tr key={entry.reference}>
              <td><strong>{entry.reference}</strong></td>
              <td>{traineeFor(entry.enrollmentId)}</td>
              <td>{entry.referenceNumber || "—"}</td>
              <td>{formatDateTime(entry.recordedAt)}</td>
              <td><strong>{pesos(entry.amountCentavos)}</strong></td>
              <td>{entry.receiptNumber || "—"}</td>
            </tr>
          ))}
        </DataTable>
      )}
    </Panel>
  );
}
