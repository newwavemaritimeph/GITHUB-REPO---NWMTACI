"use client";

import { useMemo, useState } from "react";
import { DataTable, Drawer, EmptyState, Pill, SearchInput, Segmented, StatCard, useToast } from "@/components/ui/kit";
import { formatDateTime, fullName, useSystem } from "@/lib/system/store";
import type { Registration } from "@/lib/system/types";
import { PageHeader, Panel, type Module } from "./shared";

const filters = ["All", "Needs action", "Approved", "Rejected"] as const;

export function RegistrationsModule({ go }: { go: (module: Module) => void }) {
  const { state, approveRegistration, updateRegistrationStatus, seats } = useSystem();
  const toast = useToast();
  const [filter, setFilter] = useState<(typeof filters)[number]>("All");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Registration | null>(null);
  const [remarks, setRemarks] = useState("");

  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();
    return state.registrations.filter((registration) => {
      const matchesFilter =
        filter === "All" ||
        (filter === "Needs action" && ["Submitted", "Under Review", "Possible Duplicate"].includes(registration.status)) ||
        (filter === "Approved" && registration.status === "Approved") ||
        (filter === "Rejected" && registration.status === "Rejected");
      const haystack = `${registration.reference} ${fullName(registration)} ${registration.email} ${registration.courseName}`.toLowerCase();
      return matchesFilter && (!term || haystack.includes(term));
    });
  }, [filter, query, state.registrations]);

  const pending = state.registrations.filter((item) =>
    ["Submitted", "Under Review", "Possible Duplicate"].includes(item.status),
  ).length;
  const duplicates = state.registrations.filter((item) => item.status === "Possible Duplicate").length;
  const approvedToday = state.registrations.filter(
    (item) => item.status === "Approved" && item.decidedAt?.slice(0, 10) === new Date().toISOString().slice(0, 10),
  ).length;

  function approve(registration: Registration) {
    const enrollment = approveRegistration(registration.id);
    if (enrollment) {
      toast("success", `${enrollment.reference} created. The training fee is now billed.`);
      setSelected(null);
      go("Enrollments");
    } else {
      toast("danger", "That registration could not be approved.");
    }
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="Registration operations"
        title="Online registrations"
        description="Every submission from the public website lands here for review, duplicate checking, and enrollment creation."
      />

      <div className="stat-grid stat-grid-4">
        <StatCard label="Awaiting review" value={String(pending)} note="Submitted from the website" tone={1} icon="!" />
        <StatCard label="Possible duplicates" value={String(duplicates)} note="Matched an existing trainee" tone={5} icon="◎" />
        <StatCard label="Approved today" value={String(approvedToday)} note="Converted to enrollments" tone={2} icon="✓" />
        <StatCard label="Total registrations" value={String(state.registrations.length)} note="All time" tone={0} icon="▤" />
      </div>

      <Panel padded={false}>
        <div className="toolbar">
          <SearchInput value={query} onChange={setQuery} placeholder="Search reference, name, email, or course" />
          <Segmented options={filters} value={filter} onChange={setFilter} />
        </div>
        {rows.length === 0 ? (
          <EmptyState
            title="No registrations match"
            text="Adjust the filter or search term, or submit a registration from the public website to see it appear here instantly."
          />
        ) : (
          <DataTable columns={["Reference", "Applicant", "Course", "Preferred schedule", "Submitted", "Status", ""]}>
            {rows.map((registration) => {
              const batch = state.batches.find((item) => item.id === registration.batchId);
              const seat = seats(registration.batchId);
              return (
                <tr key={registration.id}>
                  <td>
                    <strong>{registration.reference}</strong>
                  </td>
                  <td>
                    <strong>{fullName(registration)}</strong>
                    <small>{registration.email}</small>
                  </td>
                  <td>
                    <strong>{registration.courseName}</strong>
                    <small>{registration.courseCode}</small>
                  </td>
                  <td>
                    {batch?.batchNumber ?? "—"}
                    <small>{seat.available} of {seat.capacity} slots open</small>
                  </td>
                  <td>{formatDateTime(registration.submittedAt)}</td>
                  <td>
                    <Pill
                      tone={
                        registration.status === "Approved"
                          ? "green"
                          : registration.status === "Rejected"
                            ? "red"
                            : registration.status === "Possible Duplicate"
                              ? "violet"
                              : "amber"
                      }
                    >
                      {registration.status}
                    </Pill>
                  </td>
                  <td className="cell-actions">
                    <button
                      className="ghost-button"
                      onClick={() => {
                        setSelected(registration);
                        setRemarks(registration.remarks ?? "");
                      }}
                    >
                      Review
                    </button>
                  </td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </Panel>

      <Drawer
        open={Boolean(selected)}
        title={selected ? fullName(selected) : ""}
        subtitle={selected?.reference}
        onClose={() => setSelected(null)}
      >
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
                <dt>Emergency contact</dt>
                <dd>
                  {selected.emergencyContactName ?? "—"}
                  {selected.emergencyContactMobile ? ` · ${selected.emergencyContactMobile}` : ""}
                </dd>
              </div>
              <div>
                <dt>Course</dt>
                <dd>{selected.courseName}</dd>
              </div>
              <div>
                <dt>Requested batch</dt>
                <dd>{state.batches.find((item) => item.id === selected.batchId)?.batchNumber ?? "—"}</dd>
              </div>
              <div>
                <dt>Submitted</dt>
                <dd>{formatDateTime(selected.submittedAt)}</dd>
              </div>
            </dl>

            {selected.status === "Possible Duplicate" && (
              <div className="inline-note note-violet">
                <strong>Possible duplicate</strong>
                <p>{selected.remarks ?? "This applicant matches an existing trainee record."}</p>
                <p>Approving links the enrollment to the existing trainee instead of creating a second record.</p>
              </div>
            )}

            <label className="field field-full">
              <span className="field-label">Reviewer remarks</span>
              <textarea rows={3} value={remarks} onChange={(event) => setRemarks(event.target.value)} placeholder="Optional note kept on the registration record" />
            </label>

            {selected.status === "Approved" ? (
              <div className="inline-note note-green">
                <strong>Enrollment created</strong>
                <p>
                  {state.enrollments.find((item) => item.id === selected.enrollmentId)?.reference ?? "Enrollment"} is now
                  tracked under Enrollments and Payments.
                </p>
              </div>
            ) : (
              <div className="drawer-actions">
                <button className="primary-button" onClick={() => approve(selected)}>
                  Approve and create enrollment
                </button>
                <button
                  className="secondary-button"
                  onClick={() => {
                    updateRegistrationStatus(selected.id, "Under Review", remarks);
                    toast("info", "Marked for review.");
                    setSelected(null);
                  }}
                >
                  Keep under review
                </button>
                <button
                  className="danger-button"
                  onClick={() => {
                    updateRegistrationStatus(selected.id, "Rejected", remarks || "Did not meet the requirements.");
                    toast("warning", "Registration rejected.");
                    setSelected(null);
                  }}
                >
                  Reject
                </button>
              </div>
            )}
          </>
        )}
      </Drawer>
    </div>
  );
}
