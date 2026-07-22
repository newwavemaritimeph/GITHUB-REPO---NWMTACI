"use client";

import { useState } from "react";
import {
  Avatar,
  DataTable,
  Drawer,
  EmptyState,
  Field,
  Modal,
  Pill,
  SearchInput,
  Segmented,
  StatCard,
  useMoneyInput,
  useToast,
} from "@/components/ui/kit";
import { pesos } from "@/lib/endorsement-catalog";
import { formatDate, formatDateRange, formatDateTime, fullName, useSystem } from "@/lib/system/store";
import type { EnrollmentView } from "@/lib/system/types";
import { PageHeader, Panel, StageBadge, StageTrack, type Module } from "./shared";

const filters = ["All", "Unpaid", "Awaiting verification", "Ready for instructions", "In training", "Completed"] as const;

export function EnrollmentsModule({
  go,
  focusId,
  onFocusHandled,
}: {
  go: (module: Module) => void;
  focusId?: string;
  onFocusHandled?: () => void;
}) {
  const {
    state,
    views,
    seats,
    recordPayment,
    sendInstructions,
    cancelEnrollment,
    createEnrollment,
    addLedgerEntry,
  } = useSystem();
  const toast = useToast();
  const [filter, setFilter] = useState<(typeof filters)[number]>("All");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(focusId ?? null);
  const [payFor, setPayFor] = useState<EnrollmentView | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  const all = views();
  const active = openId ? all.find((item) => item.enrollment.id === openId) : undefined;

  const term = query.trim().toLowerCase();
  const rows = all.filter((item) => {
    const matchesFilter =
      filter === "All" ||
      (filter === "Unpaid" && item.balanceCentavos > 0 && item.stage !== "Cancelled") ||
      (filter === "Awaiting verification" && item.stage === "Payment verification") ||
      (filter === "Ready for instructions" && item.paymentStatus === "Paid" && !item.enrollment.instructionsSentAt) ||
      (filter === "In training" && item.stage === "In training") ||
      (filter === "Completed" && ["Training complete", "Certificate ready", "Certificate released"].includes(item.stage));
    const haystack =
      `${item.enrollment.reference} ${fullName(item.trainee)} ${item.trainee.traineeNumber} ${item.enrollment.courseName} ${item.batch?.batchNumber ?? ""}`.toLowerCase();
    return matchesFilter && (!term || haystack.includes(term));
  });

  const outstanding = all.reduce((sum, item) => sum + item.balanceCentavos, 0);
  const readyForInstructions = all.filter((item) => item.paymentStatus === "Paid" && !item.enrollment.instructionsSentAt).length;

  return (
    <div className="page">
      <PageHeader
        eyebrow="Registration operations"
        title="Enrollments"
        description="One connected view of trainee, course, schedule, money, attendance, and certificate readiness."
        actions={
          <button className="primary-button" onClick={() => setNewOpen(true)}>
            + New enrollment
          </button>
        }
      />

      <div className="stat-grid stat-grid-4">
        <StatCard label="Active enrollments" value={String(all.filter((item) => item.stage !== "Cancelled").length)} note="Across all batches" tone={0} icon="▤" />
        <StatCard label="Outstanding balance" value={pesos(outstanding)} note={`${all.filter((item) => item.balanceCentavos > 0).length} enrollments`} tone={1} icon="₱" onClick={() => setFilter("Unpaid")} />
        <StatCard label="Ready for instructions" value={String(readyForInstructions)} note="Fully paid, not yet sent" tone={3} icon="✉" onClick={() => setFilter("Ready for instructions")} />
        <StatCard label="Completed training" value={String(all.filter((item) => item.attendanceComplete).length)} note="Attendance verified" tone={2} icon="✓" />
      </div>

      <Panel padded={false}>
        <div className="toolbar">
          <SearchInput value={query} onChange={setQuery} placeholder="Search trainee, reference, course, or batch" />
          <Segmented options={filters} value={filter} onChange={setFilter} />
        </div>
        {rows.length === 0 ? (
          <EmptyState title="No enrollments here" text="Change the filter, or approve a registration to create the first enrollment in this view." />
        ) : (
          <DataTable columns={["Trainee", "Enrollment", "Course & batch", "Schedule", "Payment", "Balance", "Stage"]} minWidth={1040}>
            {rows.map((item) => (
              <tr
                key={item.enrollment.id}
                className="row-clickable"
                onClick={() => setOpenId(item.enrollment.id)}
                tabIndex={0}
                onKeyDown={(event) => event.key === "Enter" && setOpenId(item.enrollment.id)}
              >
                <td>
                  <div className="person-cell">
                    <Avatar name={fullName(item.trainee)} />
                    <div>
                      <strong>{fullName(item.trainee)}</strong>
                      <small>{item.trainee.traineeNumber}</small>
                    </div>
                  </div>
                </td>
                <td>
                  <strong>{item.enrollment.reference}</strong>
                  <small>{formatDate(item.enrollment.createdAt)}</small>
                </td>
                <td>
                  <strong>{item.enrollment.courseName}</strong>
                  <small>{item.batch?.batchNumber ?? "Open schedule"}</small>
                </td>
                <td>{item.batch ? formatDateRange(item.batch.startsOn, item.batch.endsOn) : "—"}</td>
                <td>
                  <Pill
                    tone={
                      item.paymentStatus === "Paid"
                        ? "green"
                        : item.paymentStatus === "Partially Paid"
                          ? "amber"
                          : item.paymentStatus === "Cancelled"
                            ? "slate"
                            : "red"
                    }
                  >
                    {item.paymentStatus}
                  </Pill>
                  <small>
                    {pesos(item.paidCentavos)} of {pesos(item.dueCentavos)}
                  </small>
                </td>
                <td>
                  <strong className={item.balanceCentavos > 0 ? "value-danger" : "value-good"}>
                    {pesos(item.balanceCentavos)}
                  </strong>
                </td>
                <td>
                  <StageBadge stage={item.stage} />
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>

      <Drawer
        open={Boolean(active)}
        title={active ? fullName(active.trainee) : ""}
        subtitle={active ? `${active.enrollment.reference} · ${active.enrollment.courseName}` : ""}
        onClose={() => {
          setOpenId(null);
          onFocusHandled?.();
        }}
      >
        {active && (
          <>
            <StageTrack stage={active.stage} />

            <div className="mini-stats">
              <div>
                <span>Total due</span>
                <strong>{pesos(active.dueCentavos)}</strong>
              </div>
              <div>
                <span>Paid</span>
                <strong className="value-good">{pesos(active.paidCentavos)}</strong>
              </div>
              <div>
                <span>Balance</span>
                <strong className={active.balanceCentavos > 0 ? "value-danger" : "value-good"}>
                  {pesos(active.balanceCentavos)}
                </strong>
              </div>
            </div>

            <dl className="detail-list">
              <div>
                <dt>Batch</dt>
                <dd>{active.batch?.batchNumber ?? "Open schedule"}</dd>
              </div>
              <div>
                <dt>Training dates</dt>
                <dd>{active.batch ? formatDateRange(active.batch.startsOn, active.batch.endsOn) : "—"}</dd>
              </div>
              <div>
                <dt>Venue</dt>
                <dd>{active.batch?.venue ?? "—"}</dd>
              </div>
              <div>
                <dt>Instructor</dt>
                <dd>{active.batch?.instructor ?? "—"}</dd>
              </div>
              <div>
                <dt>Instructions</dt>
                <dd>
                  {active.enrollment.instructionsAcknowledgedAt
                    ? `Acknowledged ${formatDateTime(active.enrollment.instructionsAcknowledgedAt)}`
                    : active.enrollment.instructionsSentAt
                      ? `Sent ${formatDateTime(active.enrollment.instructionsSentAt)}`
                      : "Not sent"}
                </dd>
              </div>
              <div>
                <dt>Attendance</dt>
                <dd>
                  {active.attendance.filter((entry) => entry.record).length} of {active.attendance.length} sessions recorded
                </dd>
              </div>
              <div>
                <dt>Certificate</dt>
                <dd>{active.certificate?.status ?? "Not started"}</dd>
              </div>
            </dl>

            <div className="drawer-actions">
              <button className="primary-button" onClick={() => setPayFor(active)} disabled={active.balanceCentavos === 0}>
                Record payment
              </button>
              <button
                className="secondary-button"
                disabled={active.paymentStatus !== "Paid" || Boolean(active.enrollment.instructionsSentAt)}
                onClick={() => {
                  sendInstructions(active.enrollment.id);
                  toast("success", "Training instructions sent to the trainee portal.");
                }}
              >
                Send instructions
              </button>
              <button className="secondary-button" onClick={() => go("Attendance")}>
                Open attendance
              </button>
              <button className="secondary-button" onClick={() => go("Certificates")}>
                Certificate
              </button>
              {active.enrollment.status !== "Cancelled" && (
                <button
                  className="danger-button"
                  onClick={() => {
                    const reason = window.prompt("Reason for cancelling this enrollment?");
                    if (!reason) return;
                    cancelEnrollment(active.enrollment.id, reason);
                    toast("warning", "Enrollment cancelled and the slot released.");
                  }}
                >
                  Cancel enrollment
                </button>
              )}
            </div>

            <h3 className="drawer-section">Account ledger</h3>
            <div className="ledger-list">
              {active.entries.map((entry) => (
                <div key={entry.id} className={`ledger-row ledger-${entry.type}`}>
                  <div>
                    <strong>{entry.description}</strong>
                    <small>
                      {entry.reference} · {formatDateTime(entry.recordedAt)}
                      {entry.referenceNumber ? ` · Ref ${entry.referenceNumber}` : ""}
                      {entry.receiptNumber ? ` · ${entry.receiptNumber}` : ""}
                    </small>
                  </div>
                  <div className="ledger-amount">
                    <strong>
                      {entry.type === "charge" ? "" : entry.type === "payment" || entry.type === "discount" ? "−" : "+"}
                      {pesos(entry.amountCentavos)}
                    </strong>
                    {entry.verification !== "Not required" && (
                      <Pill tone={entry.verification === "Verified" ? "green" : entry.verification === "Rejected" ? "red" : "amber"}>
                        {entry.verification}
                      </Pill>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <button
              className="ghost-button"
              onClick={() => {
                const amount = window.prompt("Discount amount in pesos");
                const parsed = Number.parseFloat(amount ?? "");
                if (!Number.isFinite(parsed) || parsed <= 0) return;
                addLedgerEntry({
                  enrollmentId: active.enrollment.id,
                  type: "discount",
                  amountCentavos: Math.round(parsed * 100),
                  description: "Approved discount",
                });
                toast("success", "Discount applied to the enrollment ledger.");
              }}
            >
              + Apply discount
            </button>
          </>
        )}
      </Drawer>

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
                : "Payment recorded and queued for cashier verification.",
            );
          }
          setPayFor(null);
        }}
      />

      <NewEnrollmentModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreate={(traineeId, batchId) => {
          const enrollment = createEnrollment({ traineeId, batchId });
          if (enrollment) {
            toast("success", `${enrollment.reference} created.`);
            setOpenId(enrollment.id);
          }
          setNewOpen(false);
        }}
        trainees={state.trainees}
        batches={state.batches.filter((batch) => batch.status === "Open" || batch.status === "Draft")}
        seats={seats}
      />
    </div>
  );
}

export function PaymentModal({
  target,
  onClose,
  onSubmit,
}: {
  target: EnrollmentView | null;
  onClose: () => void;
  onSubmit: (input: {
    enrollmentId: string;
    amountCentavos: number;
    method: "Cash" | "GCash" | "Bank transfer" | "Card";
    receivingAccount?: string;
    referenceNumber?: string;
    needsVerification?: boolean;
  }) => void;
}) {
  const money = useMoneyInput();
  const [method, setMethod] = useState<"Cash" | "GCash" | "Bank transfer" | "Card">("Cash");
  const [reference, setReference] = useState("");
  const [account, setAccount] = useState("Main cashier");

  const amount = money.centavos;
  const invalid = amount <= 0 || (target ? amount > target.balanceCentavos : true) || (method !== "Cash" && reference.trim().length < 4);

  return (
    <Modal
      open={Boolean(target)}
      title="Record payment"
      description={target ? `${target.enrollment.reference} · balance ${pesos(target.balanceCentavos)}` : ""}
      onClose={onClose}
      footer={
        <>
          <button className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary-button"
            disabled={invalid}
            onClick={() => {
              if (!target) return;
              onSubmit({
                enrollmentId: target.enrollment.id,
                amountCentavos: amount,
                method,
                receivingAccount: account,
                referenceNumber: method === "Cash" ? undefined : reference.trim(),
                needsVerification: method !== "Cash",
              });
              money.reset();
              setReference("");
            }}
          >
            {method === "Cash" ? "Post payment" : "Submit for verification"}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Amount (PHP)" hint={target ? `Maximum ${pesos(target.balanceCentavos)}` : undefined}>
          <input inputMode="decimal" value={money.raw} onChange={(event) => money.setRaw(event.target.value)} placeholder="0.00" />
        </Field>
        <Field label="Method">
          <select value={method} onChange={(event) => setMethod(event.target.value as typeof method)}>
            <option>Cash</option>
            <option>GCash</option>
            <option>Bank transfer</option>
            <option>Card</option>
          </select>
        </Field>
        <Field label="Receiving account">
          <select value={account} onChange={(event) => setAccount(event.target.value)}>
            <option>Main cashier</option>
            <option>GCash 0917-000-0000</option>
            <option>BDO 0012-3456-7890</option>
            <option>BPI 4491-0022-11</option>
          </select>
        </Field>
        <Field label="Transaction reference" hint={method === "Cash" ? "Not required for cash" : "Required for non-cash payments"}>
          <input value={reference} onChange={(event) => setReference(event.target.value.toUpperCase())} disabled={method === "Cash"} placeholder="e.g. 992313" />
        </Field>
        <div className="form-full inline-note note-blue">
          <strong>{method === "Cash" ? "Cash is posted immediately" : "Non-cash payments require verification"}</strong>
          <p>
            {method === "Cash"
              ? "An official receipt number is issued as soon as the payment is posted."
              : "The payment appears under Payments → Verification queue. The receipt is issued only after a cashier confirms the reference against the proof."}
          </p>
        </div>
      </div>
    </Modal>
  );
}

function NewEnrollmentModal({
  open,
  onClose,
  onCreate,
  trainees,
  batches,
  seats,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (traineeId: string, batchId: string) => void;
  trainees: { id: string; traineeNumber: string; firstName: string; middleName?: string; lastName: string }[];
  batches: { id: string; batchNumber: string; courseName: string; startsOn: string; endsOn: string }[];
  seats: (batchId: string) => { capacity: number; taken: number; available: number };
}) {
  const [traineeId, setTraineeId] = useState("");
  const [batchId, setBatchId] = useState("");
  return (
    <Modal
      open={open}
      title="New enrollment"
      description="Enroll an existing trainee into a batch. The training fee is charged automatically."
      onClose={onClose}
      footer={
        <>
          <button className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" disabled={!traineeId || !batchId} onClick={() => onCreate(traineeId, batchId)}>
            Create enrollment
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Trainee" full>
          <select value={traineeId} onChange={(event) => setTraineeId(event.target.value)}>
            <option value="">Select a trainee</option>
            {trainees.map((trainee) => (
              <option key={trainee.id} value={trainee.id}>
                {trainee.traineeNumber} — {fullName(trainee)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Batch" full>
          <select value={batchId} onChange={(event) => setBatchId(event.target.value)}>
            <option value="">Select a batch</option>
            {batches.map((batch) => {
              const seat = seats(batch.id);
              return (
                <option key={batch.id} value={batch.id} disabled={seat.available === 0}>
                  {batch.batchNumber} — {batch.courseName} · {formatDateRange(batch.startsOn, batch.endsOn)} · {seat.available} slots
                </option>
              );
            })}
          </select>
        </Field>
      </div>
    </Modal>
  );
}
