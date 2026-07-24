"use client";

import { useMemo, useState } from "react";
import { DataTable, Drawer, EmptyState, Pill, SearchInput, Segmented, StatCard, useToast } from "@/components/ui/kit";
import { formatDateTime, fullName, useSystem } from "@/lib/system/store";
import type { RegistrationSubmission, SelectionStatus } from "@/lib/system/types";
import { pesos } from "@/lib/endorsement-catalog";
import { PageHeader, Panel, type Module } from "./shared";

const filters = ["All", "Needs action", "Approved", "Rejected"] as const;

const submissionTone = (status: RegistrationSubmission["status"]) =>
  status === "Approved"
    ? "green"
    : status === "Rejected"
      ? "red"
      : status === "Possible Duplicate"
        ? "violet"
        : status === "Partially Approved"
          ? "blue"
          : "amber";

const selectionTone = (status: SelectionStatus) =>
  status === "Approved" ? "green" : status === "Rejected" || status === "Cancelled" ? "red" : status === "Change Requested" ? "violet" : "amber";

export function RegistrationsModule({ go }: { go: (module: Module) => void }) {
  const { state, submissionSelections, reviewSelection, approveSelection, updateSubmissionStatus, seats } = useSystem();
  const toast = useToast();
  const [filter, setFilter] = useState<(typeof filters)[number]>("All");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const needsAction = (status: RegistrationSubmission["status"]) =>
    ["Submitted", "Under Review", "Possible Duplicate", "Partially Approved"].includes(status);

  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();
    return state.submissions
      .filter((submission) => {
        const matchesFilter =
          filter === "All" ||
          (filter === "Needs action" && needsAction(submission.status)) ||
          (filter === "Approved" && submission.status === "Approved") ||
          (filter === "Rejected" && submission.status === "Rejected");
        const haystack = `${submission.reference} ${fullName(submission.applicant)} ${submission.applicant.email}`.toLowerCase();
        return matchesFilter && (!term || haystack.includes(term));
      })
      .sort((left, right) => right.submittedAt.localeCompare(left.submittedAt));
  }, [filter, query, state.submissions]);

  const pending = state.submissions.filter((item) => needsAction(item.status)).length;
  const duplicates = state.submissions.filter((item) => item.status === "Possible Duplicate").length;
  const today = new Date().toISOString().slice(0, 10);
  const approvedToday = state.courseSelections.filter(
    (item) => item.status === "Approved" && item.decidedAt?.slice(0, 10) === today,
  ).length;

  const active = openId ? state.submissions.find((item) => item.id === openId) : undefined;
  const activeSelections = active ? submissionSelections(active.id) : [];

  return (
    <div className="page">
      <PageHeader
        eyebrow="Registration operations"
        title="Online registrations"
        description="Each public submission may hold up to five course selections. Approve, hold, or return each course on its own."
      />

      <div className="stat-grid stat-grid-4">
        <StatCard label="Awaiting review" value={String(pending)} note="Submissions from the website" tone={1} icon="!" />
        <StatCard label="Possible duplicates" value={String(duplicates)} note="Matched an existing trainee" tone={5} icon="◎" />
        <StatCard label="Courses approved today" value={String(approvedToday)} note="Converted to enrollments" tone={2} icon="✓" />
        <StatCard label="Total submissions" value={String(state.submissions.length)} note="All time" tone={0} icon="▤" />
      </div>

      <Panel padded={false}>
        <div className="toolbar">
          <SearchInput value={query} onChange={setQuery} placeholder="Search reference, name, or email" />
          <Segmented options={filters} value={filter} onChange={setFilter} />
        </div>
        {rows.length === 0 ? (
          <EmptyState
            title="No submissions match"
            text="Adjust the filter or search term, or submit an enrollment form from the public website to see it appear here instantly."
          />
        ) : (
          <DataTable columns={["Reference", "Applicant", "Courses", "Submitted", "Status", ""]}>
            {rows.map((submission) => {
              const selections = submissionSelections(submission.id);
              const approved = selections.filter((item) => item.status === "Approved").length;
              return (
                <tr key={submission.id} className="row-clickable" onClick={() => setOpenId(submission.id)}>
                  <td>
                    <strong>{submission.reference}</strong>
                  </td>
                  <td>
                    <strong>{fullName(submission.applicant)}</strong>
                    <small>{submission.applicant.email}</small>
                  </td>
                  <td>
                    <strong>
                      {approved}/{selections.length} approved
                    </strong>
                    <small>{selections.map((item) => item.courseCode).join(", ")}</small>
                  </td>
                  <td>{formatDateTime(submission.submittedAt)}</td>
                  <td>
                    <Pill tone={submissionTone(submission.status)}>{submission.status}</Pill>
                  </td>
                  <td className="cell-actions">
                    <button className="ghost-button">Review</button>
                  </td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </Panel>

      <Drawer
        open={Boolean(active)}
        title={active ? fullName(active.applicant) : ""}
        subtitle={active?.reference}
        onClose={() => setOpenId(null)}
      >
        {active && (
          <>
            <dl className="detail-list">
              <div>
                <dt>Email</dt>
                <dd>{active.applicant.email}</dd>
              </div>
              <div>
                <dt>Mobile</dt>
                <dd>{active.applicant.mobile}</dd>
              </div>
              <div>
                <dt>Birth date</dt>
                <dd>{active.applicant.birthDate}</dd>
              </div>
              <div>
                <dt>SRN</dt>
                <dd>{active.applicant.srn ?? "Not provided"}</dd>
              </div>
              <div>
                <dt>Rank / Company</dt>
                <dd>
                  {active.applicant.rank ?? "—"}
                  {active.applicant.company ? ` · ${active.applicant.company}` : ""}
                </dd>
              </div>
              <div>
                <dt>Submitted</dt>
                <dd>{formatDateTime(active.submittedAt)}</dd>
              </div>
            </dl>

            {active.status === "Possible Duplicate" && (
              <div className="inline-note note-violet">
                <strong>Possible duplicate</strong>
                <p>{active.remarks ?? "This applicant matches an existing trainee record."}</p>
                <p>Approving a course links its enrollment to the existing trainee instead of creating a second record.</p>
              </div>
            )}

            <h3 className="drawer-section">Course selections</h3>
            <div className="history-list">
              {activeSelections.map((selection) => {
                const batch = state.batches.find((item) => item.id === selection.batchId);
                const seat = seats(selection.batchId);
                const decided = selection.status === "Approved" || selection.status === "Rejected" || selection.status === "Cancelled";
                return (
                  <div key={selection.id} className="selection-card">
                    <div className="selection-head">
                      <div>
                        <strong>
                          {selection.sequence}. {selection.courseName}
                        </strong>
                        <small>
                          {selection.courseCode} · {batch?.batchNumber ?? "—"} · {seat.available} of {seat.capacity} slots
                        </small>
                      </div>
                      <Pill tone={selectionTone(selection.status)}>{selection.status}</Pill>
                    </div>
                    {selection.createdEnrollmentId && (
                      <small className="muted-text">
                        Enrollment {state.enrollments.find((item) => item.id === selection.createdEnrollmentId)?.reference}
                      </small>
                    )}
                    {!decided && (
                      <div className="cell-actions">
                        <button
                          className="ghost-button"
                          disabled={seat.available === 0}
                          onClick={() => {
                            const enrollment = approveSelection(selection.id);
                            if (enrollment) toast("success", `${enrollment.reference} created.`);
                            else toast("warning", "That course could not be approved.");
                          }}
                        >
                          Approve
                        </button>
                        <button
                          className="ghost-button"
                          onClick={() => {
                            reviewSelection(selection.id, "Change Requested", "A different schedule is required.");
                            toast("info", "Returned for a schedule change.");
                          }}
                        >
                          Request change
                        </button>
                        <button
                          className="ghost-button ghost-danger"
                          onClick={() => {
                            reviewSelection(selection.id, "Rejected", "Did not meet the requirements.");
                            toast("warning", "Course selection rejected.");
                          }}
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <h3 className="drawer-section">Consolidated fee</h3>
            <p className="muted-text">
              {pesos(
                activeSelections
                  .filter((item) => item.status !== "Rejected" && item.status !== "Cancelled")
                  .reduce((sum, item) => sum + (state.batches.find((batch) => batch.id === item.batchId)?.feeCentavos ?? 0), 0),
              )}{" "}
              across {activeSelections.filter((item) => item.status !== "Rejected" && item.status !== "Cancelled").length} course(s).
            </p>

            <div className="drawer-actions">
              <button className="secondary-button" onClick={() => go("Enrollments")}>
                Open enrollments
              </button>
              <button
                className="danger-button"
                onClick={() => {
                  updateSubmissionStatus(active.id, "Rejected", "Submission rejected.");
                  toast("warning", "Whole submission rejected.");
                  setOpenId(null);
                }}
              >
                Reject submission
              </button>
            </div>
          </>
        )}
      </Drawer>
    </div>
  );
}
