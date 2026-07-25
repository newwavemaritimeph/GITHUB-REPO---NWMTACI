"use client";

import { useMemo, useState } from "react";
import { DataTable, EmptyState, Pill, SearchInput, Segmented, StatCard, useToast } from "@/components/ui/kit";
import { PaymentProofOcr } from "@/components/payment-proof-ocr";
import { pesos } from "@/lib/endorsement-catalog";
import { formatDateTime, fullName, todayIso, useSystem } from "@/lib/system/store";
import type { EnrollmentView, Role } from "@/lib/system/types";
import { PageHeader, Panel } from "./shared";
import { PaymentModal } from "./module-enrollments";

const filters = ["Verification queue", "Today", "All payments"] as const;

export function PaymentsModule({ role }: { role: Role }) {
  const { state, views, recordPayment, setPaymentVerification } = useSystem();
  const canRecordPayment = role === "Cashier";
  const toast = useToast();
  const [filter, setFilter] = useState<(typeof filters)[number]>("Verification queue");
  const [query, setQuery] = useState("");
  const [payFor, setPayFor] = useState<EnrollmentView | null>(null);
  const [picker, setPicker] = useState(false);

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
            <button className="primary-button" onClick={() => setPicker(true)}>
              + Record payment
            </button>
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

      <PaymentProofOcr />

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

      <PaymentModal
        target={payFor}
        onClose={() => setPayFor(null)}
        onSubmit={(input) => {
          const entry = recordPayment(input);
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
