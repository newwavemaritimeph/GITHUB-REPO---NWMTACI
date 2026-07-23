"use client";

import { useMemo, useState } from "react";
import { DataTable, EmptyState, Modal, Pill, SearchInput, Segmented, StatCard, useToast } from "@/components/ui/kit";
import { completionRequirementOf, formatDate, formatDateTime, fullName, useSystem } from "@/lib/system/store";
import type { EnrollmentView } from "@/lib/system/types";
import { PageHeader, Panel, type Module } from "./shared";

const filters = ["Ready", "Pending", "Printed", "Released", "All"] as const;

/**
 * New Wave's own courses only print once the trainee has completed the feedback
 * form or uploaded the required screenshot. Endorsed partner courses skip this.
 */
function CompletionCell({
  item,
  onRecord,
}: {
  item: EnrollmentView;
  onRecord: (input: { feedbackForm?: boolean; proofFileName?: string }) => void;
}) {
  const requirement = completionRequirementOf(item.enrollment);
  if (!requirement.isNewWaveCourse) return <span className="muted-text">Not required</span>;

  const done = requirement.feedbackFormCompleted || requirement.completionProofUploaded;
  if (done) {
    return (
      <>
        <Pill tone="green">Complete</Pill>
        <small>
          {requirement.feedbackFormCompleted ? "Feedback form" : item.enrollment.completionProofFileName ?? "Proof uploaded"}
        </small>
      </>
    );
  }
  return (
    <>
      <Pill tone="amber">Waiting</Pill>
      <div className="cell-actions">
        <button className="ghost-button" onClick={() => onRecord({ feedbackForm: true })}>
          Feedback done
        </button>
        <label className="ghost-button upload-button">
          Upload proof
          <input
            type="file"
            accept="image/*,application/pdf"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onRecord({ proofFileName: file.name });
              event.target.value = "";
            }}
          />
        </label>
      </div>
    </>
  );
}

export function CertificatesModule({ go }: { go: (module: Module) => void }) {
  const { state, views, printCertificate, releaseCertificate, updateSettings, recordCompletionStep } = useSystem();
  const toast = useToast();
  const [filter, setFilter] = useState<(typeof filters)[number]>("Ready");
  const [query, setQuery] = useState("");
  const [releaseFor, setReleaseFor] = useState<EnrollmentView | null>(null);
  const [recipient, setRecipient] = useState("");
  const [recipientType, setRecipientType] = useState("Trainee (valid ID presented)");

  const issuanceOn = state.settings.certificateTemplateApproved && state.settings.certificateIssuanceEnabled;
  const all = views().filter((item) => item.enrollment.status !== "Cancelled");

  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();
    return all.filter((item) => {
      const status = item.certificate?.status ?? "Pending Attendance";
      const matchesFilter =
        filter === "All" ||
        (filter === "Ready" && status === "Ready to Print") ||
        (filter === "Pending" && status === "Pending Attendance") ||
        (filter === "Printed" && status === "Printed") ||
        (filter === "Released" && status === "Released");
      const haystack = `${fullName(item.trainee)} ${item.enrollment.reference} ${item.enrollment.courseName} ${item.certificate?.certificateNumber ?? ""}`.toLowerCase();
      return matchesFilter && (!term || haystack.includes(term));
    });
  }, [all, filter, query]);

  const counts = {
    pending: all.filter((item) => (item.certificate?.status ?? "Pending Attendance") === "Pending Attendance").length,
    ready: all.filter((item) => item.certificate?.status === "Ready to Print").length,
    printed: all.filter((item) => item.certificate?.status === "Printed").length,
    released: all.filter((item) => item.certificate?.status === "Released").length,
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="Completion records"
        title="Certificate management"
        description="Eligibility is computed from verified attendance. Numbering, printing, and release are controlled and audited."
        actions={
          issuanceOn ? (
            <Pill tone="green">Issuance enabled</Pill>
          ) : (
            <button
              className="primary-button"
              onClick={() => {
                updateSettings({ certificateTemplateApproved: true, certificateIssuanceEnabled: true });
                toast("success", "Certificate template approved. Issuance is now enabled.");
              }}
            >
              Approve template & enable issuance
            </button>
          )
        }
      />

      {!issuanceOn && (
        <div className="callout-lock">
          <span aria-hidden="true">◈</span>
          <div>
            <strong>Certificate issuance is safely disabled</strong>
            <p>
              Eligibility, numbering, and release history all run, but printing stays blocked until an official New Wave
              template is approved. Approve it above, or manage it from{" "}
              <button className="link-button" onClick={() => go("Settings")}>
                Settings → Launch control
              </button>
              .
            </p>
          </div>
          <Pill tone="amber">Feature flag off</Pill>
        </div>
      )}

      <div className="stat-grid stat-grid-4">
        <StatCard label="Pending attendance" value={String(counts.pending)} note="Not yet eligible" tone={1} icon="□" onClick={() => setFilter("Pending")} />
        <StatCard label="Ready to print" value={String(counts.ready)} note={issuanceOn ? "Numbering available" : "Template required"} tone={3} icon="◈" onClick={() => setFilter("Ready")} />
        <StatCard label="Printed" value={String(counts.printed)} note="Awaiting release" tone={0} icon="▤" onClick={() => setFilter("Printed")} />
        <StatCard label="Released" value={String(counts.released)} note="Release events recorded" tone={2} icon="✓" onClick={() => setFilter("Released")} />
      </div>

      <Panel padded={false}>
        <div className="toolbar">
          <SearchInput value={query} onChange={setQuery} placeholder="Search trainee, enrollment, or certificate number" />
          <Segmented options={filters} value={filter} onChange={setFilter} />
        </div>
        {rows.length === 0 ? (
          <EmptyState
            title="No certificates in this view"
            text="A certificate becomes ready once every attendance session of the batch is verified and the template is approved."
          />
        ) : (
          <DataTable
            columns={["Trainee", "Course & batch", "Attendance", "Completion step", "Certificate number", "Status", ""]}
            minWidth={1180}
          >
            {rows.map((item) => {
              const status = item.certificate?.status ?? "Pending Attendance";
              const recorded = item.attendance.filter((entry) => entry.record).length;
              return (
                <tr key={item.enrollment.id}>
                  <td>
                    <strong>{fullName(item.trainee)}</strong>
                    <small>{item.trainee.traineeNumber}</small>
                  </td>
                  <td>
                    <strong>{item.enrollment.courseName}</strong>
                    <small>{item.batch?.batchNumber ?? "—"}</small>
                  </td>
                  <td>
                    {recorded}/{item.attendance.length} recorded
                    <small>{item.attendanceComplete ? "Complete" : (item.certificate?.blockedReason ?? "In progress")}</small>
                  </td>
                  <td>
                    <CompletionCell
                      item={item}
                      onRecord={(input) => {
                        recordCompletionStep({ enrollmentId: item.enrollment.id, ...input });
                        toast("success", input.feedbackForm ? "Feedback form marked complete." : "Completion proof recorded.");
                      }}
                    />
                  </td>
                  <td>
                    <strong>{item.certificate?.certificateNumber ?? "Not assigned"}</strong>
                    <small>
                      {item.certificate?.releasedAt
                        ? `Released ${formatDate(item.certificate.releasedAt)}`
                        : item.certificate?.printedAt
                          ? `Printed ${formatDate(item.certificate.printedAt)}`
                          : "—"}
                    </small>
                  </td>
                  <td>
                    <Pill
                      tone={
                        status === "Released"
                          ? "green"
                          : status === "Printed"
                            ? "blue"
                            : status === "Ready to Print"
                              ? "violet"
                              : "amber"
                      }
                    >
                      {status}
                    </Pill>
                  </td>
                  <td className="cell-actions">
                    {status === "Ready to Print" && (
                      <button
                        className="ghost-button"
                        disabled={!issuanceOn}
                        onClick={() => {
                          printCertificate(item.enrollment.id);
                          toast("success", "Certificate number allocated and marked as printed.");
                        }}
                      >
                        Print
                      </button>
                    )}
                    {status === "Printed" && (
                      <>
                        <button
                          className="ghost-button"
                          onClick={() => {
                            setReleaseFor(item);
                            setRecipient(fullName(item.trainee));
                          }}
                        >
                          Release
                        </button>
                        <button
                          className="ghost-button"
                          onClick={() => {
                            printCertificate(item.enrollment.id);
                            toast("info", "Reprint recorded in the certificate history.");
                          }}
                        >
                          Reprint
                        </button>
                      </>
                    )}
                    {status === "Released" && <span className="muted-text">{formatDateTime(item.certificate?.releasedAt)}</span>}
                    {status === "Pending Attendance" && <span className="muted-text">Not eligible</span>}
                  </td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </Panel>

      <Modal
        open={Boolean(releaseFor)}
        title="Release certificate"
        description={releaseFor ? `${releaseFor.certificate?.certificateNumber} · ${fullName(releaseFor.trainee)}` : ""}
        onClose={() => setReleaseFor(null)}
        footer={
          <>
            <button className="secondary-button" onClick={() => setReleaseFor(null)}>
              Cancel
            </button>
            <button
              className="primary-button"
              disabled={recipient.trim().length < 3}
              onClick={() => {
                if (!releaseFor) return;
                releaseCertificate(releaseFor.enrollment.id, `${recipient.trim()} — ${recipientType}`);
                toast("success", "Release event recorded.");
                setReleaseFor(null);
              }}
            >
              Record release
            </button>
          </>
        }
      >
        <div className="form-grid">
          <label className="field field-full">
            <span className="field-label">Received by</span>
            <input value={recipient} onChange={(event) => setRecipient(event.target.value)} />
          </label>
          <label className="field field-full">
            <span className="field-label">Identification presented</span>
            <select value={recipientType} onChange={(event) => setRecipientType(event.target.value)}>
              <option>Trainee (valid ID presented)</option>
              <option>Authorized representative (authorization letter)</option>
              <option>Manning agency representative</option>
            </select>
          </label>
          <div className="form-full inline-note note-blue">
            <strong>Release is permanent</strong>
            <p>The recipient, identification type, and server timestamp are written to the certificate release history.</p>
          </div>
        </div>
      </Modal>
    </div>
  );
}
