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
  useMoneyInput,
  useToast,
} from "@/components/ui/kit";
import { pesos } from "@/lib/endorsement-catalog";
import { downloadCsv } from "@/lib/csv";
import { createAdmissionInvoicePdf } from "@/lib/documents";
import { formatDate, formatDateRange, formatDateTime, formatTime, fullName, todayIso, useSystem } from "@/lib/system/store";
import type { EnrollmentView, RegistrationLifecycle, Role, RequestType } from "@/lib/system/types";
import { PageHeader, Panel, StageBadge, StageTrack, type Module } from "./shared";

const filters = ["All", "Unpaid", "Awaiting verification", "Ready for instructions", "In training", "Completed"] as const;
const REGISTRATION_STATUSES: RegistrationLifecycle[] = ["Waiting for Payment", "Enrolled", "Reschedule", "Generated Voucher", "Cancelled"];

/** Fetch the New Wave logo PNG for embedding in generated PDFs (optional). */
async function fetchLogoBytes(): Promise<Uint8Array | undefined> {
  try {
    return new Uint8Array(await (await fetch("/new-wave-logo.png")).arrayBuffer());
  } catch {
    return undefined;
  }
}

function triggerPdfDownload(bytes: Uint8Array, filename: string) {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "application/pdf" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function EnrollmentsModule({
  role,
  focusId,
  onFocusHandled,
}: {
  go: (module: Module) => void;
  role: Role;
  focusId?: string;
  onFocusHandled?: () => void;
}) {
  const canRecordPayment = role === "Cashier";
  const {
    state,
    views,
    seats,
    actor,
    recordPayment,
    sendInstructions,
    cancelEnrollment,
    changeEnrollmentBatch,
    setRegistrationStatus,
    generateAdmissionSlip,
    createEnrollment,
    createEndorsedEnrollment,
    addLedgerEntry,
    createRequest,
  } = useSystem();
  const toast = useToast();
  const [filter, setFilter] = useState<(typeof filters)[number]>("All");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(focusId ?? null);
  const [payFor, setPayFor] = useState<EnrollmentView | null>(null);
  const [splitFor, setSplitFor] = useState<EnrollmentView | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [editFor, setEditFor] = useState<EnrollmentView | null>(null);
  const [editBatchId, setEditBatchId] = useState("");
  const [slipFor, setSlipFor] = useState<EnrollmentView | null>(null);
  const [chargeFor, setChargeFor] = useState<EnrollmentView | null>(null);
  const [agencyFor, setAgencyFor] = useState<EnrollmentView | null>(null);
  // Registration cannot open the Requests module, so changes are raised from here.
  const [requestFor, setRequestFor] = useState<EnrollmentView | null>(null);
  const [requestType, setRequestType] = useState<RequestType>("Rescheduling");
  const [requestReason, setRequestReason] = useState("");
  const [fromDate, setFromDate] = useState(todayIso());
  const [toDate, setToDate] = useState(todayIso());

  const all = views();
  const active = openId ? all.find((item) => item.enrollment.id === openId) : undefined;

  const term = query.trim().toLowerCase();
  const rows = all.filter((item) => {
    const created = item.enrollment.createdAt.slice(0, 10);
    const matchesFrom = !fromDate || created >= fromDate;
    const matchesTo = !toDate || created <= toDate;
    const matchesFilter =
      filter === "All" ||
      (filter === "Unpaid" && item.balanceCentavos > 0 && item.stage !== "Cancelled") ||
      (filter === "Awaiting verification" && item.stage === "Payment verification") ||
      (filter === "Ready for instructions" && item.paymentStatus === "Paid" && !item.enrollment.instructionsSentAt) ||
      (filter === "In training" && item.stage === "In training") ||
      (filter === "Completed" && ["Training complete", "Certificate ready", "Certificate released"].includes(item.stage));
    const haystack =
      `${item.enrollment.reference} ${fullName(item.trainee)} ${item.trainee.traineeNumber} ${item.enrollment.courseName} ${item.batch?.batchNumber ?? ""}`.toLowerCase();
    return matchesFrom && matchesTo && matchesFilter && (!term || haystack.includes(term));
  });

  return (
    <div className="page">
      <PageHeader
        eyebrow="Registration operations"
        title="Enrollments"
        description="Daily enrollments — pick a date range to see the schedule, payment status, and latest stage of each."
        actions={
          <button className="primary-button" onClick={() => setNewOpen(true)}>
            + New enrollment
          </button>
        }
      />

      {(() => {
        // Daily summary of the currently filtered enrollments: Trainee > Course >
        // Payment status, grouped by the day each enrollment was created.
        const groups = new Map<string, EnrollmentView[]>();
        for (const item of rows) {
          const day = item.enrollment.createdAt.slice(0, 10);
          const list = groups.get(day) ?? [];
          list.push(item);
          groups.set(day, list);
        }
        const days = Array.from(groups.entries()).sort(([a], [b]) => b.localeCompare(a));
        if (days.length === 0) return null;
        const tone = (status: string) =>
          status === "Paid" ? "green" : status === "Partially Paid" ? "amber" : status === "Cancelled" ? "red" : "slate";
        return (
          <Panel
            title="Daily enrollments summary"
            description="Trainee · Course · Payment status, grouped by enrollment date."
            action={
              <button
                className="secondary-button"
                onClick={() =>
                  downloadCsv(`daily-enrollments-${fromDate}-to-${toDate}.csv`, [
                    ["Date", "Trainee", "Trainee number", "Course", "Payment status", "Balance"],
                    ...rows.map((item) => [
                      item.enrollment.createdAt.slice(0, 10),
                      fullName(item.trainee),
                      item.trainee.traineeNumber,
                      item.enrollment.courseName,
                      item.paymentStatus,
                      (item.balanceCentavos / 100).toFixed(2),
                    ]),
                  ])
                }
              >
                Download CSV
              </button>
            }
          >
            <div className="daily-enrollments">
              {days.map(([day, items]) => (
                <div key={day} className="daily-enrollments-day">
                  <div className="daily-enrollments-head">
                    <strong>{formatDate(day)}</strong>
                    <small>{items.length} enrollment{items.length === 1 ? "" : "s"}</small>
                  </div>
                  {items.map((item) => (
                    <div key={item.enrollment.id} className="daily-enrollments-row">
                      <span className="daily-enrollments-name">{fullName(item.trainee)}</span>
                      <span className="daily-enrollments-course">{item.enrollment.courseName}</span>
                      <Pill tone={tone(item.paymentStatus)}>{item.paymentStatus}</Pill>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </Panel>
        );
      })()}

      <Panel padded={false}>
        <div className="toolbar toolbar-wrap">
          <SearchInput value={query} onChange={setQuery} placeholder="Search trainee, reference, course, or batch" />
          <label className="inline-field">
            <span>From</span>
            <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
          </label>
          <label className="inline-field">
            <span>To</span>
            <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
          </label>
          <Segmented options={filters} value={filter} onChange={setFilter} />
          <span className="toolbar-end catalog-count">{rows.length} enrollment{rows.length === 1 ? "" : "s"}</span>
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
                <dt>Registration status</dt>
                <dd>
                  <select
                    className="status-select"
                    value={active.enrollment.registrationStatus ?? "Waiting for Payment"}
                    onChange={(event) => {
                      setRegistrationStatus(active.enrollment.id, event.target.value as RegistrationLifecycle);
                      toast("success", `Registration status set to ${event.target.value}.`);
                    }}
                  >
                    {REGISTRATION_STATUSES.map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </dd>
              </div>
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
              {canRecordPayment && (
                <button className="primary-button" onClick={() => setPayFor(active)} disabled={active.balanceCentavos === 0}>
                  Record payment
                </button>
              )}
              {canRecordPayment && (
                <button className="secondary-button" onClick={() => setSplitFor(active)}>
                  Split payment
                </button>
              )}
              {canRecordPayment && (
                <button className="secondary-button" onClick={() => setChargeFor(active)}>
                  Add charge
                </button>
              )}
              {canRecordPayment && (
                <button
                  className="secondary-button"
                  disabled={active.balanceCentavos === 0}
                  onClick={() => setAgencyFor(active)}
                >
                  Apply agency rebate
                </button>
              )}
              {role !== "Cashier" && (
                <button
                  className="secondary-button"
                  disabled={active.paymentStatus === "Unpaid" || Boolean(active.enrollment.instructionsSentAt)}
                  onClick={() => {
                    sendInstructions(active.enrollment.id);
                    toast("success", "Training instructions sent to the trainee portal.");
                  }}
                >
                  {active.enrollment.instructionsSentAt ? "Instructions sent" : "Send instructions"}
                </button>
              )}
              {active.enrollment.status !== "Cancelled" && (
                <button
                  className="secondary-button"
                  onClick={() => {
                    setEditFor(active);
                    setEditBatchId(active.enrollment.batchId);
                  }}
                >
                  Change course / schedule
                </button>
              )}
              {role !== "Cashier" && (
                <button
                  className="secondary-button"
                  onClick={() => {
                    setRequestFor(active);
                    setRequestType("Rescheduling");
                    setRequestReason("");
                  }}
                >
                  Request a change
                </button>
              )}
              {canRecordPayment && (
                <button className="secondary-button" onClick={() => setSlipFor(active)}>
                  Admission slip + invoice
                </button>
              )}
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
                : "Payment recorded and queued for cashier verification.",
            );
          }
          setPayFor(null);
        }}
      />

      {splitFor && (
        <SplitPaymentModal
          key={splitFor.enrollment.id}
          trainee={splitFor.trainee}
          enrollments={all.filter(
            (item) => item.trainee.id === splitFor.trainee.id && item.balanceCentavos > 0 && item.enrollment.status !== "Cancelled",
          )}
          channels={state.paymentChannels.filter((channel) => channel.active)}
          onClose={() => setSplitFor(null)}
          onSubmit={({ allocations, method, referenceNumber, needsVerification }) => {
            let posted = 0;
            for (const allocation of allocations) {
              const entry = recordPayment({
                enrollmentId: allocation.enrollmentId,
                amountCentavos: allocation.amountCentavos,
                method,
                receivingAccount: method,
                referenceNumber,
                needsVerification,
                description: `Split payment across ${allocations.length} courses · ref ${referenceNumber || "cash"}`,
              });
              if (entry) posted += 1;
            }
            toast(
              "success",
              `Split payment allocated to ${posted} course${posted === 1 ? "" : "s"}${referenceNumber ? ` under reference ${referenceNumber}` : ""}.`,
            );
            setSplitFor(null);
          }}
        />
      )}

      <Modal
        open={Boolean(requestFor)}
        title="Request a change"
        description={requestFor ? `${requestFor.enrollment.reference} · ${requestFor.enrollment.courseName}` : ""}
        onClose={() => setRequestFor(null)}
        footer={
          <>
            <button className="secondary-button" onClick={() => setRequestFor(null)}>
              Cancel
            </button>
            <button
              className="primary-button"
              disabled={requestReason.trim().length < 8}
              onClick={() => {
                if (!requestFor) return;
                const request = createRequest({
                  type: requestType,
                  enrollmentId: requestFor.enrollment.id,
                  traineeName: fullName(requestFor.trainee),
                  reason: requestReason.trim(),
                });
                toast("success", `${request.reference} submitted for approval.`);
                setRequestFor(null);
              }}
            >
              Submit request
            </button>
          </>
        }
      >
        <div className="form-grid">
          <Field label="What is being requested?" full>
            <select value={requestType} onChange={(event) => setRequestType(event.target.value as RequestType)}>
              <option>Rescheduling</option>
              <option>Make-up class</option>
              <option>Change Course</option>
            </select>
          </Field>
          <Field label="Reason" full hint="Approved by Accounting. The reason is kept on the immutable request history.">
            <textarea rows={4} value={requestReason} onChange={(event) => setRequestReason(event.target.value)} />
          </Field>
        </div>
      </Modal>

      <Modal
        open={Boolean(editFor)}
        title="Change course / schedule"
        description={editFor ? `${editFor.enrollment.reference} · currently ${editFor.enrollment.courseName}` : ""}
        onClose={() => setEditFor(null)}
        wide
        footer={
          <>
            <button className="secondary-button" onClick={() => setEditFor(null)}>
              Cancel
            </button>
            <button
              className="primary-button"
              disabled={!editFor || !editBatchId || editBatchId === editFor.enrollment.batchId}
              onClick={() => {
                if (!editFor) return;
                changeEnrollmentBatch(editFor.enrollment.id, editBatchId);
                toast("success", "Course / schedule updated and fee re-priced.");
                setEditFor(null);
              }}
            >
              Save change
            </button>
          </>
        }
      >
        {editFor && (
          <div className="form-grid">
            <Field
              label="New course &amp; schedule"
              full
              hint="Pick any open batch. This changes the course, schedule, and dates, and re-prices the training fee. Verified payments stay on the account."
            >
              <select value={editBatchId} onChange={(event) => setEditBatchId(event.target.value)}>
                {[
                  ...state.batches.filter(
                    (batch) => batch.status === "Open" || batch.id === editFor.enrollment.batchId,
                  ),
                ]
                  .sort((a, z) => a.startsOn.localeCompare(z.startsOn))
                  .map((batch) => {
                    const seat = seats(batch.id);
                    const current = batch.id === editFor.enrollment.batchId;
                    return (
                      <option key={batch.id} value={batch.id}>
                        {batch.courseCode} — {batch.courseName} · {formatDateRange(batch.startsOn, batch.endsOn)}
                        {current ? " (current)" : ` · ${seat.available} open`}
                      </option>
                    );
                  })}
              </select>
            </Field>
          </div>
        )}
      </Modal>

      {chargeFor && (
        <AddChargeModal
          key={chargeFor.enrollment.id}
          view={chargeFor}
          charges={state.otherCharges.filter((charge) => charge.active)}
          onClose={() => setChargeFor(null)}
          onAdd={(name, amountCentavos) => {
            addLedgerEntry({ enrollmentId: chargeFor.enrollment.id, type: "charge", amountCentavos, description: name });
            toast("success", `${name} charge added.`);
          }}
        />
      )}

      {agencyFor && (
        <AgencyRebateModal
          key={agencyFor.enrollment.id}
          view={agencyFor}
          agencies={state.marketingAgencies.filter((agency) => agency.active)}
          onClose={() => setAgencyFor(null)}
          onApply={(name, amountCentavos) => {
            // Releasing a rebate requires Accounting approval — raise a request;
            // the discount posts when the request is approved.
            createRequest({
              type: "Releasing Rebates",
              enrollmentId: agencyFor.enrollment.id,
              traineeName: fullName(agencyFor.trainee),
              reason: `${pesos(amountCentavos)} rebate from ${name} for ${agencyFor.enrollment.courseName}`,
              payload: { enrollmentId: agencyFor.enrollment.id, amountCentavos: String(amountCentavos), agencyName: name },
            });
            toast("success", `Rebate release requested — awaiting Accounting approval.`);
          }}
        />
      )}

      {slipFor && (
        <AdmissionInvoiceModal
          key={slipFor.enrollment.id}
          view={slipFor}
          defaultOfficer={slipFor.enrollment.processedBy || actor}
          defaultCashier={actor}
          session={state.attendanceSessions.find((item) => item.batchId === slipFor.enrollment.batchId)}
          onClose={() => setSlipFor(null)}
          onGenerate={(officer, cashier) => {
            generateAdmissionSlip(slipFor.enrollment.id, { officer, cashier });
            toast("success", "Admission slip & invoice generated — status set to Generated Voucher.");
          }}
        />
      )}

      <NewEnrollmentModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreate={({ traineeId, batchId, offerId }) => {
          const enrollment = offerId
            ? createEndorsedEnrollment({ traineeId, offerId })
            : createEnrollment({ traineeId, batchId: batchId ?? "" });
          if (enrollment) {
            toast("success", `${enrollment.reference} created.`);
            setOpenId(enrollment.id);
          }
          setNewOpen(false);
        }}
        trainees={state.trainees}
        batches={state.batches.filter(
          (batch) => (batch.status === "Open" || batch.status === "Draft") && batch.startsOn >= todayIso(),
        )}
        offers={state.partnerOffers.filter((offer) => offer.active)}
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
    method: string;
    receivingAccount?: string;
    referenceNumber?: string;
    needsVerification?: boolean;
    remarks?: string;
  }) => void;
}) {
  const { state } = useSystem();
  const channels = state.paymentChannels.filter((channel) => channel.active);
  // Auto-detect the outstanding balance as the default amount to collect.
  const money = useMoneyInput(target ? (target.balanceCentavos / 100).toFixed(2) : "");
  const [method, setMethod] = useState<string>(channels[0]?.name ?? "Cash");
  const [reference, setReference] = useState("");
  const [remarks, setRemarks] = useState("");

  const selectedChannel = channels.find((channel) => channel.name === method);
  const requiresRef = selectedChannel?.requiresReference ?? method !== "Cash";
  const amount = money.centavos;
  const invalid = amount <= 0 || (target ? amount > target.balanceCentavos : true) || (requiresRef && reference.trim().length < 4);

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
                receivingAccount: method,
                referenceNumber: requiresRef ? reference.trim() : undefined,
                // Cashier-recorded payments post immediately — no approval step.
                needsVerification: false,
                remarks: remarks.trim() || undefined,
              });
              money.reset();
              setReference("");
              setRemarks("");
            }}
          >
            Post payment
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Amount (PHP)" hint={target ? `Maximum ${pesos(target.balanceCentavos)}` : undefined}>
          <input inputMode="decimal" value={money.raw} onChange={(event) => money.setRaw(event.target.value)} placeholder="0.00" />
        </Field>
        <Field label="Payment channel" hint="Channels are configured by the Admin under Payment channels.">
          <select value={method} onChange={(event) => setMethod(event.target.value)}>
            {channels.map((channel) => (
              <option key={channel.id}>{channel.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Transaction reference" hint={requiresRef ? "Type or scan the reference — no screenshot needed" : "Not required for cash"}>
          <input value={reference} onChange={(event) => setReference(event.target.value.toUpperCase())} disabled={!requiresRef} placeholder="Encode or scan reference" />
        </Field>
        <Field label="Remarks" full>
          <input value={remarks} onChange={(event) => setRemarks(event.target.value)} placeholder="Optional note for this payment" />
        </Field>
        <div className="form-full inline-note note-blue">
          <strong>{method} is posted immediately</strong>
          <p>
            An official receipt number is issued as soon as the payment is posted — no separate approval step.
            {requiresRef ? " Record the transaction reference for the account trail." : ""}
          </p>
        </div>
      </div>
    </Modal>
  );
}

function AddChargeModal({
  view,
  charges,
  onClose,
  onAdd,
}: {
  view: EnrollmentView;
  charges: { id: string; name: string; defaultAmountCentavos: number }[];
  onClose: () => void;
  onAdd: (name: string, amountCentavos: number) => void;
}) {
  const [chargeId, setChargeId] = useState(charges[0]?.id ?? "");
  const selected = charges.find((charge) => charge.id === chargeId);
  const money = useMoneyInput(selected ? (selected.defaultAmountCentavos / 100).toFixed(2) : "");
  return (
    <Modal
      open
      title="Add other charge"
      description={`${view.enrollment.reference} · ${fullName(view.trainee)}`}
      onClose={onClose}
      footer={
        <>
          <button className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary-button"
            disabled={!selected || money.centavos <= 0}
            onClick={() => {
              if (!selected) return;
              onAdd(selected.name, money.centavos);
              onClose();
            }}
          >
            Add charge
          </button>
        </>
      }
    >
      {charges.length === 0 ? (
        <EmptyState icon="₱" title="No charge types" text="Ask an Admin to add charge types under Accounting → Other charges." />
      ) : (
        <div className="form-grid">
          <Field label="Charge type" full>
            <select
              value={chargeId}
              onChange={(event) => {
                setChargeId(event.target.value);
                const next = charges.find((charge) => charge.id === event.target.value);
                if (next) money.setRaw((next.defaultAmountCentavos / 100).toFixed(2));
              }}
            >
              {charges.map((charge) => (
                <option key={charge.id} value={charge.id}>
                  {charge.name} — {pesos(charge.defaultAmountCentavos)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Amount (PHP)">
            <input inputMode="decimal" value={money.raw} onChange={(event) => money.setRaw(event.target.value)} />
          </Field>
        </div>
      )}
    </Modal>
  );
}

/**
 * Cashier applies a marketing agency's rebate as a trainee discount. Selecting
 * the agency auto-detects the amount (capped at the outstanding balance) and
 * shows the resulting balance before it is posted to the ledger.
 */
function AgencyRebateModal({
  view,
  agencies,
  onClose,
  onApply,
}: {
  view: EnrollmentView;
  agencies: { id: string; name: string; rebates: Record<string, number> }[];
  onClose: () => void;
  onApply: (name: string, amountCentavos: number) => void;
}) {
  const courseCode = view.enrollment.courseCode;
  const [agencyId, setAgencyId] = useState(agencies[0]?.id ?? "");
  const selected = agencies.find((agency) => agency.id === agencyId);
  const courseRebate = selected ? selected.rebates[courseCode] ?? 0 : 0;
  // Never discount more than the trainee still owes.
  const amount = Math.min(courseRebate, view.balanceCentavos);
  const resultingBalance = view.balanceCentavos - amount;

  return (
    <Modal
      open
      title="Apply agency rebate"
      description={`${view.enrollment.reference} · ${fullName(view.trainee)}`}
      onClose={onClose}
      footer={
        <>
          <button className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary-button"
            disabled={!selected || amount <= 0}
            onClick={() => {
              if (!selected) return;
              onApply(selected.name, amount);
              onClose();
            }}
          >
            Request rebate release
          </button>
        </>
      }
    >
      {agencies.length === 0 ? (
        <EmptyState icon="◇" title="No marketing agencies" text="Ask an Admin to add agencies under Accounting → Marketing agencies." />
      ) : (
        <div className="form-grid">
          <Field label="Marketing agency" full hint={`Rebate shown is for ${view.enrollment.courseName} (${courseCode}).`}>
            <select value={agencyId} onChange={(event) => setAgencyId(event.target.value)}>
              {agencies.map((agency) => (
                <option key={agency.id} value={agency.id}>
                  {agency.name} — {pesos(agency.rebates[courseCode] ?? 0)}
                </option>
              ))}
            </select>
          </Field>
          <div className="form-full inline-note note-blue">
            {courseRebate <= 0 ? (
              <>
                <strong>No rebate set for this course</strong>
                <p>{selected?.name ?? "This agency"} has no rebate configured for {view.enrollment.courseName}. Ask an Admin to set one under Accounting → Marketing agencies.</p>
              </>
            ) : (
              <>
                <strong>Rebate {pesos(amount)} applied as a discount</strong>
                <p>
                  Current balance {pesos(view.balanceCentavos)} → new balance {pesos(resultingBalance)}.
                  {amount < courseRebate ? " Capped to the outstanding balance." : ""}
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

/**
 * Cashier records ONE payment (one reference, one channel) and splits it across
 * several of the trainee's unpaid courses — e.g. ₱5,000 covering two courses.
 * Each course gets its own ledger payment posted under the shared reference.
 */
function SplitPaymentModal({
  trainee,
  enrollments,
  channels,
  onClose,
  onSubmit,
}: {
  trainee: EnrollmentView["trainee"];
  enrollments: EnrollmentView[];
  channels: { id: string; name: string; requiresReference: boolean }[];
  onClose: () => void;
  onSubmit: (input: {
    allocations: { enrollmentId: string; amountCentavos: number }[];
    method: string;
    referenceNumber?: string;
    needsVerification?: boolean;
  }) => void;
}) {
  const [method, setMethod] = useState<string>(channels[0]?.name ?? "Cash");
  const [reference, setReference] = useState("");
  const [included, setIncluded] = useState<Record<string, boolean>>(
    () => Object.fromEntries(enrollments.map((item) => [item.enrollment.id, true])),
  );
  // Peso strings keyed by enrollment; default each to its full outstanding balance.
  const [amounts, setAmounts] = useState<Record<string, string>>(
    () => Object.fromEntries(enrollments.map((item) => [item.enrollment.id, (item.balanceCentavos / 100).toFixed(2)])),
  );

  const requiresRef = channels.find((channel) => channel.name === method)?.requiresReference ?? method !== "Cash";
  const rows = enrollments.map((item) => {
    const centavos = included[item.enrollment.id] ? Math.round(Number(amounts[item.enrollment.id] || "0") * 100) : 0;
    const overBalance = centavos > item.balanceCentavos;
    return { item, centavos, overBalance };
  });
  const totalCentavos = rows.reduce((sum, row) => sum + row.centavos, 0);
  const anyOver = rows.some((row) => row.overBalance);
  const selectedCount = rows.filter((row) => row.centavos > 0).length;
  const invalid = totalCentavos <= 0 || selectedCount < 1 || anyOver || (requiresRef && reference.trim().length < 4);

  return (
    <Modal
      open
      title="Split payment across courses"
      description={`${fullName(trainee)} · ${trainee.traineeNumber}`}
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
              onSubmit({
                allocations: rows.filter((row) => row.centavos > 0).map((row) => ({ enrollmentId: row.item.enrollment.id, amountCentavos: row.centavos })),
                method,
                referenceNumber: requiresRef ? reference.trim() : undefined,
                // Cashier-recorded payments post immediately — no approval step.
                needsVerification: false,
              })
            }
          >
            Post split payment
          </button>
        </>
      }
    >
      {enrollments.length < 2 ? (
        <EmptyState
          icon="₱"
          title="Only one unpaid course"
          text="Split payment needs at least two of this trainee's courses to have an outstanding balance. Use Record payment instead."
        />
      ) : (
        <>
          <div className="form-grid">
            <Field label="Payment channel" hint="Channels are configured by the Admin.">
              <select value={method} onChange={(event) => setMethod(event.target.value)}>
                {channels.map((channel) => (
                  <option key={channel.id}>{channel.name}</option>
                ))}
              </select>
            </Field>
            <Field label="One reference number" hint={requiresRef ? "Shared by every course in this split" : "Not required for cash"}>
              <input
                value={reference}
                disabled={!requiresRef}
                onChange={(event) => setReference(event.target.value.toUpperCase())}
                placeholder="Single reference for all courses"
              />
            </Field>
          </div>

          <div className="split-alloc-list">
            {rows.map(({ item, overBalance }) => (
              <div key={item.enrollment.id} className="split-alloc-row">
                <label className="split-alloc-pick">
                  <input
                    type="checkbox"
                    checked={Boolean(included[item.enrollment.id])}
                    onChange={(event) => setIncluded({ ...included, [item.enrollment.id]: event.target.checked })}
                  />
                  <span>
                    <strong>{item.enrollment.courseName}</strong>
                    <small>{item.enrollment.reference} · balance {pesos(item.balanceCentavos)}</small>
                  </span>
                </label>
                <span className="split-alloc-amount">
                  <em>₱</em>
                  <input
                    inputMode="decimal"
                    value={amounts[item.enrollment.id] ?? ""}
                    disabled={!included[item.enrollment.id]}
                    onChange={(event) => setAmounts({ ...amounts, [item.enrollment.id]: event.target.value })}
                  />
                  {overBalance && <small className="value-danger">Over balance</small>}
                </span>
              </div>
            ))}
          </div>

          <div className="split-alloc-total">
            <span>Total across {selectedCount} course{selectedCount === 1 ? "" : "s"}</span>
            <strong>{pesos(totalCentavos)}</strong>
          </div>
        </>
      )}
    </Modal>
  );
}

function AdmissionInvoiceModal({
  view,
  defaultOfficer,
  defaultCashier,
  session,
  onClose,
  onGenerate,
}: {
  view: EnrollmentView;
  defaultOfficer: string;
  defaultCashier: string;
  session?: { startsAt: string; endsAt: string };
  onClose: () => void;
  onGenerate: (officer: string, cashier: string) => void;
}) {
  const [officer, setOfficer] = useState(defaultOfficer);
  const [cashier, setCashier] = useState(view.enrollment.cashierAssigned || defaultCashier);
  const [building, setBuilding] = useState(false);
  const toast = useToast();
  const { trainee, batch, enrollment, entries, dueCentavos, paidCentavos, balanceCentavos, paymentStatus } = view;
  const charges = entries.filter((entry) => entry.type === "charge");
  const payments = entries.filter((entry) => entry.type === "payment" || entry.type === "discount" || entry.type === "refund");
  const statusTone = paymentStatus === "Paid" ? "green" : paymentStatus === "Partially Paid" ? "amber" : "red";
  const statusLabel = paymentStatus === "Paid" ? "FULLY PAID" : paymentStatus === "Partially Paid" ? "PARTIALLY PAID" : "UNPAID";
  const time = session ? `${formatTime(session.startsAt)} – ${formatTime(session.endsAt)}` : "8:00 AM – 5:00 PM";

  async function downloadPdf() {
    setBuilding(true);
    try {
      const logoBytes = await fetchLogoBytes();
      const detailOf = (entry: (typeof entries)[number]) =>
        `${entry.reference} · ${formatDateTime(entry.recordedAt)}` +
        (entry.referenceNumber ? ` · Ref ${entry.referenceNumber}` : "") +
        (entry.receiptNumber ? ` · ${entry.receiptNumber}` : "");
      const bytes = await createAdmissionInvoicePdf({
        reference: enrollment.reference,
        traineeName: `${fullName(trainee)}${trainee.suffix ? ` ${trainee.suffix}` : ""}`,
        traineeNumber: trainee.traineeNumber,
        srn: trainee.srn ?? "",
        mobile: trainee.mobile,
        email: trainee.email,
        course: `${enrollment.courseName} (${enrollment.courseCode})`,
        schedule: batch ? formatDateRange(batch.startsOn, batch.endsOn) : "Open schedule",
        time,
        venue: batch?.venue ?? "",
        instructor: batch?.instructor ?? "",
        registrationStatus: enrollment.registrationStatus ?? "Waiting for Payment",
        issuedAt: formatDate(new Date().toISOString()),
        officer: officer.trim(),
        cashier: cashier.trim(),
        lines: [
          ...charges.map((entry) => ({ description: entry.description, detail: detailOf(entry), amountCentavos: entry.amountCentavos })),
          ...payments.map((entry) => ({ description: entry.description, detail: detailOf(entry), amountCentavos: entry.amountCentavos, negative: true })),
        ],
        dueCentavos,
        paidCentavos,
        balanceCentavos,
        paymentStatus,
        logoBytes,
      });
      triggerPdfDownload(bytes, `${enrollment.reference}-admission-invoice.pdf`);
    } catch {
      toast("warning", "Could not generate the combined PDF.");
    } finally {
      setBuilding(false);
    }
  }

  return (
    <Modal
      open
      title="Payment invoice & admission slip"
      description={`${enrollment.reference} · ${enrollment.courseName}`}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="secondary-button" onClick={onClose}>
            Close
          </button>
          <button className="secondary-button" onClick={() => window.print()}>
            Print
          </button>
          <button className="secondary-button" onClick={downloadPdf} disabled={building}>
            {building ? "Generating…" : "Download PDF"}
          </button>
          <button
            className="primary-button"
            onClick={() => {
              onGenerate(officer.trim(), cashier.trim());
              onClose();
            }}
          >
            Generate &amp; mark voucher
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Assigned Registration Officer">
          <input value={officer} onChange={(event) => setOfficer(event.target.value)} />
        </Field>
        <Field label="Cashier Assigned">
          <input value={cashier} onChange={(event) => setCashier(event.target.value)} />
        </Field>
      </div>

      <p className="muted-text" style={{ margin: "0 0 8px" }}>
        Download PDF produces an A4 document — page 1 is the original copy, page 2 the duplicate (file) copy.
      </p>

      <div className="admission-slip" id="admission-invoice-print">
        <div className="slip-head">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/new-wave-logo.png" alt="New Wave Maritime" className="slip-logo" />
          <div>
            <h2>NEW WAVE MARITIME TRAINING AND ASSESSMENT CENTER, INC.</h2>
            <p>Room 103, Bel-Air Apartment, 1020 Roxas Boulevard, Ermita, Manila 1000</p>
            <strong>PAYMENT INVOICE &amp; ADMISSION SLIP</strong>
          </div>
          <Pill tone={statusTone}>{statusLabel}</Pill>
        </div>

        <div className="slip-meta">
          <span>Reference <strong>{enrollment.reference}</strong></span>
          <span>Trainee No. <strong>{trainee.traineeNumber}</strong></span>
          <span>Issued <strong>{formatDate(new Date().toISOString())}</strong></span>
        </div>

        <h3 className="slip-section">Trainee</h3>
        <div className="slip-grid">
          <div><span>Name</span><strong>{fullName(trainee)}{trainee.suffix ? ` ${trainee.suffix}` : ""}</strong></div>
          <div><span>SRN</span><strong>{trainee.srn ?? "—"}</strong></div>
          <div><span>Mobile</span><strong>{trainee.mobile}</strong></div>
          <div><span>Email</span><strong>{trainee.email}</strong></div>
        </div>

        <h3 className="slip-section">Training details</h3>
        <div className="slip-grid">
          <div><span>Course</span><strong>{enrollment.courseName} ({enrollment.courseCode})</strong></div>
          <div><span>Schedule</span><strong>{batch ? formatDateRange(batch.startsOn, batch.endsOn) : "—"}</strong></div>
          <div><span>Time</span><strong>{time}</strong></div>
          <div><span>Classroom</span><strong>{batch?.venue ?? "—"}</strong></div>
          <div><span>Instructor</span><strong>{batch?.instructor ?? "—"}</strong></div>
          <div><span>Registration status</span><strong>{enrollment.registrationStatus ?? "Waiting for Payment"}</strong></div>
        </div>

        <h3 className="slip-section">Charges &amp; payments</h3>
        <div className="ledger-list">
          {charges.map((entry) => (
            <div key={entry.id} className="ledger-row ledger-charge">
              <div>
                <strong>{entry.description}</strong>
                <small>{entry.reference} · {formatDateTime(entry.recordedAt)}</small>
              </div>
              <div className="ledger-amount"><strong>{pesos(entry.amountCentavos)}</strong></div>
            </div>
          ))}
          {payments.map((entry) => (
            <div key={entry.id} className={`ledger-row ledger-${entry.type}`}>
              <div>
                <strong>{entry.description}</strong>
                <small>
                  {entry.reference} · {formatDateTime(entry.recordedAt)}
                  {entry.referenceNumber ? ` · Ref ${entry.referenceNumber}` : ""}
                  {entry.receiptNumber ? ` · ${entry.receiptNumber}` : ""}
                </small>
              </div>
              <div className="ledger-amount"><strong>&minus;{pesos(entry.amountCentavos)}</strong></div>
            </div>
          ))}
          {charges.length === 0 && payments.length === 0 && <p className="muted-text">No ledger entries yet.</p>}
        </div>

        <div className="slip-grid" style={{ marginTop: 16 }}>
          <div><span>Total due</span><strong>{pesos(dueCentavos)}</strong></div>
          <div><span>Total paid</span><strong>{pesos(paidCentavos)}</strong></div>
          <div><span>Balance</span><strong>{pesos(balanceCentavos)}</strong></div>
          <div><span>Payment status</span><strong>{statusLabel}</strong></div>
        </div>

        <div className="slip-signatures">
          <div>
            <div className="sign-line">{officer || " "}</div>
            <span>Registration Officer · Signature over Printed Name</span>
          </div>
          <div>
            <div className="sign-line">{cashier || " "}</div>
            <span>Cashier · Signature over Printed Name</span>
          </div>
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
  offers,
  seats,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (input: { traineeId: string; batchId?: string; offerId?: string }) => void;
  trainees: { id: string; traineeNumber: string; firstName: string; middleName?: string; lastName: string }[];
  batches: { id: string; batchNumber: string; courseName: string; startsOn: string; endsOn: string }[];
  offers: { id: string; course: string; center: string; trainingFeeCentavos: number }[];
  seats: (batchId: string) => { capacity: number; taken: number; available: number };
}) {
  const [traineeId, setTraineeId] = useState("");
  const [type, setType] = useState<"In-house" | "Endorsed">("In-house");
  const [batchId, setBatchId] = useState("");
  const [offerId, setOfferId] = useState("");

  const valid = Boolean(traineeId) && (type === "In-house" ? Boolean(batchId) : Boolean(offerId));

  return (
    <Modal
      open={open}
      title="New enrollment"
      description="Enroll an existing trainee into an in-house batch or an endorsed partner training. The training fee is charged automatically."
      onClose={onClose}
      footer={
        <>
          <button className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary-button"
            disabled={!valid}
            onClick={() => onCreate({ traineeId, batchId: type === "In-house" ? batchId : undefined, offerId: type === "Endorsed" ? offerId : undefined })}
          >
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
        <Field label="Training type" full>
          <Segmented options={["In-house", "Endorsed"] as const} value={type} onChange={setType} />
        </Field>
        {type === "In-house" ? (
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
        ) : (
          <Field label="Endorsed training" full hint="Scheduling is coordinated with the partner center — no New Wave batch.">
            <select value={offerId} onChange={(event) => setOfferId(event.target.value)}>
              <option value="">Select an endorsed training</option>
              {offers.map((offer) => (
                <option key={offer.id} value={offer.id}>
                  {offer.course} — {offer.center} · {pesos(offer.trainingFeeCentavos)}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>
    </Modal>
  );
}
