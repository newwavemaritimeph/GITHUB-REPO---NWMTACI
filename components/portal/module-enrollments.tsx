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
import { formatDate, formatDateRange, formatDateTime, formatTime, fullName, todayIso, useSystem } from "@/lib/system/store";
import type { EnrollmentView, RegistrationLifecycle, RequestType } from "@/lib/system/types";
import { PageHeader, Panel, StageBadge, StageTrack, type Module } from "./shared";

const filters = ["All", "Unpaid", "Awaiting verification", "Ready for instructions", "In training", "Completed"] as const;
const REGISTRATION_STATUSES: RegistrationLifecycle[] = ["Waiting for Payment", "Enrolled", "Reschedule", "Generated Voucher", "Cancelled"];

export function EnrollmentsModule({
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
    actor,
    recordPayment,
    sendInstructions,
    cancelEnrollment,
    changeEnrollmentBatch,
    setRegistrationStatus,
    generateAdmissionSlip,
    createEnrollment,
    addLedgerEntry,
    createRequest,
  } = useSystem();
  const toast = useToast();
  const [filter, setFilter] = useState<(typeof filters)[number]>("All");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(focusId ?? null);
  const [payFor, setPayFor] = useState<EnrollmentView | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [editFor, setEditFor] = useState<EnrollmentView | null>(null);
  const [editBatchId, setEditBatchId] = useState("");
  const [slipFor, setSlipFor] = useState<EnrollmentView | null>(null);
  // Registration cannot open the Requests module, so changes are raised from here.
  const [requestFor, setRequestFor] = useState<EnrollmentView | null>(null);
  const [requestType, setRequestType] = useState<RequestType>("Reschedule");
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
              <button
                className="secondary-button"
                onClick={() => {
                  setRequestFor(active);
                  setRequestType("Reschedule");
                  setRequestReason("");
                }}
              >
                Request a change
              </button>
              <button className="secondary-button" onClick={() => setSlipFor(active)}>
                Admission slip
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
              <option>Reschedule</option>
              <option>Make-up class</option>
              <option>Course change</option>
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

      {slipFor && (
        <AdmissionSlipModal
          key={slipFor.enrollment.id}
          view={slipFor}
          defaultOfficer={slipFor.enrollment.processedBy || actor}
          session={state.attendanceSessions.find((item) => item.batchId === slipFor.enrollment.batchId)}
          onClose={() => setSlipFor(null)}
          onGenerate={(officer, cashier) => {
            generateAdmissionSlip(slipFor.enrollment.id, { officer, cashier });
            toast("success", "Admission slip generated — status set to Generated Voucher.");
          }}
        />
      )}

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
        batches={state.batches.filter(
          (batch) => (batch.status === "Open" || batch.status === "Draft") && batch.startsOn >= todayIso(),
        )}
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
  }) => void;
}) {
  const { state } = useSystem();
  const channels = state.paymentChannels.filter((channel) => channel.active);
  const money = useMoneyInput();
  const [method, setMethod] = useState<string>(channels[0]?.name ?? "Cash");
  const [reference, setReference] = useState("");
  const [account, setAccount] = useState("Main cashier");

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
                receivingAccount: account,
                referenceNumber: requiresRef ? reference.trim() : undefined,
                needsVerification: requiresRef,
              });
              money.reset();
              setReference("");
            }}
          >
            {requiresRef ? "Submit for verification" : "Post payment"}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Amount (PHP)" hint={target ? `Maximum ${pesos(target.balanceCentavos)}` : undefined}>
          <input inputMode="decimal" value={money.raw} onChange={(event) => money.setRaw(event.target.value)} placeholder="0.00" />
        </Field>
        <Field label="Method">
          <select value={method} onChange={(event) => setMethod(event.target.value)}>
            {channels.map((channel) => (
              <option key={channel.id}>{channel.name}</option>
            ))}
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
        <Field label="Transaction reference" hint={requiresRef ? "Required for this channel" : "Not required for cash"}>
          <input value={reference} onChange={(event) => setReference(event.target.value.toUpperCase())} disabled={!requiresRef} placeholder="e.g. 992313" />
        </Field>
        <div className="form-full inline-note note-blue">
          <strong>{requiresRef ? `${method} payments require verification` : `${method} is posted immediately`}</strong>
          <p>
            {requiresRef
              ? "The payment appears under Payments → Verification queue. The receipt is issued only after a cashier confirms the reference against the proof."
              : "An official receipt number is issued as soon as the payment is posted."}
          </p>
        </div>
      </div>
    </Modal>
  );
}

function AdmissionSlipModal({
  view,
  defaultOfficer,
  session,
  onClose,
  onGenerate,
}: {
  view: EnrollmentView;
  defaultOfficer: string;
  session?: { startsAt: string; endsAt: string };
  onClose: () => void;
  onGenerate: (officer: string, cashier: string) => void;
}) {
  const [officer, setOfficer] = useState(defaultOfficer);
  const [cashier, setCashier] = useState(view.enrollment.cashierAssigned ?? "");
  const { trainee, batch, enrollment } = view;
  const time = session ? `${formatTime(session.startsAt)} – ${formatTime(session.endsAt)}` : "8:00 AM – 5:00 PM";

  return (
    <Modal
      open
      title="Admission slip"
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

      <div className="admission-slip" id="admission-slip-print">
        <div className="slip-head">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/new-wave-logo.png" alt="New Wave Maritime" className="slip-logo" />
          <div>
            <h2>NEW WAVE MARITIME TRAINING AND ASSESSMENT CENTER, INC.</h2>
            <p>Room 103, Bel-Air Apartment, 1020 Roxas Boulevard, Ermita, Manila 1000</p>
            <strong>ADMISSION SLIP</strong>
          </div>
        </div>

        <div className="slip-meta">
          <span>Reference <strong>{enrollment.reference}</strong></span>
          <span>Trainee No. <strong>{trainee.traineeNumber}</strong></span>
          <span>Issued <strong>{formatDate(new Date().toISOString())}</strong></span>
        </div>

        <h3 className="slip-section">Personal details</h3>
        <div className="slip-grid">
          <div><span>Name</span><strong>{fullName(trainee)}{trainee.suffix ? ` ${trainee.suffix}` : ""}</strong></div>
          <div><span>SRN</span><strong>{trainee.srn ?? "—"}</strong></div>
          <div><span>Birth date</span><strong>{trainee.birthDate}</strong></div>
          <div><span>Mobile</span><strong>{trainee.mobile}</strong></div>
          <div><span>Email</span><strong>{trainee.email}</strong></div>
          <div><span>Address</span><strong>{trainee.address ?? "—"}</strong></div>
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
