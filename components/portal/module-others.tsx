"use client";

import { useMemo, useState } from "react";
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
  useToast,
} from "@/components/ui/kit";
import { ENDORSEMENT_OFFERS, ENDORSEMENT_SUMMARY, PARTNER_CENTERS, pesos } from "@/lib/endorsement-catalog";
import { IN_HOUSE_COURSES } from "@/lib/in-house-catalog";
import { formatDate, formatDateRange, formatDateTime, fullName, todayIso, useSystem } from "@/lib/system/store";
import {
  REPORT_RANGES,
  describeRange,
  resolveRange,
  withinRange,
  type DateRange,
  type ReportRangePreset,
} from "@/lib/reporting";
import type { RequestType, Trainee } from "@/lib/system/types";
import { VALIDATION_MESSAGES, isEmail, isPhContactNumber, isSrn } from "@/lib/validation";
import { PageHeader, Panel, StageBadge, type Module } from "./shared";

/* ---------------------------------------------------------------- trainees */

export function TraineesModule({ go }: { go: (module: Module) => void }) {
  const { state, views, createTrainee } = useSystem();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Trainee | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  // Mirrors the public registration form field for field, so a trainee created by
  // staff carries exactly the same record as one who registered online.
  const emptyDraft = {
    firstName: "", middleName: "", lastName: "", suffix: "", srn: "",
    email: "", address: "", mobile: "", placeOfBirth: "", birthDate: "",
    rank: "", company: "", emergencyContactName: "", emergencyContactMobile: "",
  };
  const [draft, setDraft] = useState(emptyDraft);

  const all = views();
  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();
    return state.trainees.filter(
      (trainee) => !term || `${fullName(trainee)} ${trainee.traineeNumber} ${trainee.email} ${trainee.mobile}`.toLowerCase().includes(term),
    );
  }, [query, state.trainees]);

  const selectedViews = selected ? all.filter((item) => item.trainee.id === selected.id) : [];
  const duplicates = state.submissions.filter((item) => item.status === "Possible Duplicate").length;

  return (
    <div className="page">
      <PageHeader
        eyebrow="Central master records"
        title="Trainees"
        description="Duplicate-aware profiles with registration history, enrollments, balances, and certificates."
        actions={
          <button className="primary-button" onClick={() => setNewOpen(true)}>
            + New trainee
          </button>
        }
      />

      <div className="stat-grid stat-grid-4">
        <StatCard label="Trainee records" value={String(state.trainees.length)} note="All programs" tone={0} icon="◎" />
        <StatCard label="With active enrollment" value={String(new Set(all.filter((item) => item.stage !== "Cancelled").map((item) => item.trainee.id)).size)} note="Currently in the pipeline" tone={3} icon="▤" />
        <StatCard label="Possible duplicates" value={String(duplicates)} note="Awaiting authorized review" tone={1} icon="!" onClick={() => go("Registrations")} />
        <StatCard label="Certificates released" value={String(all.filter((item) => item.certificate?.status === "Released").length)} note="Completion records" tone={2} icon="✓" />
      </div>

      <Panel padded={false}>
        <div className="toolbar">
          <SearchInput value={query} onChange={setQuery} placeholder="Search name, trainee number, email, or mobile" />
        </div>
        {rows.length === 0 ? (
          <EmptyState title="No trainee matches" text="Try another search term, or create a trainee record manually." />
        ) : (
          <DataTable columns={["Trainee", "Contact", "Enrollments", "Balance", "Latest stage", ""]} minWidth={940}>
            {rows.map((trainee) => {
              const owned = all.filter((item) => item.trainee.id === trainee.id);
              const balance = owned.reduce((sum, item) => sum + item.balanceCentavos, 0);
              return (
                <tr key={trainee.id} className="row-clickable" onClick={() => setSelected(trainee)}>
                  <td>
                    <div className="person-cell">
                      <Avatar name={fullName(trainee)} />
                      <div>
                        <strong>{fullName(trainee)}</strong>
                        <small>{trainee.traineeNumber}</small>
                      </div>
                    </div>
                  </td>
                  <td>
                    {trainee.email}
                    <small>{trainee.mobile}</small>
                  </td>
                  <td>{owned.length}</td>
                  <td>
                    <strong className={balance > 0 ? "value-danger" : "value-good"}>{pesos(balance)}</strong>
                  </td>
                  <td>{owned[0] ? <StageBadge stage={owned[0].stage} /> : <span className="muted-text">No enrollment</span>}</td>
                  <td className="cell-actions">
                    <button className="ghost-button">View</button>
                  </td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </Panel>

      <Drawer open={Boolean(selected)} title={selected ? fullName(selected) : ""} subtitle={selected?.traineeNumber} onClose={() => setSelected(null)}>
        {selected && (
          <>
            <dl className="detail-list">
              <div>
                <dt>Email</dt>
                <dd>{selected.email}</dd>
              </div>
              <div>
                <dt>Mobile</dt>
                <dd>{selected.mobile}</dd>
              </div>
              <div>
                <dt>Birth date</dt>
                <dd>{selected.birthDate}</dd>
              </div>
              <div>
                <dt>Address</dt>
                <dd>{selected.address ?? "—"}</dd>
              </div>
              <div>
                <dt>SRN</dt>
                <dd>{selected.srn ?? "Not recorded"}</dd>
              </div>
              <div>
                <dt>Emergency contact</dt>
                <dd>{selected.emergencyContactName ?? "—"}{selected.emergencyContactMobile ? ` · ${selected.emergencyContactMobile}` : ""}</dd>
              </div>
            </dl>
            <h3 className="drawer-section">Enrollment history</h3>
            {selectedViews.length === 0 ? (
              <p className="muted-text">No enrollment yet for this trainee.</p>
            ) : (
              <div className="history-list">
                {selectedViews.map((item) => (
                  <div key={item.enrollment.id} className="history-row">
                    <div>
                      <strong>{item.enrollment.courseName}</strong>
                      <small>
                        {item.enrollment.reference} · {item.batch ? formatDateRange(item.batch.startsOn, item.batch.endsOn) : "Open schedule"}
                      </small>
                    </div>
                    <div className="history-right">
                      <StageBadge stage={item.stage} />
                      <small>{item.balanceCentavos > 0 ? `${pesos(item.balanceCentavos)} balance` : "Settled"}</small>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </Drawer>

      <Modal
        open={newOpen}
        title="New trainee record"
        onClose={() => setNewOpen(false)}
        footer={
          <>
            <button className="secondary-button" onClick={() => setNewOpen(false)}>
              Cancel
            </button>
            <button
              className="primary-button"
              disabled={
                !draft.firstName || !draft.lastName || !draft.birthDate || !draft.placeOfBirth || !draft.rank ||
                !draft.address || !draft.emergencyContactName ||
                !isEmail(draft.email) || !isPhContactNumber(draft.mobile) ||
                !isPhContactNumber(draft.emergencyContactMobile) ||
                (draft.srn.trim() !== "" && !isSrn(draft.srn))
              }
              onClick={() => {
                const trainee = createTrainee({
                  ...draft,
                  middleName: draft.middleName || undefined,
                  suffix: draft.suffix || undefined,
                  srn: draft.srn || undefined,
                  company: draft.company || undefined,
                });
                toast("success", `${trainee.traineeNumber} created.`);
                setDraft(emptyDraft);
                setNewOpen(false);
              }}
            >
              Create trainee
            </button>
          </>
        }
      >
        <div className="form-grid">
          <Field label="First name*">
            <input value={draft.firstName} onChange={(event) => setDraft({ ...draft, firstName: event.target.value })} />
          </Field>
          <Field label="Middle name">
            <input value={draft.middleName} onChange={(event) => setDraft({ ...draft, middleName: event.target.value })} />
          </Field>
          <Field label="Last name*">
            <input value={draft.lastName} onChange={(event) => setDraft({ ...draft, lastName: event.target.value })} />
          </Field>
          <Field label="Suffix">
            <input value={draft.suffix} onChange={(event) => setDraft({ ...draft, suffix: event.target.value })} placeholder="Jr., III" />
          </Field>
          <Field label="SRN" hint={draft.srn && !isSrn(draft.srn) ? VALIDATION_MESSAGES.srn : "Exactly 10 digits"}>
            <input value={draft.srn} onChange={(event) => setDraft({ ...draft, srn: event.target.value })} />
          </Field>
          <Field label="Email*" hint={draft.email && !isEmail(draft.email) ? VALIDATION_MESSAGES.email : undefined}>
            <input type="email" value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} />
          </Field>
          <Field label="Present address*" full>
            <input value={draft.address} onChange={(event) => setDraft({ ...draft, address: event.target.value })} />
          </Field>
          <Field label="Contact number*" hint={draft.mobile && !isPhContactNumber(draft.mobile) ? VALIDATION_MESSAGES.contact : undefined}>
            <input value={draft.mobile} onChange={(event) => setDraft({ ...draft, mobile: event.target.value })} placeholder="09XX XXX XXXX" />
          </Field>
          <Field label="Place of birth*">
            <input value={draft.placeOfBirth} onChange={(event) => setDraft({ ...draft, placeOfBirth: event.target.value })} />
          </Field>
          <Field label="Date of birth*">
            <input type="date" value={draft.birthDate} onChange={(event) => setDraft({ ...draft, birthDate: event.target.value })} />
          </Field>
          <Field label="Rank*">
            <input value={draft.rank} onChange={(event) => setDraft({ ...draft, rank: event.target.value })} />
          </Field>
          <Field label="Company">
            <input value={draft.company} onChange={(event) => setDraft({ ...draft, company: event.target.value })} />
          </Field>
          <Field label="Emergency contact person*">
            <input value={draft.emergencyContactName} onChange={(event) => setDraft({ ...draft, emergencyContactName: event.target.value })} />
          </Field>
          <Field label="Emergency contact number*" hint={draft.emergencyContactMobile && !isPhContactNumber(draft.emergencyContactMobile) ? VALIDATION_MESSAGES.contact : undefined}>
            <input value={draft.emergencyContactMobile} onChange={(event) => setDraft({ ...draft, emergencyContactMobile: event.target.value })} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}

/* ----------------------------------------------------------------- catalog */

export function CatalogModule() {
  const [tab, setTab] = useState<"New Wave courses" | "Endorsed partner offers">("New Wave courses");
  const [query, setQuery] = useState("");
  const [center, setCenter] = useState("All centers");

  const offers = useMemo(
    () =>
      ENDORSEMENT_OFFERS.filter(
        (offer) =>
          (center === "All centers" || offer.center === center) &&
          `${offer.course} ${offer.center}`.toLowerCase().includes(query.toLowerCase()),
      ),
    [center, query],
  );
  const courses = useMemo(
    () => IN_HOUSE_COURSES.filter((course) => `${course.code} ${course.course} ${course.category}`.toLowerCase().includes(query.toLowerCase())),
    [query],
  );
  const rebateTotal = offers.reduce((sum, offer) => sum + offer.rebateCentavos, 0);

  return (
    <div className="page">
      <PageHeader
        eyebrow="Internal commercial catalog"
        title="Courses & training centers"
        description="New Wave course pricing plus endorsed partner offers. Fees, rebates, and payables are staff-only."
      />

      <div className="partner-summary">
        {ENDORSEMENT_SUMMARY.map((item) => (
          <article key={item.center}>
            <span>{item.center}</span>
            <strong>{item.offers}</strong>
            <small>active offerings</small>
          </article>
        ))}
      </div>

      <Panel padded={false}>
        <div className="toolbar toolbar-wrap">
          <Segmented options={["New Wave courses", "Endorsed partner offers"] as const} value={tab} onChange={setTab} />
          <SearchInput value={query} onChange={setQuery} placeholder="Search course or center" />
          {tab === "Endorsed partner offers" && (
            <>
              <label className="inline-field">
                <span>Center</span>
                <select value={center} onChange={(event) => setCenter(event.target.value)}>
                  <option>All centers</option>
                  {PARTNER_CENTERS.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
              <div className="toolbar-end total-block">
                <span>Visible rebate total</span>
                <strong>{pesos(rebateTotal)}</strong>
              </div>
            </>
          )}
        </div>
        {tab === "New Wave courses" ? (
          <DataTable columns={["Course", "Category", "Duration", "Delivery", "Fee"]}>
            {courses.map((course) => (
              <tr key={course.id}>
                <td>
                  <strong>{course.course}</strong>
                  <small>{course.code}</small>
                </td>
                <td>{course.category}</td>
                <td>{course.duration}</td>
                <td>{course.modality}</td>
                <td>
                  <strong>{pesos(course.priceCentavos)}</strong>
                </td>
              </tr>
            ))}
          </DataTable>
        ) : (
          <DataTable columns={["Course", "Training center", "Duration", "Training fee", "New Wave rebate", "Partner payable"]} minWidth={980}>
            {offers.map((offer) => (
              <tr key={offer.id}>
                <td>
                  <strong>{offer.course}</strong>
                  <small>Source row {offer.sourceRow}</small>
                </td>
                <td>{offer.center}</td>
                <td>{offer.duration}</td>
                <td>
                  <strong>{pesos(offer.trainingFeeCentavos)}</strong>
                </td>
                <td>
                  <strong className="value-good">{pesos(offer.rebateCentavos)}</strong>
                </td>
                <td>{pesos(offer.partnerPayableCentavos)}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>
      <p className="footnote">
        Fees, rebates, and partner payables are snapshotted when an enrollment is created, so later catalog edits never alter
        historical accounting.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------- accounting */

export function AccountingModule() {
  const { state, views, decideExpense } = useSystem();
  const toast = useToast();
  const all = views();

  const payments = state.ledger.filter((entry) => entry.type === "payment" && entry.verification === "Verified");
  const gross = payments.reduce((sum, entry) => sum + entry.amountCentavos, 0);
  const refunds = state.ledger
    .filter((entry) => entry.type === "refund" || entry.type === "reversal")
    .reduce((sum, entry) => sum + entry.amountCentavos, 0);
  const receivables = all.reduce((sum, item) => sum + item.balanceCentavos, 0);
  const unreconciled = state.ledger.filter((entry) => entry.type === "payment" && entry.verification === "Pending");
  const expensesPending = state.expenses.filter((expense) => expense.status === "Pending");

  return (
    <div className="page">
      <PageHeader
        eyebrow="Financial control"
        title="Accounting"
        description="Collections, receivables, reconciliation, expenses, and partner payables built from the same ledger the cashier posts to."
      />

      <div className="stat-grid stat-grid-4">
        <StatCard label="Gross collections" value={pesos(gross)} note={`${payments.length} verified payments`} tone={2} icon="₱" />
        <StatCard label="Net collections" value={pesos(gross - refunds)} note={`${pesos(refunds)} refunded or reversed`} tone={0} icon="▥" />
        <StatCard label="Receivables" value={pesos(receivables)} note={`${all.filter((item) => item.balanceCentavos > 0).length} open balances`} tone={1} icon="!" />
        <StatCard label="Unreconciled" value={String(unreconciled.length)} note={pesos(unreconciled.reduce((sum, entry) => sum + entry.amountCentavos, 0))} tone={5} icon="◎" />
      </div>

      <div className="two-column">
        <Panel title="Collections by method" description="Verified payments only">
          <div className="bar-list">
            {(["Cash", "GCash", "Bank transfer", "Card"] as const).map((method) => {
              const total = payments.filter((entry) => entry.method === method).reduce((sum, entry) => sum + entry.amountCentavos, 0);
              const share = gross > 0 ? Math.round((total / gross) * 100) : 0;
              return (
                <div key={method} className="bar-row">
                  <span>{method}</span>
                  <div className="bar-track">
                    <i style={{ width: `${share}%` }} />
                  </div>
                  <strong>{pesos(total)}</strong>
                </div>
              );
            })}
          </div>
        </Panel>

        <Panel title="Expense approvals" description="Vouchers waiting for a decision">
          {expensesPending.length === 0 ? (
            <EmptyState icon="✓" title="No pending vouchers" text="Every submitted expense has been decided." />
          ) : (
            <div className="history-list">
              {state.expenses.map((expense) => (
                <div key={expense.id} className="history-row">
                  <div>
                    <strong>{expense.payee}</strong>
                    <small>
                      {expense.expenseNumber} · {expense.category} · {expense.purpose}
                    </small>
                  </div>
                  <div className="history-right">
                    <strong>{pesos(expense.amountCentavos)}</strong>
                    {expense.status === "Pending" ? (
                      <div className="cell-actions">
                        <button
                          className="ghost-button"
                          onClick={() => {
                            decideExpense(expense.id, "Approved");
                            toast("success", "Expense approved.");
                          }}
                        >
                          Approve
                        </button>
                        <button
                          className="ghost-button ghost-danger"
                          onClick={() => {
                            decideExpense(expense.id, "Rejected");
                            toast("warning", "Expense rejected.");
                          }}
                        >
                          Reject
                        </button>
                      </div>
                    ) : (
                      <Pill tone={expense.status === "Rejected" ? "red" : "green"}>{expense.status}</Pill>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <Panel title="Receivables ageing" description="Open balances by enrollment" padded={false}>
        <DataTable columns={["Trainee", "Enrollment", "Charged", "Paid", "Balance", "Stage"]}>
          {all
            .filter((item) => item.balanceCentavos > 0)
            .map((item) => (
              <tr key={item.enrollment.id}>
                <td>
                  <strong>{fullName(item.trainee)}</strong>
                  <small>{item.trainee.traineeNumber}</small>
                </td>
                <td>
                  <strong>{item.enrollment.reference}</strong>
                  <small>{item.enrollment.courseName}</small>
                </td>
                <td>{pesos(item.dueCentavos)}</td>
                <td>{pesos(item.paidCentavos)}</td>
                <td>
                  <strong className="value-danger">{pesos(item.balanceCentavos)}</strong>
                </td>
                <td>
                  <StageBadge stage={item.stage} />
                </td>
              </tr>
            ))}
        </DataTable>
        {all.every((item) => item.balanceCentavos === 0) && (
          <EmptyState icon="✓" title="No receivables" text="Every active enrollment is fully settled." />
        )}
      </Panel>
    </div>
  );
}

/* ------------------------------------------------------------ instructions */

export function InstructionsModule() {
  const { views, sendInstructions } = useSystem();
  const toast = useToast();
  const [tab, setTab] = useState<"Ready to send" | "Awaiting acknowledgment" | "Acknowledged">("Ready to send");
  const all = views().filter((item) => item.enrollment.status !== "Cancelled");

  const ready = all.filter((item) => item.paymentStatus === "Paid" && !item.enrollment.instructionsSentAt);
  const awaiting = all.filter((item) => item.enrollment.instructionsSentAt && !item.enrollment.instructionsAcknowledgedAt);
  const acknowledged = all.filter((item) => item.enrollment.instructionsAcknowledgedAt);
  const rows = tab === "Ready to send" ? ready : tab === "Awaiting acknowledgment" ? awaiting : acknowledged;

  return (
    <div className="page">
      <PageHeader
        eyebrow="Trainee communication"
        title="Training instructions"
        description="Send reporting details to fully paid enrollments and track acknowledgment from the trainee portal."
        actions={
          <button
            className="primary-button"
            disabled={ready.length === 0}
            onClick={() => {
              ready.forEach((item) => sendInstructions(item.enrollment.id));
              toast("success", `Instructions sent to ${ready.length} trainee${ready.length === 1 ? "" : "s"}.`);
              setTab("Awaiting acknowledgment");
            }}
          >
            Send all ready ({ready.length})
          </button>
        }
      />

      <div className="stat-grid stat-grid-3">
        <StatCard label="Ready to send" value={String(ready.length)} note="Confirmed and fully paid" tone={1} icon="✉" />
        <StatCard label="Awaiting acknowledgment" value={String(awaiting.length)} note="Follow-up active" tone={3} icon="□" />
        <StatCard label="Acknowledged" value={String(acknowledged.length)} note="Confirmed by trainees" tone={2} icon="✓" />
      </div>

      <Panel padded={false}>
        <div className="toolbar">
          <Segmented options={["Ready to send", "Awaiting acknowledgment", "Acknowledged"] as const} value={tab} onChange={setTab} />
        </div>
        {rows.length === 0 ? (
          <EmptyState
            title="Nothing in this list"
            text="Instructions become available once an enrollment is fully paid. Post a payment first, then return here."
          />
        ) : (
          <DataTable columns={["Trainee", "Batch", "Reporting", "Status", ""]}>
            {rows.map((item) => (
              <tr key={item.enrollment.id}>
                <td>
                  <strong>{fullName(item.trainee)}</strong>
                  <small>{item.enrollment.reference}</small>
                </td>
                <td>
                  <strong>{item.batch?.batchNumber ?? "—"}</strong>
                  <small>{item.enrollment.courseName}</small>
                </td>
                <td>
                  {item.batch ? formatDateRange(item.batch.startsOn, item.batch.endsOn) : "—"}
                  <small>
                    {item.batch?.venue} · 8:00 AM
                  </small>
                </td>
                <td>
                  {item.enrollment.instructionsAcknowledgedAt ? (
                    <Pill tone="green">Acknowledged</Pill>
                  ) : item.enrollment.instructionsSentAt ? (
                    <Pill tone="amber">Sent {formatDate(item.enrollment.instructionsSentAt)}</Pill>
                  ) : (
                    <Pill tone="blue">Ready</Pill>
                  )}
                </td>
                <td className="cell-actions">
                  <button
                    className="ghost-button"
                    disabled={Boolean(item.enrollment.instructionsSentAt)}
                    onClick={() => {
                      sendInstructions(item.enrollment.id);
                      toast("success", "Instructions sent.");
                    }}
                  >
                    {item.enrollment.instructionsSentAt ? "Sent" : "Send"}
                  </button>
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>
    </div>
  );
}

/* ---------------------------------------------------------------- requests */

const requestTypes: RequestType[] = ["Reschedule", "Course change", "Refund", "Record correction", "Make-up class", "Cancellation"];

export function RequestsModule() {
  const { state, views, createRequest, decideRequest } = useSystem();
  const toast = useToast();
  const [tab, setTab] = useState<"Pending" | "Decided" | "All">("Pending");
  const [newOpen, setNewOpen] = useState(false);
  const [draft, setDraft] = useState({ type: "Reschedule" as RequestType, enrollmentId: "", reason: "" });

  const all = views();
  const rows = state.requests.filter((request) =>
    tab === "Pending"
      ? request.status === "Pending" || request.status === "For clarification"
      : tab === "Decided"
        ? request.status === "Approved" || request.status === "Rejected"
        : true,
  );

  return (
    <div className="page">
      <PageHeader
        eyebrow="Controlled changes"
        title="Requests & approvals"
        description="Reschedules, corrections, refunds, and cancellations with an immutable decision history."
        actions={
          <button className="primary-button" onClick={() => setNewOpen(true)}>
            + New request
          </button>
        }
      />

      <div className="stat-grid stat-grid-4">
        <StatCard label="Pending" value={String(state.requests.filter((item) => item.status === "Pending").length)} note="Awaiting a decision" tone={1} icon="!" />
        <StatCard label="For clarification" value={String(state.requests.filter((item) => item.status === "For clarification").length)} note="Returned to requester" tone={3} icon="↗" />
        <StatCard label="Approved" value={String(state.requests.filter((item) => item.status === "Approved").length)} note="Applied to records" tone={2} icon="✓" />
        <StatCard label="Rejected" value={String(state.requests.filter((item) => item.status === "Rejected").length)} note="Reason recorded" tone={5} icon="✕" />
      </div>

      <Panel padded={false}>
        <div className="toolbar">
          <Segmented options={["Pending", "Decided", "All"] as const} value={tab} onChange={setTab} />
        </div>
        {rows.length === 0 ? (
          <EmptyState icon="✓" title="Nothing to decide" text="New requests from the trainee portal and staff appear here." />
        ) : (
          <DataTable columns={["Request", "Type", "Trainee", "Reason", "Status", ""]} minWidth={980}>
            {rows.map((request) => (
              <tr key={request.id}>
                <td>
                  <strong>{request.reference}</strong>
                  <small>{formatDateTime(request.createdAt)}</small>
                </td>
                <td>{request.type}</td>
                <td>
                  <strong>{request.traineeName}</strong>
                  <small>{state.enrollments.find((item) => item.id === request.enrollmentId)?.reference ?? "—"}</small>
                </td>
                <td className="cell-wrap">
                  {request.reason}
                  {request.remarks && <small>Remarks: {request.remarks}</small>}
                </td>
                <td>
                  <Pill
                    tone={
                      request.status === "Approved" ? "green" : request.status === "Rejected" ? "red" : request.status === "For clarification" ? "blue" : "amber"
                    }
                  >
                    {request.status}
                  </Pill>
                </td>
                <td className="cell-actions">
                  {request.status === "Pending" || request.status === "For clarification" ? (
                    <>
                      <button
                        className="ghost-button"
                        onClick={() => {
                          decideRequest(request.id, "Approved");
                          toast("success", `${request.reference} approved.`);
                        }}
                      >
                        Approve
                      </button>
                      <button
                        className="ghost-button"
                        onClick={() => {
                          const remarks = window.prompt("What clarification do you need?");
                          if (!remarks) return;
                          decideRequest(request.id, "For clarification", remarks);
                          toast("info", "Returned to the requester.");
                        }}
                      >
                        Clarify
                      </button>
                      <button
                        className="ghost-button ghost-danger"
                        onClick={() => {
                          const remarks = window.prompt("Reason for rejecting this request?");
                          if (!remarks) return;
                          decideRequest(request.id, "Rejected", remarks);
                          toast("warning", "Request rejected.");
                        }}
                      >
                        Reject
                      </button>
                    </>
                  ) : (
                    <span className="muted-text">{request.decidedBy ?? "—"}</span>
                  )}
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>

      <Modal
        open={newOpen}
        title="New change request"
        description="Requests keep controlled changes auditable instead of editing records directly."
        onClose={() => setNewOpen(false)}
        footer={
          <>
            <button className="secondary-button" onClick={() => setNewOpen(false)}>
              Cancel
            </button>
            <button
              className="primary-button"
              disabled={!draft.enrollmentId || draft.reason.trim().length < 8}
              onClick={() => {
                const target = all.find((item) => item.enrollment.id === draft.enrollmentId);
                if (!target) return;
                const request = createRequest({
                  type: draft.type,
                  enrollmentId: draft.enrollmentId,
                  traineeName: fullName(target.trainee),
                  reason: draft.reason.trim(),
                });
                toast("success", `${request.reference} submitted for approval.`);
                setDraft({ type: "Reschedule", enrollmentId: "", reason: "" });
                setNewOpen(false);
              }}
            >
              Submit request
            </button>
          </>
        }
      >
        <div className="form-grid">
          <Field label="Request type" full>
            <select value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value as RequestType })}>
              {requestTypes.map((type) => (
                <option key={type}>{type}</option>
              ))}
            </select>
          </Field>
          <Field label="Enrollment" full>
            <select value={draft.enrollmentId} onChange={(event) => setDraft({ ...draft, enrollmentId: event.target.value })}>
              <option value="">Select an enrollment</option>
              {all.map((item) => (
                <option key={item.enrollment.id} value={item.enrollment.id}>
                  {item.enrollment.reference} — {fullName(item.trainee)} · {item.enrollment.courseName}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Reason" full hint="At least 8 characters. This is stored on the immutable request history.">
            <textarea rows={4} value={draft.reason} onChange={(event) => setDraft({ ...draft, reason: event.target.value })} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}

/* ---------------------------------------------------------------------- HR */

export function HrModule() {
  const { state, decideLeave, advancePayroll } = useSystem();
  const toast = useToast();
  const [tab, setTab] = useState<"Employees" | "Leave" | "Payroll">("Employees");

  const draft = state.payrollPeriods.find((period) => period.status !== "Finalized");
  const draftGross = draft?.items.reduce((sum, item) => sum + item.grossCentavos, 0) ?? 0;
  const draftNet = draft?.items.reduce((sum, item) => sum + item.grossCentavos - item.deductionCentavos, 0) ?? 0;

  return (
    <div className="page">
      <PageHeader
        eyebrow="People operations"
        title="HR & payroll"
        description="Employees, leave decisions, and payroll periods with a draft → review → finalize control."
      />

      <div className="stat-grid stat-grid-4">
        <StatCard label="Active employees" value={String(state.employees.filter((item) => item.status === "Active").length)} note={`${state.employees.filter((item) => item.department === "Training").length} in training`} tone={0} icon="◎" />
        <StatCard label="Pending leave" value={String(state.leaveRequests.filter((item) => item.status === "Pending").length)} note="Awaiting a decision" tone={1} icon="!" onClick={() => setTab("Leave")} />
        <StatCard label="Payroll draft" value={pesos(draftNet)} note={draft ? `${draft.periodNumber} · ${draft.status}` : "No open period"} tone={3} icon="₱" onClick={() => setTab("Payroll")} />
        <StatCard label="Gross this period" value={pesos(draftGross)} note={draft ? formatDateRange(draft.startsOn, draft.endsOn) : "—"} tone={2} icon="▥" />
      </div>

      <Panel padded={false}>
        <div className="toolbar">
          <Segmented options={["Employees", "Leave", "Payroll"] as const} value={tab} onChange={setTab} />
        </div>

        {tab === "Employees" && (
          <DataTable columns={["Employee", "Position", "Department", "Type", "Monthly rate", "Status"]}>
            {state.employees.map((employee) => (
              <tr key={employee.id}>
                <td>
                  <div className="person-cell">
                    <Avatar name={employee.name} tone="orange" />
                    <div>
                      <strong>{employee.name}</strong>
                      <small>{employee.employeeNumber}</small>
                    </div>
                  </div>
                </td>
                <td>{employee.position}</td>
                <td>{employee.department}</td>
                <td>{employee.employmentType}</td>
                <td>{employee.monthlyRateCentavos > 0 ? pesos(employee.monthlyRateCentavos) : `${pesos(employee.dailyRateCentavos)} / day`}</td>
                <td>
                  <Pill tone={employee.status === "Active" ? "green" : "amber"}>{employee.status}</Pill>
                </td>
              </tr>
            ))}
          </DataTable>
        )}

        {tab === "Leave" && (
          <DataTable columns={["Reference", "Employee", "Type", "Dates", "Reason", "Status", ""]} minWidth={980}>
            {state.leaveRequests.map((leave) => {
              const employee = state.employees.find((item) => item.id === leave.employeeId);
              return (
                <tr key={leave.id}>
                  <td>
                    <strong>{leave.reference}</strong>
                  </td>
                  <td>{employee?.name ?? "—"}</td>
                  <td>{leave.leaveType}</td>
                  <td>{formatDateRange(leave.startsOn, leave.endsOn)}</td>
                  <td className="cell-wrap">{leave.reason}</td>
                  <td>
                    <Pill tone={leave.status === "Approved" ? "green" : leave.status === "Rejected" ? "red" : "amber"}>{leave.status}</Pill>
                  </td>
                  <td className="cell-actions">
                    {leave.status === "Pending" ? (
                      <>
                        <button
                          className="ghost-button"
                          onClick={() => {
                            decideLeave(leave.id, "Approved");
                            toast("success", "Leave approved.");
                          }}
                        >
                          Approve
                        </button>
                        <button
                          className="ghost-button ghost-danger"
                          onClick={() => {
                            decideLeave(leave.id, "Rejected");
                            toast("warning", "Leave rejected.");
                          }}
                        >
                          Reject
                        </button>
                      </>
                    ) : (
                      <span className="muted-text">{leave.decidedAt ? formatDate(leave.decidedAt) : "—"}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </DataTable>
        )}

        {tab === "Payroll" && (
          <div className="panel-padded">
            {state.payrollPeriods.map((period) => {
              const gross = period.items.reduce((sum, item) => sum + item.grossCentavos, 0);
              const deductions = period.items.reduce((sum, item) => sum + item.deductionCentavos, 0);
              return (
                <div key={period.id} className="payroll-card">
                  <div>
                    <strong>{period.periodNumber}</strong>
                    <small>
                      {formatDateRange(period.startsOn, period.endsOn)} · pay date {formatDate(period.payDate)} · {period.items.length} employees
                    </small>
                  </div>
                  <div className="payroll-figures">
                    <span>
                      Gross <strong>{pesos(gross)}</strong>
                    </span>
                    <span>
                      Deductions <strong>{pesos(deductions)}</strong>
                    </span>
                    <span>
                      Net <strong className="value-good">{pesos(gross - deductions)}</strong>
                    </span>
                  </div>
                  <div className="payroll-actions">
                    <Pill tone={period.status === "Finalized" ? "green" : period.status === "For review" ? "blue" : "amber"}>{period.status}</Pill>
                    {period.status !== "Finalized" && (
                      <button
                        className="ghost-button"
                        onClick={() => {
                          advancePayroll(period.id);
                          toast("success", period.status === "Draft" ? "Payroll sent for review." : "Payroll finalized.");
                        }}
                      >
                        {period.status === "Draft" ? "Send for review" : "Finalize"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}

/* ----------------------------------------------------------------- reports */

function downloadCsv(filename: string, rows: (string | number)[][]) {
  const body = rows
    .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","))
    .join("\n");
  const url = URL.createObjectURL(new Blob([body], { type: "text/csv;charset=utf-8;" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function ReportsModule() {
  const { state, views } = useSystem();
  const toast = useToast();
  const all = views();

  // Every report is bound to a period. An unbounded export is what makes two
  // people quoting "the collections report" disagree about the number.
  const [preset, setPreset] = useState<ReportRangePreset>("This month");
  const [custom, setCustom] = useState<DateRange>({ from: todayIso(), to: todayIso() });
  const range = resolveRange(preset, todayIso(), custom);
  const inRange = (value?: string | null) => withinRange(value, range);

  const reports = [
    {
      title: "Enrollment register",
      description: "Enrollments created in the period, with charges, payments, balance, and stage.",
      rows: () => [
        ["Enrollment", "Trainee", "Trainee number", "Course", "Batch", "Charged", "Paid", "Balance", "Payment status", "Stage"],
        ...all
          .filter((item) => inRange(item.enrollment.createdAt))
          .map((item) => [
            item.enrollment.reference,
            fullName(item.trainee),
            item.trainee.traineeNumber,
            item.enrollment.courseName,
            item.batch?.batchNumber ?? "",
            (item.dueCentavos / 100).toFixed(2),
            (item.paidCentavos / 100).toFixed(2),
            (item.balanceCentavos / 100).toFixed(2),
            item.paymentStatus,
            item.stage,
          ]),
      ],
    },
    {
      title: "Collections report",
      description: "Payments received in the period, with method, verification state, and receipt.",
      rows: () => [
        ["Payment", "Enrollment", "Method", "Reference", "Amount", "Verification", "Receipt", "Recorded at", "Recorded by"],
        ...state.ledger
          .filter((entry) => entry.type === "payment" && inRange(entry.recordedAt))
          .map((entry) => [
            entry.reference,
            state.enrollments.find((item) => item.id === entry.enrollmentId)?.reference ?? "",
            entry.method ?? "",
            entry.referenceNumber ?? "",
            (entry.amountCentavos / 100).toFixed(2),
            entry.verification,
            entry.receiptNumber ?? "",
            entry.recordedAt,
            entry.recordedBy,
          ]),
      ],
    },
    {
      title: "Attendance summary",
      description: "Per-session attendance for training days falling in the period.",
      rows: () => [
        ["Batch", "Session", "Date", "Trainee", "Status", "Method", "Checked in", "Checked out"],
        ...state.attendanceRecords
          .filter((record) => inRange(state.attendanceSessions.find((item) => item.id === record.sessionId)?.sessionDate))
          .map((record) => {
            const session = state.attendanceSessions.find((item) => item.id === record.sessionId);
            const enrollment = state.enrollments.find((item) => item.id === record.enrollmentId);
            const trainee = state.trainees.find((item) => item.id === enrollment?.traineeId);
            const batch = state.batches.find((item) => item.id === session?.batchId);
            return [
              batch?.batchNumber ?? "",
              session?.name ?? "",
              session?.sessionDate ?? "",
              trainee ? fullName(trainee) : "",
              record.status,
              record.method,
              record.checkedInAt ?? "",
              record.checkedOutAt ?? "",
            ];
          }),
      ],
    },
    {
      title: "Certificate register",
      description: "Certificates printed or released in the period.",
      rows: () => [
        ["Certificate", "Trainee", "Course", "Status", "Printed", "Released", "Released to"],
        // Only real issuance events count. `updatedAt` is touched by every
        // reconciliation pass, so it would pull in untouched certificates.
        ...all
          .filter((item) => inRange(item.certificate?.releasedAt ?? item.certificate?.printedAt))
          .map((item) => [
            item.certificate?.certificateNumber ?? "Not assigned",
            fullName(item.trainee),
            item.enrollment.courseName,
            item.certificate?.status ?? "",
            item.certificate?.printedAt ?? "",
            item.certificate?.releasedAt ?? "",
            item.certificate?.releasedTo ?? "",
          ]),
      ],
    },
    {
      title: "Audit trail",
      description: "Actions recorded in the period, with actor and record reference.",
      rows: () => [
        ["When", "Actor", "Action", "Record type", "Reference", "Detail"],
        ...state.activity
          .filter((entry) => inRange(entry.createdAt))
          .map((entry) => [entry.createdAt, entry.actor, entry.action, entry.recordType, entry.recordRef, entry.detail ?? ""]),
      ],
    },
  ];

  const activity = state.activity.filter((entry) => inRange(entry.createdAt));

  return (
    <div className="page">
      <PageHeader
        eyebrow="Audited exports"
        title="Reports"
        description="Every report is generated from live records for a chosen period and downloads as a spreadsheet-ready CSV."
      />

      <Panel padded={false}>
        <div className="toolbar toolbar-wrap">
          <Segmented options={REPORT_RANGES} value={preset} onChange={setPreset} />
          {preset === "Custom" && (
            <>
              <label className="inline-field">
                <span>From</span>
                <input type="date" value={custom.from} onChange={(event) => setCustom({ ...custom, from: event.target.value })} />
              </label>
              <label className="inline-field">
                <span>To</span>
                <input type="date" value={custom.to} onChange={(event) => setCustom({ ...custom, to: event.target.value })} />
              </label>
            </>
          )}
          <div className="toolbar-end total-block">
            <span>Reporting period</span>
            <strong>{describeRange(range)}</strong>
          </div>
        </div>
      </Panel>

      <div className="report-grid">
        {reports.map((report) => {
          const count = Math.max(0, report.rows().length - 1);
          return (
            <article key={report.title} className="report-card">
              <h3>{report.title}</h3>
              <p>{report.description}</p>
              <div className="report-foot">
                <span>{count} row{count === 1 ? "" : "s"}</span>
                <button
                  className="secondary-button"
                  disabled={count === 0}
                  onClick={() => {
                    downloadCsv(
                      `${report.title.toLowerCase().replaceAll(" ", "-")}-${range.from}-to-${range.to}.csv`,
                      report.rows(),
                    );
                    toast("success", `${report.title} exported for ${describeRange(range)}.`);
                  }}
                >
                  {count === 0 ? "Nothing in period" : "Download CSV"}
                </button>
              </div>
            </article>
          );
        })}
      </div>

      <Panel title="Activity in this period" description={describeRange(range)} padded={false}>
        {activity.length === 0 ? (
          <EmptyState title="No activity in this period" text="Choose a wider reporting period to see recorded actions." />
        ) : (
          <DataTable columns={["When", "Action", "Record", "Reference", "Actor"]}>
            {activity.slice(0, 25).map((entry) => (
              <tr key={entry.id}>
                <td>{formatDateTime(entry.createdAt)}</td>
                <td>
                  <strong>{entry.action}</strong>
                  {entry.detail && <small>{entry.detail}</small>}
                </td>
                <td>{entry.recordType}</td>
                <td>{entry.recordRef}</td>
                <td>{entry.actor}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>
    </div>
  );
}
/* ---------------------------------------------------------------- settings */

export function SettingsModule() {
  const { state, updateSettings, resetSystem } = useSystem();
  const toast = useToast();
  const settings = state.settings;

  const checklist = [
    { key: "privacyNoticePublished" as const, label: "Privacy notice published", detail: "Required before collecting personal data on the public site." },
    { key: "termsPublished" as const, label: "Terms and conditions published", detail: "Shown on the registration consent step." },
    { key: "sendingDomainVerified" as const, label: "Email sending domain verified", detail: "Needed for receipts, instructions, and notifications." },
    { key: "receivingAccountsConfigured" as const, label: "Receiving accounts configured", detail: "Cash, GCash, and bank accounts used by the cashier." },
    { key: "payrollConfigured" as const, label: "Payroll settings configured", detail: "Components, periods, and pay dates." },
    { key: "certificateTemplateApproved" as const, label: "Certificate template approved", detail: "Blocks all certificate printing until approved." },
  ];

  const complete = checklist.filter((item) => settings[item.key]).length;
  const readiness = Math.round((complete / checklist.length) * 100);

  return (
    <div className="page">
      <PageHeader
        eyebrow="System administration"
        title="Settings & launch control"
        description="Organization details, legal content, and the feature flags that gate production behavior."
      />

      <div className="two-column">
        <Panel title="Launch readiness" description={`${complete} of ${checklist.length} required items complete`}>
          <div className="readiness">
            <div className="readiness-ring" style={{ ["--percent" as string]: `${readiness}%` }}>
              <strong>{readiness}%</strong>
            </div>
            <ul className="checklist">
              {checklist.map((item) => (
                <li key={item.key}>
                  <label>
                    <input
                      type="checkbox"
                      checked={settings[item.key]}
                      onChange={(event) => {
                        updateSettings({ [item.key]: event.target.checked });
                        toast(event.target.checked ? "success" : "warning", `${item.label} ${event.target.checked ? "marked complete" : "reopened"}.`);
                      }}
                    />
                    <span>
                      <strong>{item.label}</strong>
                      <small>{item.detail}</small>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        </Panel>

        <Panel title="Feature flags" description="Controls that change what staff can do in production">
          <div className="flag-row">
            <div>
              <strong>Certificate issuance</strong>
              <small>
                {settings.certificateTemplateApproved
                  ? "An approved template exists, so issuance can be switched on."
                  : "Approve a certificate template first — issuance stays locked without one."}
              </small>
            </div>
            <button
              className={settings.certificateIssuanceEnabled ? "toggle toggle-on" : "toggle"}
              disabled={!settings.certificateTemplateApproved}
              onClick={() => {
                updateSettings({ certificateIssuanceEnabled: !settings.certificateIssuanceEnabled });
                toast("info", `Certificate issuance ${settings.certificateIssuanceEnabled ? "disabled" : "enabled"}.`);
              }}
            >
              <span />
            </button>
          </div>
          <div className="flag-row">
            <div>
              <strong>Online registration</strong>
              <small>When off, the public registration form stops accepting new submissions.</small>
            </div>
            <button
              className={settings.onlineRegistrationOpen ? "toggle toggle-on" : "toggle"}
              onClick={() => {
                updateSettings({ onlineRegistrationOpen: !settings.onlineRegistrationOpen });
                toast("info", `Online registration ${settings.onlineRegistrationOpen ? "closed" : "opened"}.`);
              }}
            >
              <span />
            </button>
          </div>
        </Panel>
      </div>

      <Panel title="Organization information" description="Shown on the public website, receipts, and generated documents">
        <div className="form-grid">
          <Field label="Organization name" full>
            <input value={settings.organizationName} onChange={(event) => updateSettings({ organizationName: event.target.value })} />
          </Field>
          <Field label="Address" full>
            <input value={settings.address} onChange={(event) => updateSettings({ address: event.target.value })} />
          </Field>
          <Field label="Mobile">
            <input value={settings.mobile} onChange={(event) => updateSettings({ mobile: event.target.value })} />
          </Field>
          <Field label="Telephone">
            <input value={settings.telephone} onChange={(event) => updateSettings({ telephone: event.target.value })} />
          </Field>
          <Field label="Email" full>
            <input value={settings.email} onChange={(event) => updateSettings({ email: event.target.value })} />
          </Field>
        </div>
      </Panel>

      <Panel title="Demo data" description="This build keeps records in your browser so the whole workflow is explorable end to end.">
        <div className="inline-note note-amber">
          <strong>Reset the workspace</strong>
          <p>
            Restores the seeded trainees, batches, payments, and certificates, and clears everything you created in this
            browser. Connect Supabase credentials in <code>.env.local</code> to switch the public routes to the live database.
          </p>
        </div>
        <button
          className="danger-button"
          onClick={() => {
            if (!window.confirm("Reset all demo records in this browser?")) return;
            resetSystem();
            toast("warning", "Workspace reset to the seeded demo data.");
          }}
        >
          Reset demo data
        </button>
      </Panel>
    </div>
  );
}
