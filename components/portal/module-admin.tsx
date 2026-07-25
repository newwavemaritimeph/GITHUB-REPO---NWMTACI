"use client";

import { useMemo, useState } from "react";
import { Avatar, DataTable, EmptyState, Field, Modal, Pill, SearchInput, useToast } from "@/components/ui/kit";
import { pesos } from "@/lib/endorsement-catalog";
import { formatDateTime, fullName, useSystem } from "@/lib/system/store";
import type { Role } from "@/lib/system/types";
import { PageHeader, Panel, StageBadge } from "./shared";
import { CatalogModule } from "./module-others";

const PORTAL_ROLES: Role[] = ["Admin", "Registration", "Cashier", "Accounting", "Training Operations", "HR", "Instructor"];

/**
 * Search Trainee — Admin looks up one trainee at a time (typeahead), then sees
 * that trainee's enrollments and payment record. Deliberately shows no roster
 * until a search term is entered.
 */
export function SearchTraineeModule() {
  const { state, views } = useSystem();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const term = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (term.length < 2) return [];
    return state.trainees
      .filter((trainee) => `${fullName(trainee)} ${trainee.traineeNumber} ${trainee.email} ${trainee.mobile} ${trainee.srn ?? ""}`.toLowerCase().includes(term))
      .slice(0, 8);
  }, [term, state.trainees]);

  const trainee = selectedId ? state.trainees.find((item) => item.id === selectedId) : undefined;
  const enrollments = trainee ? views().filter((item) => item.trainee.id === trainee.id) : [];
  const payments = trainee
    ? state.ledger
        .filter((entry) => entry.type === "payment" && enrollments.some((e) => e.enrollment.id === entry.enrollmentId))
        .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))
    : [];

  return (
    <div className="page">
      <PageHeader eyebrow="Central records" title="Search trainee" description="Look up a trainee to see their enrollments and payment record." />

      <Panel padded={false}>
        <div className="toolbar">
          <SearchInput value={query} onChange={(value) => { setQuery(value); setSelectedId(null); }} placeholder="Search by name, trainee number, email, mobile, or SRN" />
        </div>
        {term.length < 2 ? (
          <EmptyState icon="⌕" title="Start typing to search" text="Enter at least two characters. The roster is not shown until you search." />
        ) : matches.length === 0 ? (
          <EmptyState icon="◎" title="No trainee found" text="No trainee matches that search." />
        ) : (
          <div className="pick-list">
            {matches.map((match) => (
              <button key={match.id} className="pick-row" onClick={() => setSelectedId(match.id)}>
                <div className="person-cell">
                  <Avatar name={fullName(match)} />
                  <div>
                    <strong>{fullName(match)}</strong>
                    <small>{match.traineeNumber} · {match.email} · {match.mobile}</small>
                  </div>
                </div>
                <span className="muted-text">Select →</span>
              </button>
            ))}
          </div>
        )}
      </Panel>

      {trainee && (
        <>
          <Panel title="Trainee" description={trainee.traineeNumber}>
            <div className="slip-grid">
              <div><span>Name</span><strong>{fullName(trainee)}{trainee.suffix ? ` ${trainee.suffix}` : ""}</strong></div>
              <div><span>SRN</span><strong>{trainee.srn ?? "—"}</strong></div>
              <div><span>Email</span><strong>{trainee.email}</strong></div>
              <div><span>Mobile</span><strong>{trainee.mobile}</strong></div>
            </div>
          </Panel>

          <Panel title="Enrollments" description="Courses, payment status, and balance" padded={false}>
            {enrollments.length === 0 ? (
              <EmptyState icon="▤" title="No enrollments" text="This trainee has no enrollment records." />
            ) : (
              <DataTable columns={["Enrollment", "Course", "Charged", "Paid", "Balance", "Payment", "Stage"]} minWidth={940}>
                {enrollments.map((item) => (
                  <tr key={item.enrollment.id}>
                    <td><strong>{item.enrollment.reference}</strong></td>
                    <td>{item.enrollment.courseName}</td>
                    <td>{pesos(item.dueCentavos)}</td>
                    <td>{pesos(item.paidCentavos)}</td>
                    <td><strong className={item.balanceCentavos > 0 ? "value-danger" : "value-good"}>{pesos(item.balanceCentavos)}</strong></td>
                    <td><Pill tone={item.paymentStatus === "Paid" ? "green" : item.paymentStatus === "Partially Paid" ? "amber" : "red"}>{item.paymentStatus}</Pill></td>
                    <td><StageBadge stage={item.stage} /></td>
                  </tr>
                ))}
              </DataTable>
            )}
          </Panel>

          <Panel title="Payment record" description="Posted payments across this trainee's enrollments" padded={false}>
            {payments.length === 0 ? (
              <EmptyState icon="₱" title="No payments" text="No payments have been posted for this trainee." />
            ) : (
              <DataTable columns={["Payment", "Method", "Reference", "Amount", "Verification", "Received"]} minWidth={860}>
                {payments.map((entry) => (
                  <tr key={entry.id}>
                    <td><strong>{entry.reference}</strong><small>{entry.receiptNumber ?? "No receipt"}</small></td>
                    <td>{entry.method ?? "—"}</td>
                    <td>{entry.referenceNumber ?? "—"}</td>
                    <td><strong>{pesos(entry.amountCentavos)}</strong></td>
                    <td><Pill tone={entry.verification === "Verified" ? "green" : entry.verification === "Rejected" ? "red" : "amber"}>{entry.verification}</Pill></td>
                    <td>{formatDateTime(entry.recordedAt)}</td>
                  </tr>
                ))}
              </DataTable>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}

type AccountDraft = { id: string; name: string; email: string; password: string; portalRole: Role };

/** Admin setup — user accounts (per employee) + courses & centers. */
export function SetupModule() {
  const { state, updateEmployee } = useSystem();
  const toast = useToast();
  const [tab, setTab] = useState<"User accounts" | "Courses & centers">("User accounts");
  const [draft, setDraft] = useState<AccountDraft | null>(null);

  return (
    <div className="page">
      <PageHeader eyebrow="System administration" title="Setup" description="Portal user accounts and the course / partner-center catalog." />
      <div className="hub-tabs">
        {(["User accounts", "Courses & centers"] as const).map((item) => (
          <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item}</button>
        ))}
      </div>

      {tab === "User accounts" && (
        <Panel padded={false}>
          <DataTable columns={["Employee", "Email", "Password", "Portal role", ""]} minWidth={900}>
            {state.employees.map((employee) => (
              <tr key={employee.id}>
                <td>
                  <div className="person-cell">
                    <Avatar name={employee.name} tone="orange" />
                    <div><strong>{employee.name}</strong><small>{employee.employeeNumber} · {employee.position}</small></div>
                  </div>
                </td>
                <td>{employee.email || "—"}</td>
                <td>{employee.password ? "••••••••" : <span className="muted-text">Not set</span>}</td>
                <td>{employee.portalRole ? <Pill tone="blue">{employee.portalRole}</Pill> : <span className="muted-text">No access</span>}</td>
                <td className="cell-actions">
                  <button className="ghost-button" onClick={() => setDraft({ id: employee.id, name: employee.name, email: employee.email, password: employee.password ?? "", portalRole: employee.portalRole ?? "Registration" })}>
                    Manage account
                  </button>
                </td>
              </tr>
            ))}
          </DataTable>
        </Panel>
      )}

      {tab === "Courses & centers" && <CatalogModule role="Admin" />}

      <Modal
        open={Boolean(draft)}
        title="Portal account"
        description={draft?.name}
        onClose={() => setDraft(null)}
        footer={
          <>
            <button className="secondary-button" onClick={() => setDraft(null)}>Cancel</button>
            <button
              className="primary-button"
              onClick={() => {
                if (!draft) return;
                updateEmployee(draft.id, { email: draft.email.trim(), password: draft.password, portalRole: draft.portalRole });
                toast("success", `Account for ${draft.name} saved.`);
                setDraft(null);
              }}
            >
              Save account
            </button>
          </>
        }
      >
        {draft && (
          <div className="form-grid">
            <Field label="Email" full><input value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} /></Field>
            <Field label="Password" hint="Simulated — the demo signs in via the role switcher."><input value={draft.password} onChange={(e) => setDraft({ ...draft, password: e.target.value })} /></Field>
            <Field label="Portal role / access">
              <select value={draft.portalRole} onChange={(e) => setDraft({ ...draft, portalRole: e.target.value as Role })}>
                {PORTAL_ROLES.map((role) => <option key={role}>{role}</option>)}
              </select>
            </Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
