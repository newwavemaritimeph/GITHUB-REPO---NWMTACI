"use client";

import { useMemo, useRef, useState } from "react";
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
import { PARTNER_CENTERS, pesos } from "@/lib/endorsement-catalog";
import { createExpenseVoucherPdf, createPayslipPdf } from "@/lib/documents";
import { downloadCsv, parseCsv } from "@/lib/csv";
import { formatDate, formatDateRange, formatDateTime, fullName, todayIso, useSystem } from "@/lib/system/store";
import {
  REPORT_RANGES,
  describeRange,
  resolveRange,
  withinRange,
  type DateRange,
  type ReportRangePreset,
} from "@/lib/reporting";
import type { CashAdvance, Employee, EnrollmentView, Expense, HrAttendanceRecord, LeaveRequest, Role, RequestType, Trainee } from "@/lib/system/types";
import { VALIDATION_MESSAGES, isEmail, isPhContactNumber, isSrn } from "@/lib/validation";
import { PageHeader, Panel, StageBadge, simplifiedStage, type Module } from "./shared";

/* ---------------------------------------------------------------- trainees */

function FacebookEncoder({ trainee, onSave }: { trainee: Trainee; onSave: (link: string) => void }) {
  const [value, setValue] = useState(trainee.facebookLink ?? "");
  return (
    <div className="fb-encoder">
      <div className="fb-encoder-row">
        <input value={value} onChange={(event) => setValue(event.target.value)} placeholder="https://facebook.com/username" />
        <button className="secondary-button" onClick={() => onSave(value)}>Save</button>
      </div>
      {trainee.facebookLink ? (
        <a className="fb-current" href={trainee.facebookLink} target="_blank" rel="noopener noreferrer">Open current profile ↗</a>
      ) : (
        <small className="muted-text">Not yet encoded. Registration Officer records the trainee&apos;s Facebook profile URL.</small>
      )}
    </div>
  );
}

const STAGE_FILTERS = ["All stages", "Pending", "In Training", "Training Complete", "Certificate Release"] as const;

/** Payment status of one enrollment, extended with Refunded (not in the base type). */
function paymentStatusOf(item: EnrollmentView): string {
  if (item.stage === "Cancelled") return "Cancelled";
  if (item.entries.some((entry) => entry.type === "refund" || entry.type === "reversal")) return "Refunded";
  return item.paymentStatus;
}

function statusTone(status: string): string {
  if (status === "Paid") return "green";
  if (status === "Partially Paid") return "amber";
  if (status === "Cancelled" || status === "Refunded") return "slate";
  return "red";
}

const normalizeName = (trainee: Trainee) =>
  `${trainee.firstName} ${trainee.middleName ?? ""} ${trainee.lastName}`.toLowerCase().replace(/\s+/g, " ").trim();

/** Groups of 2+ trainees sharing an exact SRN or an exact first+middle+last name. */
function duplicateGroups(trainees: Trainee[]): Trainee[][] {
  const push = (map: Map<string, Trainee[]>, key: string, trainee: Trainee) => {
    const list = map.get(key) ?? [];
    list.push(trainee);
    map.set(key, list);
  };
  const bySrn = new Map<string, Trainee[]>();
  const byName = new Map<string, Trainee[]>();
  trainees.forEach((trainee) => {
    const srn = (trainee.srn ?? "").replace(/\D/g, "");
    if (srn) push(bySrn, srn, trainee);
    push(byName, normalizeName(trainee), trainee);
  });
  const groups: Trainee[][] = [];
  const seen = new Set<string>();
  [bySrn, byName].forEach((map) =>
    map.forEach((list) => {
      if (list.length < 2) return;
      const key = list.map((trainee) => trainee.id).sort().join(",");
      if (seen.has(key)) return;
      seen.add(key);
      groups.push([...list].sort((a, z) => a.createdAt.localeCompare(z.createdAt)));
    }),
  );
  return groups;
}

export function TraineesModule({ role }: { go: (module: Module) => void; role: Role }) {
  const { state, views, createTrainee, setTraineeFacebook, mergeTrainees } = useSystem();
  const toast = useToast();
  const showAmounts = role !== "Registration";
  const [query, setQuery] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [statusFilter, setStatusFilter] = useState<(typeof STAGE_FILTERS)[number]>("All stages");
  const [view, setView] = useState<"All trainees" | "Possible duplicates">("All trainees");
  const [selected, setSelected] = useState<Trainee | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  // Mirrors the public registration form field for field, so a trainee created by
  // staff carries exactly the same record as one who registered online.
  const emptyDraft = {
    firstName: "", middleName: "", lastName: "", suffix: "", srn: "",
    email: "", address: "", mobile: "", placeOfBirth: "", birthDate: "",
    rank: "", company: "", emergencyContactName: "", emergencyContactMobile: "",
    facebookLink: "",
  };
  const [draft, setDraft] = useState(emptyDraft);

  const all = views();
  const stagesByTrainee = useMemo(() => {
    const map = new Map<string, string[]>();
    all.forEach((item) => {
      const list = map.get(item.trainee.id) ?? [];
      list.push(simplifiedStage(item.stage));
      map.set(item.trainee.id, list);
    });
    return map;
  }, [all]);

  // Registration works from a clean desk: with no search term or filter it lists
  // only trainees enrolled (or registered) today. Typing in the search box, or
  // setting any filter, lifts the restriction so the whole roster is searchable.
  const today = todayIso();
  const enrolledTodayIds = useMemo(
    () => new Set(all.filter((item) => item.enrollment.createdAt.slice(0, 10) === today).map((item) => item.trainee.id)),
    [all, today],
  );

  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();
    const registrationToday = role === "Registration" && !term && !fromDate && !toDate && statusFilter === "All stages";
    return state.trainees.filter((trainee) => {
      const created = trainee.createdAt.slice(0, 10);
      if (registrationToday) return enrolledTodayIds.has(trainee.id) || created === today;
      const matchesTerm =
        !term || `${fullName(trainee)} ${trainee.traineeNumber} ${trainee.email} ${trainee.mobile}`.toLowerCase().includes(term);
      const matchesFrom = !fromDate || created >= fromDate;
      const matchesTo = !toDate || created <= toDate;
      const matchesStage = statusFilter === "All stages" || (stagesByTrainee.get(trainee.id) ?? []).includes(statusFilter);
      return matchesTerm && matchesFrom && matchesTo && matchesStage;
    });
  }, [query, fromDate, toDate, statusFilter, stagesByTrainee, state.trainees, role, enrolledTodayIds, today]);

  const groups = useMemo(() => duplicateGroups(state.trainees), [state.trainees]);
  const selectedViews = selected ? all.filter((item) => item.trainee.id === selected.id) : [];
  const duplicateCount = groups.reduce((sum, group) => sum + group.length - 1, 0);

  return (
    <div className="page">
      <PageHeader
        eyebrow="Central master records"
        title="Trainees"
        description={
          role === "Registration"
            ? "Trainees enrolled today. Use the search box to find any trainee on record."
            : "Duplicate-aware profiles with registration history, enrollments, balances, and certificates."
        }
        actions={
          <button className="primary-button" onClick={() => setNewOpen(true)}>
            + New trainee
          </button>
        }
      />

      <div className="stat-grid stat-grid-4">
        <StatCard label="Trainee records" value={String(state.trainees.length)} note="All programs" tone={0} icon="◎" />
        <StatCard label="With active enrollment" value={String(new Set(all.filter((item) => item.stage !== "Cancelled").map((item) => item.trainee.id)).size)} note="Currently in the pipeline" tone={3} icon="▤" />
        <StatCard label="Possible duplicates" value={String(duplicateCount)} note="Same SRN or full name" tone={1} icon="!" onClick={() => setView("Possible duplicates")} />
        <StatCard label="Certificates released" value={String(all.filter((item) => item.certificate?.status === "Released").length)} note="Completion records" tone={2} icon="✓" />
      </div>

      <Panel padded={false}>
        <div className="toolbar toolbar-wrap">
          <Segmented options={["All trainees", "Possible duplicates"] as const} value={view} onChange={setView} />
          {view === "All trainees" && (
            <>
              <SearchInput value={query} onChange={setQuery} placeholder="Search name, number, email, or mobile" />
              <label className="inline-field">
                <span>From</span>
                <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
              </label>
              <label className="inline-field">
                <span>To</span>
                <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
              </label>
              <label className="inline-field">
                <span>Stage</span>
                <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as (typeof STAGE_FILTERS)[number])}>
                  {STAGE_FILTERS.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
              {(fromDate || toDate || statusFilter !== "All stages" || query) && (
                <button className="link-button toolbar-end" onClick={() => { setFromDate(""); setToDate(""); setStatusFilter("All stages"); setQuery(""); }}>
                  Clear filters
                </button>
              )}
            </>
          )}
        </div>

        {view === "Possible duplicates" ? (
          groups.length === 0 ? (
            <EmptyState icon="✓" title="No duplicates detected" text="No trainees share an SRN or an exact first, middle, and last name." />
          ) : (
            <div className="dup-list">
              {groups.map((group, index) => {
                const survivor = group[0];
                return (
                  <div key={index} className="dup-group">
                    <div className="dup-head">
                      <strong>{fullName(survivor)}</strong>
                      <small>{group.length} matching records · {survivor.srn ? `SRN ${survivor.srn}` : "same full name"}</small>
                    </div>
                    {group.map((trainee) => (
                      <div key={trainee.id} className="dup-row">
                        <div>
                          <strong>{trainee.traineeNumber}{trainee.id === survivor.id ? " · keep (oldest)" : ""}</strong>
                          <small>{trainee.email} · {trainee.mobile} · created {formatDate(trainee.createdAt)}</small>
                        </div>
                        {trainee.id !== survivor.id && (
                          <button
                            className="ghost-button ghost-danger"
                            onClick={() => {
                              mergeTrainees(survivor.id, trainee.id);
                              toast("success", `${trainee.traineeNumber} merged into ${survivor.traineeNumber}.`);
                            }}
                          >
                            Merge &amp; delete
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )
        ) : rows.length === 0 ? (
          <EmptyState
            title={role === "Registration" && !query ? "No trainees enrolled today yet" : "No trainee matches"}
            text={role === "Registration" && !query ? "Search by name, number, email, or mobile to find any trainee on record." : "Adjust the search, date range, or status filter."}
          />
        ) : (
          <DataTable columns={["Trainee", "Contact", "Enrollments", showAmounts ? "Balance" : "Payment status", "Latest stage", ""]} minWidth={940}>
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
                    {showAmounts ? (
                      <strong className={balance > 0 ? "value-danger" : "value-good"}>{pesos(balance)}</strong>
                    ) : owned[0] ? (
                      <div className="status-stack">
                        {owned.slice(0, 3).map((item) => (
                          <Pill key={item.enrollment.id} tone={statusTone(paymentStatusOf(item))}>{paymentStatusOf(item)}</Pill>
                        ))}
                      </div>
                    ) : (
                      <span className="muted-text">—</span>
                    )}
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
            <h3 className="drawer-section">Facebook link</h3>
            <FacebookEncoder
              key={selected.id}
              trainee={selected}
              onSave={(link) => {
                setTraineeFacebook(selected.id, link);
                toast("success", link ? "Facebook link saved." : "Facebook link cleared.");
              }}
            />
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
                      {showAmounts ? (
                        <>
                          <StageBadge stage={item.stage} />
                          <small>{item.balanceCentavos > 0 ? `${pesos(item.balanceCentavos)} balance` : "Settled"}</small>
                        </>
                      ) : (
                        <Pill tone={statusTone(paymentStatusOf(item))}>{paymentStatusOf(item)}</Pill>
                      )}
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
                  facebookLink: draft.facebookLink || undefined,
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
          <Field label="Facebook link" full hint="Encoded by the Registration Officer — the trainee's Facebook profile URL">
            <input value={draft.facebookLink} onChange={(event) => setDraft({ ...draft, facebookLink: event.target.value })} placeholder="https://facebook.com/…" />
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

const COURSE_CATEGORIES = [
  "Accredited MARINA STCW",
  "MARINA Domestic",
  "Maritime In-House",
  "Catering (ILO / MLC 2006)",
];
const COURSE_MODALITIES = ["Face-to-face", "Blended", "Online", "To be confirmed"];

type CourseDraft = { id: string | null; code: string; course: string; category: string; duration: string; modality: string; price: string; instructionTemplate: string; certificateTemplate: string };
type OfferDraft = { id: string | null; center: string; course: string; duration: string; fee: string; rebate: string };

const pesosInput = (centavos: number) => (centavos / 100).toString();
const toCentavos = (value: string) => Math.round(Number(value) * 100);

export function CatalogModule({ role }: { role: Role }) {
  const {
    state,
    addCourse,
    updateCourse,
    setCourseActive,
    addPartnerOffer,
    updatePartnerOffer,
    setPartnerOfferActive,
  } = useSystem();
  const toast = useToast();
  const canEdit = role === "Admin";

  const [tab, setTab] = useState<"New Wave courses" | "Endorsed partner offers">("New Wave courses");
  const [query, setQuery] = useState("");
  const [center, setCenter] = useState("All centers");
  const [showArchived, setShowArchived] = useState(false);
  const [courseDraft, setCourseDraft] = useState<CourseDraft | null>(null);
  const [offerDraft, setOfferDraft] = useState<OfferDraft | null>(null);
  const [formError, setFormError] = useState("");

  const centers = useMemo(
    () => Array.from(new Set([...PARTNER_CENTERS, ...state.partnerOffers.map((offer) => offer.center)])),
    [state.partnerOffers],
  );

  const offers = useMemo(
    () =>
      state.partnerOffers.filter(
        (offer) =>
          (showArchived || offer.active) &&
          (center === "All centers" || offer.center === center) &&
          `${offer.course} ${offer.center}`.toLowerCase().includes(query.toLowerCase()),
      ),
    [state.partnerOffers, center, query, showArchived],
  );
  const courses = useMemo(
    () =>
      state.courses.filter(
        (course) =>
          (showArchived || course.active) &&
          `${course.code} ${course.course} ${course.category}`.toLowerCase().includes(query.toLowerCase()),
      ),
    [state.courses, query, showArchived],
  );
  const rebateTotal = offers.filter((offer) => offer.active).reduce((sum, offer) => sum + offer.rebateCentavos, 0);
  const summary = useMemo(
    () =>
      centers
        .map((name) => ({ center: name, offers: state.partnerOffers.filter((offer) => offer.center === name && offer.active).length }))
        .filter((item) => item.offers > 0),
    [centers, state.partnerOffers],
  );

  function saveCourse() {
    if (!courseDraft) return;
    const code = courseDraft.code.trim().toUpperCase();
    const name = courseDraft.course.trim();
    if (!code || !name || !courseDraft.duration.trim()) {
      setFormError("Course code, name, and duration are required.");
      return;
    }
    if (!(Number(courseDraft.price) >= 0)) {
      setFormError("Enter a valid fee (0 or more).");
      return;
    }
    const clash = state.courses.some((course) => course.code.toUpperCase() === code && course.id !== courseDraft.id);
    if (clash) {
      setFormError(`Course code "${code}" is already in use.`);
      return;
    }
    const payload = {
      code,
      course: name,
      category: courseDraft.category,
      duration: courseDraft.duration.trim(),
      modality: courseDraft.modality,
      priceCentavos: toCentavos(courseDraft.price),
      instructionTemplate: courseDraft.instructionTemplate.trim() || undefined,
      certificateTemplate: courseDraft.certificateTemplate.trim() || undefined,
    };
    if (courseDraft.id) {
      updateCourse(courseDraft.id, payload);
      toast("success", `${code} updated.`);
    } else {
      addCourse(payload);
      toast("success", `${code} added to the catalog.`);
    }
    setCourseDraft(null);
    setFormError("");
  }

  function saveOffer() {
    if (!offerDraft) return;
    const centerName = offerDraft.center.trim();
    const name = offerDraft.course.trim();
    if (!centerName || !name || !offerDraft.duration.trim()) {
      setFormError("Training center, course, and duration are required.");
      return;
    }
    if (!(Number(offerDraft.fee) >= 0) || !(Number(offerDraft.rebate) >= 0)) {
      setFormError("Enter valid fee and rebate amounts.");
      return;
    }
    if (Number(offerDraft.rebate) > Number(offerDraft.fee)) {
      setFormError("Rebate cannot exceed the training fee.");
      return;
    }
    const payload = {
      center: centerName,
      course: name,
      duration: offerDraft.duration.trim(),
      trainingFeeCentavos: toCentavos(offerDraft.fee),
      rebateCentavos: toCentavos(offerDraft.rebate),
    };
    if (offerDraft.id) {
      updatePartnerOffer(offerDraft.id, payload);
      toast("success", "Partner offer updated.");
    } else {
      addPartnerOffer(payload);
      toast("success", "Partner offer added.");
    }
    setOfferDraft(null);
    setFormError("");
  }

  const newCourse: CourseDraft = { id: null, code: "", course: "", category: COURSE_CATEGORIES[2], duration: "1 day", modality: COURSE_MODALITIES[0], price: "", instructionTemplate: "", certificateTemplate: "" };
  const newOffer: OfferDraft = { id: null, center: centers[0] ?? "", course: "", duration: "1 day", fee: "", rebate: "" };

  const courseColumns = canEdit
    ? ["Course", "Category", "Duration", "Delivery", "Fee", ""]
    : ["Course", "Category", "Duration", "Delivery", "Fee"];
  const offerColumns = canEdit
    ? ["Course", "Training center", "Duration", "Training fee", "New Wave rebate", "Partner payable", ""]
    : ["Course", "Training center", "Duration", "Training fee", "New Wave rebate", "Partner payable"];

  return (
    <div className="page">
      <PageHeader
        eyebrow="Internal commercial catalog"
        title="Courses & training centers"
        description={
          canEdit
            ? "Add, edit, and archive New Wave courses and endorsed partner offers — no developer needed. Fees, rebates, and payables are staff-only."
            : "New Wave course pricing plus endorsed partner offers. Fees, rebates, and payables are staff-only."
        }
      />

      <div className="partner-summary">
        {summary.map((item) => (
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
            <label className="inline-field">
              <span>Center</span>
              <select value={center} onChange={(event) => setCenter(event.target.value)}>
                <option>All centers</option>
                {centers.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
          )}
          <label className="inline-field inline-check">
            <input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />
            <span>Show archived</span>
          </label>
          {tab === "Endorsed partner offers" && (
            <div className="toolbar-end total-block">
              <span>Visible rebate total</span>
              <strong>{pesos(rebateTotal)}</strong>
            </div>
          )}
          {canEdit && (
            <button
              className="primary-button toolbar-end"
              onClick={() => {
                setFormError("");
                if (tab === "New Wave courses") setCourseDraft(newCourse);
                else setOfferDraft(newOffer);
              }}
            >
              {tab === "New Wave courses" ? "＋ Add course" : "＋ Add partner offer"}
            </button>
          )}
        </div>
        {tab === "New Wave courses" ? (
          <DataTable columns={courseColumns}>
            {courses.map((course) => (
              <tr key={course.id} className={course.active ? "" : "row-muted"}>
                <td>
                  <strong>{course.course}</strong>
                  <small>{course.code}{course.active ? "" : " · archived"}</small>
                </td>
                <td>{course.category}</td>
                <td>{course.duration}</td>
                <td>{course.modality}</td>
                <td>
                  <strong>{pesos(course.priceCentavos)}</strong>
                </td>
                {canEdit && (
                  <td className="row-actions">
                    <button
                      className="link-button"
                      onClick={() => {
                        setFormError("");
                        setCourseDraft({
                          id: course.id,
                          code: course.code,
                          course: course.course,
                          category: course.category,
                          duration: course.duration,
                          modality: course.modality,
                          price: pesosInput(course.priceCentavos),
                          instructionTemplate: course.instructionTemplate ?? "",
                          certificateTemplate: course.certificateTemplate ?? "",
                        });
                      }}
                    >
                      Edit
                    </button>
                    <button
                      className="link-button"
                      onClick={() => {
                        setCourseActive(course.id, !course.active);
                        toast("warning", `${course.code} ${course.active ? "archived" : "restored"}.`);
                      }}
                    >
                      {course.active ? "Archive" : "Restore"}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </DataTable>
        ) : (
          <DataTable columns={offerColumns} minWidth={1040}>
            {offers.map((offer) => (
              <tr key={offer.id} className={offer.active ? "" : "row-muted"}>
                <td>
                  <strong>{offer.course}</strong>
                  {!offer.active && <small>archived</small>}
                </td>
                <td>{offer.center}</td>
                <td>{offer.duration}</td>
                <td>
                  <strong>{pesos(offer.trainingFeeCentavos)}</strong>
                </td>
                <td>
                  <strong className="value-good">{pesos(offer.rebateCentavos)}</strong>
                </td>
                <td>{pesos(offer.trainingFeeCentavos - offer.rebateCentavos)}</td>
                {canEdit && (
                  <td className="row-actions">
                    <button
                      className="link-button"
                      onClick={() => {
                        setFormError("");
                        setOfferDraft({
                          id: offer.id,
                          center: offer.center,
                          course: offer.course,
                          duration: offer.duration,
                          fee: pesosInput(offer.trainingFeeCentavos),
                          rebate: pesosInput(offer.rebateCentavos),
                        });
                      }}
                    >
                      Edit
                    </button>
                    <button
                      className="link-button"
                      onClick={() => {
                        setPartnerOfferActive(offer.id, !offer.active);
                        toast("warning", `Offer ${offer.active ? "archived" : "restored"}.`);
                      }}
                    >
                      {offer.active ? "Archive" : "Restore"}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>
      <p className="footnote">
        Fees, rebates, and partner payables are snapshotted when an enrollment is created, so later catalog edits never alter
        historical accounting.
      </p>

      <Modal
        open={Boolean(courseDraft)}
        title={courseDraft?.id ? "Edit course" : "Add course"}
        description="New Wave in-house course. Changes apply to new schedules and the public catalog immediately."
        onClose={() => setCourseDraft(null)}
        wide
        footer={
          <>
            <button className="secondary-button" onClick={() => setCourseDraft(null)}>
              Cancel
            </button>
            <button className="primary-button" onClick={saveCourse}>
              {courseDraft?.id ? "Save changes" : "Add course"}
            </button>
          </>
        }
      >
        {courseDraft && (
          <div className="form-grid">
            <Field label="Course code*" hint="Unique, e.g. SATSDSD">
              <input value={courseDraft.code} onChange={(event) => setCourseDraft({ ...courseDraft, code: event.target.value.toUpperCase() })} />
            </Field>
            <Field label="Course name*" full>
              <input value={courseDraft.course} onChange={(event) => setCourseDraft({ ...courseDraft, course: event.target.value })} />
            </Field>
            <Field label="Category">
              <select value={courseDraft.category} onChange={(event) => setCourseDraft({ ...courseDraft, category: event.target.value })}>
                {COURSE_CATEGORIES.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </Field>
            <Field label="Duration*" hint="e.g. 1 day, 5.5 days">
              <input value={courseDraft.duration} onChange={(event) => setCourseDraft({ ...courseDraft, duration: event.target.value })} />
            </Field>
            <Field label="Delivery">
              <select value={courseDraft.modality} onChange={(event) => setCourseDraft({ ...courseDraft, modality: event.target.value })}>
                {COURSE_MODALITIES.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </Field>
            <Field label="Fee (₱)*">
              <input type="number" min={0} step="1" value={courseDraft.price} onChange={(event) => setCourseDraft({ ...courseDraft, price: event.target.value })} />
            </Field>
            <Field label="Instruction template" full hint="Sent to the trainee once enrolled and paid. Leave blank to use the generic instruction email.">
              <textarea
                rows={4}
                value={courseDraft.instructionTemplate}
                placeholder="e.g. Report to Room 301 at 8:00 AM. Bring a valid ID, your admission slip, and a black ballpen."
                onChange={(event) => setCourseDraft({ ...courseDraft, instructionTemplate: event.target.value })}
              />
            </Field>
            <Field label="Certificate template" full hint="Reference for the New Wave certificate layout used when this course issues a certificate. Leave blank if none yet.">
              <input
                value={courseDraft.certificateTemplate}
                placeholder="e.g. NWM-BT-CERT-A4"
                onChange={(event) => setCourseDraft({ ...courseDraft, certificateTemplate: event.target.value })}
              />
            </Field>
            {formError && <p className="form-error field-full">{formError}</p>}
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(offerDraft)}
        title={offerDraft?.id ? "Edit partner offer" : "Add partner offer"}
        description="Endorsed partner / manning-agency course with its rebate rule. Partner payable is the fee less the rebate."
        onClose={() => setOfferDraft(null)}
        wide
        footer={
          <>
            <button className="secondary-button" onClick={() => setOfferDraft(null)}>
              Cancel
            </button>
            <button className="primary-button" onClick={saveOffer}>
              {offerDraft?.id ? "Save changes" : "Add offer"}
            </button>
          </>
        }
      >
        {offerDraft && (
          <div className="form-grid">
            <Field label="Training center*" hint="Pick an existing center or type a new one">
              <input list="partner-centers" value={offerDraft.center} onChange={(event) => setOfferDraft({ ...offerDraft, center: event.target.value })} />
              <datalist id="partner-centers">
                {centers.map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
            </Field>
            <Field label="Course*" full>
              <input value={offerDraft.course} onChange={(event) => setOfferDraft({ ...offerDraft, course: event.target.value })} />
            </Field>
            <Field label="Duration*" hint="e.g. 5 days">
              <input value={offerDraft.duration} onChange={(event) => setOfferDraft({ ...offerDraft, duration: event.target.value })} />
            </Field>
            <Field label="Training fee (₱)*">
              <input type="number" min={0} step="1" value={offerDraft.fee} onChange={(event) => setOfferDraft({ ...offerDraft, fee: event.target.value })} />
            </Field>
            <Field label="New Wave rebate (₱)*">
              <input type="number" min={0} step="1" value={offerDraft.rebate} onChange={(event) => setOfferDraft({ ...offerDraft, rebate: event.target.value })} />
            </Field>
            <Field label="Partner payable">
              <input readOnly value={pesos(Math.max(0, toCentavos(offerDraft.fee || "0") - toCentavos(offerDraft.rebate || "0")))} />
            </Field>
            {formError && <p className="form-error field-full">{formError}</p>}
          </div>
        )}
      </Modal>
    </div>
  );
}

/* -------------------------------------------------------------- accounting */

type ChannelDraft = { id: string | null; name: string; requiresReference: boolean };
type ChargeDraft = { id: string | null; name: string; amount: string };
type CategoryDraft = { id: string | null; name: string };
type PayableDraft = { id: string | null; name: string; category: string; amount: string; dueDay: string; notes: string };
type AgencyDraft = { id: string | null; name: string };

/**
 * Per-offering rebate table for one marketing agency. Lists every active
 * in-house course (STCW + in-house) and every endorsed partner training with a
 * peso input; edits persist immediately so the modal needs no separate save
 * step. Endorsed trainings are keyed "endorsed:<offerId>" in the rebate map.
 */
function AgencyRebateEditor({ agencyId, onSet }: { agencyId: string; onSet: (id: string, key: string, centavos: number) => void }) {
  const { state } = useSystem();
  const [query, setQuery] = useState("");
  const agency = state.marketingAgencies.find((item) => item.id === agencyId);
  const term = query.trim().toLowerCase();

  // Unify in-house courses and endorsed partner trainings into one rebate list.
  const inHouse = state.courses
    .filter((course) => course.active)
    .map((course) => ({
      key: course.code,
      title: course.course,
      subtitle: `${course.code} · fee ${pesos(course.priceCentavos)}`,
      endorsed: false,
    }));
  const endorsed = state.partnerOffers
    .filter((offer) => offer.active)
    .map((offer) => ({
      key: `endorsed:${offer.id}`,
      title: offer.course,
      subtitle: `Endorsed · ${offer.center} · fee ${pesos(offer.trainingFeeCentavos)}`,
      endorsed: true,
    }));
  const items = [...inHouse, ...endorsed]
    .filter((item) => `${item.title} ${item.subtitle}`.toLowerCase().includes(term))
    .sort((left, right) => left.title.localeCompare(right.title));

  if (!agency) return null;
  const priced = Object.keys(agency.rebates).length;

  return (
    <div className="form-full agency-rebate-editor">
      <div className="toolbar">
        <SearchInput value={query} onChange={setQuery} placeholder="Search in-house course or endorsed training" />
        <span className="muted-text">{priced} of {inHouse.length + endorsed.length} offerings priced</span>
      </div>
      <div className="agency-rebate-list">
        {items.map((item) => {
          const centavos = agency.rebates[item.key] ?? 0;
          return (
            <label key={item.key} className="agency-rebate-row">
              <span>
                <strong>{item.title}{item.endorsed ? " " : ""}{item.endorsed && <Pill tone="violet">Endorsed</Pill>}</strong>
                <small>{item.subtitle}</small>
              </span>
              <span className="agency-rebate-input">
                <em>₱</em>
                <input
                  type="number"
                  min={0}
                  step="1"
                  defaultValue={centavos ? (centavos / 100).toString() : ""}
                  placeholder="0"
                  onBlur={(event) => {
                    const value = event.target.value.trim();
                    const next = value === "" ? 0 : Math.max(0, Math.round(Number(value) * 100));
                    if (Number.isFinite(next) && next !== centavos) onSet(agencyId, item.key, next);
                  }}
                />
              </span>
            </label>
          );
        })}
        {items.length === 0 && <p className="muted-text">Nothing matches “{query}”.</p>}
      </div>
    </div>
  );
}

const ACCOUNTING_TABS = ["Overview", "Invoices & Vouchers", "Reconciliation", "Setup"] as const;
type AccountingTab = (typeof ACCOUNTING_TABS)[number];

const SUMMARY_RANGES = ["Daily", "Weekly", "Monthly"] as const;
type SummaryRange = (typeof SUMMARY_RANGES)[number];
const summaryPreset = (r: SummaryRange): ReportRangePreset => (r === "Daily" ? "Today" : r === "Weekly" ? "Last 7 days" : "This month");

/** Summary of Invoices (collections) per channel over Daily/Weekly/Monthly. */
function InvoiceSummary() {
  const { state } = useSystem();
  const toast = useToast();
  const [span, setSpan] = useState<SummaryRange>("Daily");
  const range = resolveRange(summaryPreset(span), todayIso());
  const invoices = state.ledger.filter((entry) => entry.type === "payment" && entry.verification === "Verified" && withinRange(entry.recordedAt, range));
  const byChannel = state.paymentChannels
    .filter((channel) => channel.active)
    .map((channel) => {
      const list = invoices.filter((entry) => entry.method === channel.name);
      return { channel: channel.name, count: list.length, total: list.reduce((sum, entry) => sum + entry.amountCentavos, 0) };
    })
    .filter((row) => row.count > 0);
  const total = invoices.reduce((sum, entry) => sum + entry.amountCentavos, 0);

  return (
    <Panel
      title="Summary of invoices"
      description={`Collections per channel · ${describeRange(range)}`}
      action={
        <button
          className="secondary-button"
          disabled={invoices.length === 0}
          onClick={() => {
            downloadCsv(`invoice-summary-${span}-${range.from}.csv`, [
              [`Invoice summary · ${span} · ${describeRange(range)}`],
              [],
              ["Channel", "Invoices", "Amount"],
              ...byChannel.map((row) => [row.channel, row.count, (row.total / 100).toFixed(2)]),
              [],
              ["Total", invoices.length, (total / 100).toFixed(2)],
            ]);
            toast("success", "Invoice summary exported.");
          }}
        >
          Download CSV
        </button>
      }
    >
      <div className="summary-panel">
        <Segmented options={SUMMARY_RANGES} value={span} onChange={setSpan} />
        {invoices.length === 0 ? (
          <EmptyState icon="₱" title="No invoices in this period" text="No verified collections in the selected window." />
        ) : (
          <DataTable columns={["Channel", "Invoices", "Amount"]}>
            {byChannel.map((row) => (
              <tr key={row.channel}>
                <td>{row.channel}</td>
                <td>{row.count}</td>
                <td><strong>{pesos(row.total)}</strong></td>
              </tr>
            ))}
          </DataTable>
        )}
        <div className="summary-total"><span>Total · {invoices.length} invoice{invoices.length === 1 ? "" : "s"}</span><strong>{pesos(total)}</strong></div>
      </div>
    </Panel>
  );
}

/** Summary of Expense Vouchers per category over Daily/Weekly/Monthly. */
function ExpenseVoucherSummary() {
  const { state } = useSystem();
  const toast = useToast();
  const [span, setSpan] = useState<SummaryRange>("Daily");
  const range = resolveRange(summaryPreset(span), todayIso());
  const vouchers = state.expenses.filter((expense) => withinRange(expense.createdAt, range));
  const categories = Array.from(new Set(vouchers.map((expense) => expense.category))).map((category) => {
    const list = vouchers.filter((expense) => expense.category === category);
    return { category, count: list.length, total: list.reduce((sum, expense) => sum + expense.amountCentavos, 0) };
  });
  const total = vouchers.reduce((sum, expense) => sum + expense.amountCentavos, 0);
  const approved = vouchers.filter((expense) => expense.status === "Approved" || expense.status === "Paid").reduce((sum, expense) => sum + expense.amountCentavos, 0);

  return (
    <Panel
      title="Summary of expense vouchers"
      description={`Per category · ${describeRange(range)}`}
      action={
        <button
          className="secondary-button"
          disabled={vouchers.length === 0}
          onClick={() => {
            downloadCsv(`expense-voucher-summary-${span}-${range.from}.csv`, [
              [`Expense voucher summary · ${span} · ${describeRange(range)}`],
              [],
              ["Category", "Vouchers", "Amount"],
              ...categories.map((row) => [row.category, row.count, (row.total / 100).toFixed(2)]),
              [],
              ["Total", vouchers.length, (total / 100).toFixed(2)],
              ["Approved / paid", "", (approved / 100).toFixed(2)],
            ]);
            toast("success", "Expense voucher summary exported.");
          }}
        >
          Download CSV
        </button>
      }
    >
      <div className="summary-panel">
        <Segmented options={SUMMARY_RANGES} value={span} onChange={setSpan} />
        {vouchers.length === 0 ? (
          <EmptyState icon="▥" title="No vouchers in this period" text="No expense vouchers raised in the selected window." />
        ) : (
          <DataTable columns={["Category", "Vouchers", "Amount"]}>
            {categories.map((row) => (
              <tr key={row.category}>
                <td>{row.category}</td>
                <td>{row.count}</td>
                <td><strong>{pesos(row.total)}</strong></td>
              </tr>
            ))}
          </DataTable>
        )}
        <div className="summary-total"><span>Total · {vouchers.length} voucher{vouchers.length === 1 ? "" : "s"}</span><strong>{pesos(total)}</strong></div>
      </div>
    </Panel>
  );
}

const normalizeRef = (value: string) => value.replace(/[\s-]/g, "").toUpperCase();

/**
 * Bank & GCash reconciliation. Accounting uploads a channel's external
 * transaction-history CSV; each row is matched to a recorded verified payment on
 * that channel by transaction reference (fallback: amount + date). Session-only.
 */
function BankReconciliation() {
  const { state } = useSystem();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const channels = state.paymentChannels.filter((c) => c.active && c.requiresReference);
  const [channel, setChannel] = useState(channels[0]?.name ?? "");
  const [bankRows, setBankRows] = useState<{ reference: string; amountCentavos: number; date: string; raw: string }[]>([]);
  const [fileName, setFileName] = useState("");

  const systemPayments = state.ledger.filter(
    (entry) => entry.type === "payment" && entry.verification === "Verified" && entry.method === channel,
  );

  // Match each bank row to a system payment: reference first, then amount+date.
  const usedSystem = new Set<string>();
  const matched: { bankRef: string; amountCentavos: number; systemRef: string }[] = [];
  const bankOnly: typeof bankRows = [];
  for (const row of bankRows) {
    const byRef = systemPayments.find((entry) => !usedSystem.has(entry.id) && entry.referenceNumber && normalizeRef(entry.referenceNumber) === row.reference);
    const byAmountDate =
      byRef ??
      systemPayments.find(
        (entry) => !usedSystem.has(entry.id) && entry.amountCentavos === row.amountCentavos && entry.recordedAt.slice(0, 10) === row.date,
      );
    if (byAmountDate) {
      usedSystem.add(byAmountDate.id);
      matched.push({ bankRef: row.reference, amountCentavos: row.amountCentavos, systemRef: byAmountDate.reference });
    } else {
      bankOnly.push(row);
    }
  }
  const systemOnly = systemPayments.filter((entry) => !usedSystem.has(entry.id));

  function handleFile(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
    void file.text().then((text) => {
      const grid = parseCsv(text);
      if (grid.length < 2) {
        toast("warning", "That file has no data rows.");
        setBankRows([]);
        return;
      }
      const header = grid[0].map((h) => h.trim().toLowerCase());
      const refCol = header.findIndex((h) => h.includes("ref"));
      const amtCol = header.findIndex((h) => h.includes("amount") || h.includes("amt") || h.includes("value"));
      const dateCol = header.findIndex((h) => h.includes("date"));
      if (amtCol < 0) {
        toast("warning", "Could not find an amount column in the CSV header.");
        setBankRows([]);
        return;
      }
      const parsed = grid.slice(1).map((cells) => {
        const amountCentavos = Math.round(Number((cells[amtCol] ?? "0").replace(/[^0-9.-]/g, "")) * 100);
        return {
          reference: refCol >= 0 ? normalizeRef(cells[refCol] ?? "") : "",
          amountCentavos,
          date: dateCol >= 0 ? (cells[dateCol] ?? "").trim().slice(0, 10) : "",
          raw: cells.join(" · "),
        };
      });
      setBankRows(parsed);
      toast("success", `${parsed.length} transaction${parsed.length === 1 ? "" : "s"} loaded from ${file.name}.`);
    });
  }

  return (
    <Panel
      title="Bank & GCash reconciliation"
      description="Upload a channel's transaction history (PSBank, UnionBank, GCash) and match it against recorded collections."
      action={
        bankRows.length > 0 ? (
          <button
            className="secondary-button"
            onClick={() => {
              downloadCsv(`reconciliation-${channel}-${todayIso()}.csv`, [
                [`Reconciliation · ${channel} · ${fileName}`],
                [],
                ["Result", "Bank reference", "Amount", "System payment"],
                ...matched.map((m) => ["Matched", m.bankRef, (m.amountCentavos / 100).toFixed(2), m.systemRef]),
                ...bankOnly.map((b) => ["In bank file only", b.reference, (b.amountCentavos / 100).toFixed(2), ""]),
                ...systemOnly.map((s) => ["In system only", s.referenceNumber ?? "", (s.amountCentavos / 100).toFixed(2), s.reference]),
              ]);
              toast("success", "Reconciliation exported.");
            }}
          >
            Download CSV
          </button>
        ) : undefined
      }
    >
      <div className="reconciliation">
        <div className="toolbar toolbar-wrap">
          <label className="inline-field">
            <span>Channel</span>
            <select value={channel} onChange={(event) => { setChannel(event.target.value); setBankRows([]); setFileName(""); }}>
              {channels.map((c) => (
                <option key={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <button className="secondary-button" onClick={() => inputRef.current?.click()}>
            Upload transaction history (CSV)
          </button>
          <input ref={inputRef} type="file" accept=".csv,text/csv" hidden onChange={(event) => handleFile(event.target.files?.[0])} />
          {fileName && <span className="muted-text">{fileName}</span>}
        </div>

        {bankRows.length === 0 ? (
          <EmptyState icon="◎" title="No file uploaded" text="Export a channel's transaction history (Payments → Transaction history) or upload a bank/GCash CSV with Date, Reference, and Amount columns." />
        ) : (
          <>
            <div className="stat-grid stat-grid-3">
              <StatCard label="Matched" value={String(matched.length)} note={pesos(matched.reduce((s, m) => s + m.amountCentavos, 0))} tone={2} icon="✓" />
              <StatCard label="In bank file only" value={String(bankOnly.length)} note={pesos(bankOnly.reduce((s, b) => s + b.amountCentavos, 0))} tone={5} icon="!" />
              <StatCard label="In system only" value={String(systemOnly.length)} note={pesos(systemOnly.reduce((s, e) => s + e.amountCentavos, 0))} tone={1} icon="◎" />
            </div>
            {bankOnly.length > 0 && (
              <>
                <h3 className="drawer-section">In bank file, not recorded</h3>
                <DataTable columns={["Reference", "Amount", "Date"]}>
                  {bankOnly.map((b, index) => (
                    <tr key={index}><td>{b.reference || "—"}</td><td>{pesos(b.amountCentavos)}</td><td>{b.date || "—"}</td></tr>
                  ))}
                </DataTable>
              </>
            )}
            {systemOnly.length > 0 && (
              <>
                <h3 className="drawer-section">Recorded, not in bank file</h3>
                <DataTable columns={["Payment", "Reference", "Amount"]}>
                  {systemOnly.map((s) => (
                    <tr key={s.id}><td><strong>{s.reference}</strong></td><td>{s.referenceNumber || "—"}</td><td>{pesos(s.amountCentavos)}</td></tr>
                  ))}
                </DataTable>
              </>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}

export function AccountingModule({ role }: { role: Role }) {
  const {
    state,
    views,
    addPaymentChannel,
    updatePaymentChannel,
    setPaymentChannelActive,
    addOtherCharge,
    updateOtherCharge,
    setOtherChargeActive,
    addExpenseCategory,
    updateExpenseCategory,
    setExpenseCategoryActive,
    addMonthlyPayable,
    updateMonthlyPayable,
    setMonthlyPayableActive,
    removeMonthlyPayable,
    addMarketingAgency,
    updateMarketingAgency,
    setMarketingAgencyActive,
    setAgencyCourseRebate,
  } = useSystem();
  const toast = useToast();
  const all = views();
  const canManage = role === "Admin" || role === "Accounting";
  const canManageCharges = role === "Admin" || role === "Accounting"; // Accounting Manager manages all catalogs
  const [channelDraft, setChannelDraft] = useState<ChannelDraft | null>(null);
  const [chargeDraft, setChargeDraft] = useState<ChargeDraft | null>(null);
  const [categoryDraft, setCategoryDraft] = useState<CategoryDraft | null>(null);
  const [payableDraft, setPayableDraft] = useState<PayableDraft | null>(null);
  const [agencyDraft, setAgencyDraft] = useState<AgencyDraft | null>(null);
  const [voucherFor, setVoucherFor] = useState<Expense | null>(null);
  const [tab, setTab] = useState<AccountingTab>("Overview");

  const payments = state.ledger.filter((entry) => entry.type === "payment" && entry.verification === "Verified");
  const gross = payments.reduce((sum, entry) => sum + entry.amountCentavos, 0);
  const refunds = state.ledger
    .filter((entry) => entry.type === "refund" || entry.type === "reversal")
    .reduce((sum, entry) => sum + entry.amountCentavos, 0);
  const receivables = all.reduce((sum, item) => sum + item.balanceCentavos, 0);
  const unreconciled = state.ledger.filter((entry) => entry.type === "payment" && entry.verification === "Pending");

  return (
    <div className="page">
      <PageHeader
        eyebrow="Financial control"
        title="Accounting"
        description="Collections, receivables, reconciliation, expenses, and partner payables built from the same ledger the cashier posts to."
      />

      <div className="hub-tabs">
        {ACCOUNTING_TABS.map((item) => (
          <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>
            {item}
          </button>
        ))}
      </div>

      {tab === "Overview" && (
      <>
      <div className="stat-grid stat-grid-4">
        <StatCard label="Gross collections" value={pesos(gross)} note={`${payments.length} verified payments`} tone={2} icon="₱" />
        <StatCard label="Net collections" value={pesos(gross - refunds)} note={`${pesos(refunds)} refunded or reversed`} tone={0} icon="▥" />
        <StatCard label="Receivables" value={pesos(receivables)} note={`${all.filter((item) => item.balanceCentavos > 0).length} open balances`} tone={1} icon="!" />
        <StatCard label="Unreconciled" value={String(unreconciled.length)} note={pesos(unreconciled.reduce((sum, entry) => sum + entry.amountCentavos, 0))} tone={5} icon="◎" />
      </div>

        <Panel title="Collections by channel" description="Verified payments only">
          <div className="bar-list">
            {state.paymentChannels.filter((channel) => channel.active).map((channel) => {
              const method = channel.name;
              const total = payments.filter((entry) => entry.method === method).reduce((sum, entry) => sum + entry.amountCentavos, 0);
              const share = gross > 0 ? Math.round((total / gross) * 100) : 0;
              return (
                <div key={channel.id} className="bar-row">
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
      </>
      )}

      {tab === "Invoices & Vouchers" && (
      <>
        <div className="two-column">
          <InvoiceSummary />
          <ExpenseVoucherSummary />
        </div>

        <Panel title="Expense vouchers" description="Approve or reject in the Requests module — each voucher raises an Expense request.">
          {state.expenses.length === 0 ? (
            <EmptyState icon="✓" title="No vouchers yet" text="Expense vouchers raised from Payments appear here." />
          ) : (
            <div className="history-list">
              {state.expenses.map((expense) => (
                <div key={expense.id} className="history-row">
                  <div>
                    <strong>{expense.expenseNumber} · {expense.purpose}</strong>
                    <small>
                      {expense.category}
                      {expense.itemUnit ? ` · ${expense.itemUnit}` : ""}
                      {expense.quantity ? ` · qty ${expense.quantity}` : ""}
                      {expense.payor ? ` · payor ${expense.payor}` : ""}
                      {expense.modeOfPayment ? ` · ${expense.modeOfPayment}` : ""}
                      {expense.requestedBy ? ` · by ${expense.requestedBy}` : ""}
                    </small>
                  </div>
                  <div className="history-right">
                    <strong>{pesos(expense.amountCentavos)}</strong>
                    <Pill tone={expense.status === "Rejected" ? "red" : expense.status === "Pending" ? "amber" : "green"}>{expense.status}</Pill>
                    <button className="ghost-button" onClick={() => setVoucherFor(expense)}>
                      View voucher
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel
          title="Monthly payables"
          description="Recurring bills tracked for the month — reminded on the Accounting and Admin dashboards."
          action={
            canManageCharges ? (
              <button className="link-button" onClick={() => setPayableDraft({ id: null, name: "", category: "Utilities", amount: "", dueDay: "1", notes: "" })}>
                ＋ Add payable
              </button>
            ) : undefined
          }
        >
          {state.monthlyPayables.length === 0 ? (
            <EmptyState icon="₱" title="No monthly payables" text="Add recurring bills (rent, utilities, remittances) to track them each month." />
          ) : (
            <div className="history-list">
              {[...state.monthlyPayables].sort((a, b) => a.dueDay - b.dueDay).map((payable) => (
                <div key={payable.id} className={`history-row ${payable.active ? "" : "row-muted"}`}>
                  <div>
                    <strong>{payable.name}</strong>
                    <small>{payable.category} · due day {payable.dueDay}{payable.notes ? ` · ${payable.notes}` : ""}{payable.active ? "" : " · archived"}</small>
                  </div>
                  <div className="history-right">
                    <strong>{pesos(payable.amountCentavos)}</strong>
                    {canManageCharges && (
                      <>
                        <button
                          className="ghost-button"
                          onClick={() => setPayableDraft({ id: payable.id, name: payable.name, category: payable.category, amount: (payable.amountCentavos / 100).toString(), dueDay: String(payable.dueDay), notes: payable.notes ?? "" })}
                        >
                          Edit
                        </button>
                        <button
                          className="ghost-button"
                          onClick={() => {
                            setMonthlyPayableActive(payable.id, !payable.active);
                            toast("warning", `${payable.name} ${payable.active ? "archived" : "restored"}.`);
                          }}
                        >
                          {payable.active ? "Archive" : "Restore"}
                        </button>
                        <button
                          className="ghost-button"
                          onClick={() => {
                            if (!window.confirm(`Remove "${payable.name}" from monthly payables?`)) return;
                            removeMonthlyPayable(payable.id);
                            toast("warning", `${payable.name} removed.`);
                          }}
                        >
                          Remove
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </>
      )}

      {tab === "Reconciliation" && <BankReconciliation />}

      {tab === "Setup" && (
      <>
      {canManage && (
          <Panel
            title="Payment channels"
            description="Modes of payment offered at the cashier"
            action={
              <button className="link-button" onClick={() => setChannelDraft({ id: null, name: "", requiresReference: true })}>
                ＋ Add channel
              </button>
            }
          >
            <div className="history-list">
              {state.paymentChannels.map((channel) => (
                <div key={channel.id} className={`history-row ${channel.active ? "" : "row-muted"}`}>
                  <div>
                    <strong>{channel.name}</strong>
                    <small>{channel.requiresReference ? "Reference required · verified" : "Cash · posted immediately"}{channel.active ? "" : " · archived"}</small>
                  </div>
                  <div className="cell-actions">
                    <button
                      className="ghost-button"
                      onClick={() => setChannelDraft({ id: channel.id, name: channel.name, requiresReference: channel.requiresReference })}
                    >
                      Edit
                    </button>
                    <button
                      className="ghost-button"
                      onClick={() => {
                        setPaymentChannelActive(channel.id, !channel.active);
                        toast("warning", `${channel.name} ${channel.active ? "archived" : "restored"}.`);
                      }}
                    >
                      {channel.active ? "Archive" : "Restore"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
      )}

      {canManageCharges && (
        <Panel
          title="Other charges"
          description="Admin-managed catalog the cashier can post (Uniform, Cancellation Fee, Reprinting, Make-Up Class)"
          action={
            <button className="link-button" onClick={() => setChargeDraft({ id: null, name: "", amount: "" })}>
              ＋ Add charge type
            </button>
          }
        >
          <div className="history-list">
            {state.otherCharges.map((charge) => (
              <div key={charge.id} className={`history-row ${charge.active ? "" : "row-muted"}`}>
                <div>
                  <strong>{charge.name}</strong>
                  <small>Default {pesos(charge.defaultAmountCentavos)}{charge.active ? "" : " · archived"}</small>
                </div>
                <div className="cell-actions">
                  <button
                    className="ghost-button"
                    onClick={() => setChargeDraft({ id: charge.id, name: charge.name, amount: (charge.defaultAmountCentavos / 100).toString() })}
                  >
                    Edit
                  </button>
                  <button
                    className="ghost-button"
                    onClick={() => {
                      setOtherChargeActive(charge.id, !charge.active);
                      toast("warning", `${charge.name} ${charge.active ? "archived" : "restored"}.`);
                    }}
                  >
                    {charge.active ? "Archive" : "Restore"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {canManageCharges && (
        <Panel
          title="Expense categories"
          description="Admin-managed categories the cashier picks when raising an expense voucher."
          action={
            <button className="link-button" onClick={() => setCategoryDraft({ id: null, name: "" })}>
              ＋ Add category
            </button>
          }
        >
          <div className="history-list">
            {state.expenseCategories.map((category) => (
              <div key={category.id} className={`history-row ${category.active ? "" : "row-muted"}`}>
                <div>
                  <strong>{category.name}</strong>
                  <small>Voucher category{category.active ? "" : " · archived"}</small>
                </div>
                <div className="cell-actions">
                  <button className="ghost-button" onClick={() => setCategoryDraft({ id: category.id, name: category.name })}>
                    Edit
                  </button>
                  <button
                    className="ghost-button"
                    onClick={() => {
                      setExpenseCategoryActive(category.id, !category.active);
                      toast("warning", `${category.name} ${category.active ? "archived" : "restored"}.`);
                    }}
                  >
                    {category.active ? "Archive" : "Restore"}
                  </button>
                </div>
              </div>
            ))}
            {state.expenseCategories.length === 0 && (
              <EmptyState icon="▥" title="No expense categories" text="Add a category so vouchers can be classified." />
            )}
          </div>
        </Panel>
      )}

      {canManageCharges && (
        <Panel
          title="Marketing agencies"
          description="Admin-managed referral agencies with per-course rebates across the STCW and in-house catalog. The cashier picks one and the rebate for that course is applied as a trainee discount."
          action={
            <button className="link-button" onClick={() => setAgencyDraft({ id: null, name: "" })}>
              ＋ Add agency
            </button>
          }
        >
          <div className="history-list">
            {state.marketingAgencies.map((agency) => {
              const priced = Object.keys(agency.rebates).length;
              return (
              <div key={agency.id} className={`history-row ${agency.active ? "" : "row-muted"}`}>
                <div>
                  <strong>{agency.name}</strong>
                  <small>{priced} course{priced === 1 ? "" : "s"} with a rebate{agency.active ? "" : " · archived"}</small>
                </div>
                <div className="cell-actions">
                  <button
                    className="ghost-button"
                    onClick={() => setAgencyDraft({ id: agency.id, name: agency.name })}
                  >
                    Edit rebates
                  </button>
                  <button
                    className="ghost-button"
                    onClick={() => {
                      setMarketingAgencyActive(agency.id, !agency.active);
                      toast("warning", `${agency.name} ${agency.active ? "archived" : "restored"}.`);
                    }}
                  >
                    {agency.active ? "Archive" : "Restore"}
                  </button>
                </div>
              </div>
              );
            })}
            {state.marketingAgencies.length === 0 && (
              <EmptyState icon="◇" title="No marketing agencies" text="Add an agency so cashiers can apply its rebate." />
            )}
          </div>
        </Panel>
      )}
      </>
      )}

      <Modal
        open={Boolean(chargeDraft)}
        title={chargeDraft?.id ? "Edit charge type" : "Add charge type"}
        description="Cashiers pick from active charge types when adding to an enrollment."
        onClose={() => setChargeDraft(null)}
        footer={
          <>
            <button className="secondary-button" onClick={() => setChargeDraft(null)}>Cancel</button>
            <button
              className="primary-button"
              onClick={() => {
                if (!chargeDraft) return;
                const name = chargeDraft.name.trim();
                if (!name || !(Number(chargeDraft.amount) >= 0)) {
                  toast("warning", "Enter a name and a valid default amount.");
                  return;
                }
                const defaultAmountCentavos = Math.round(Number(chargeDraft.amount) * 100);
                if (chargeDraft.id) {
                  updateOtherCharge(chargeDraft.id, { name, defaultAmountCentavos });
                  toast("success", `${name} updated.`);
                } else {
                  addOtherCharge({ name, defaultAmountCentavos });
                  toast("success", `${name} added.`);
                }
                setChargeDraft(null);
              }}
            >
              {chargeDraft?.id ? "Save changes" : "Add charge"}
            </button>
          </>
        }
      >
        {chargeDraft && (
          <div className="form-grid">
            <Field label="Charge name*" full hint="e.g. Uniform, Cancellation Fee, Reprinting, Make-Up Class">
              <input value={chargeDraft.name} onChange={(event) => setChargeDraft({ ...chargeDraft, name: event.target.value })} />
            </Field>
            <Field label="Default amount (₱)*">
              <input type="number" min={0} step="1" value={chargeDraft.amount} onChange={(event) => setChargeDraft({ ...chargeDraft, amount: event.target.value })} />
            </Field>
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(categoryDraft)}
        title={categoryDraft?.id ? "Edit expense category" : "Add expense category"}
        description="Cashiers pick from active categories when raising an expense voucher."
        onClose={() => setCategoryDraft(null)}
        footer={
          <>
            <button className="secondary-button" onClick={() => setCategoryDraft(null)}>Cancel</button>
            <button
              className="primary-button"
              onClick={() => {
                if (!categoryDraft) return;
                const name = categoryDraft.name.trim();
                if (!name) {
                  toast("warning", "Category name is required.");
                  return;
                }
                if (categoryDraft.id) {
                  updateExpenseCategory(categoryDraft.id, { name });
                  toast("success", `${name} updated.`);
                } else {
                  addExpenseCategory({ name });
                  toast("success", `${name} added.`);
                }
                setCategoryDraft(null);
              }}
            >
              {categoryDraft?.id ? "Save changes" : "Add category"}
            </button>
          </>
        }
      >
        {categoryDraft && (
          <div className="form-grid">
            <Field label="Category name*" full hint="e.g. Supplies, Utilities, Professional Fees">
              <input value={categoryDraft.name} onChange={(event) => setCategoryDraft({ ...categoryDraft, name: event.target.value })} />
            </Field>
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(payableDraft)}
        title={payableDraft?.id ? "Edit monthly payable" : "Add monthly payable"}
        description="Recurring bills reminded on the Accounting and Admin dashboards."
        onClose={() => setPayableDraft(null)}
        footer={
          <>
            <button className="secondary-button" onClick={() => setPayableDraft(null)}>Cancel</button>
            <button
              className="primary-button"
              onClick={() => {
                if (!payableDraft) return;
                const name = payableDraft.name.trim();
                const amountCentavos = Math.round(Number(payableDraft.amount) * 100);
                const dueDay = Math.min(31, Math.max(1, Math.round(Number(payableDraft.dueDay) || 1)));
                if (!name) { toast("warning", "Payable name is required."); return; }
                if (!Number.isFinite(amountCentavos) || amountCentavos <= 0) { toast("warning", "Enter a valid amount."); return; }
                const patch = { name, category: payableDraft.category.trim() || "Others", amountCentavos, dueDay, notes: payableDraft.notes.trim() || undefined };
                if (payableDraft.id) {
                  updateMonthlyPayable(payableDraft.id, patch);
                  toast("success", `${name} updated.`);
                } else {
                  addMonthlyPayable(patch);
                  toast("success", `${name} added.`);
                }
                setPayableDraft(null);
              }}
            >
              {payableDraft?.id ? "Save changes" : "Add payable"}
            </button>
          </>
        }
      >
        {payableDraft && (
          <div className="form-grid">
            <Field label="Payable name*" full hint="e.g. Office rent, Internet (PLDT), SSS remittance">
              <input value={payableDraft.name} onChange={(event) => setPayableDraft({ ...payableDraft, name: event.target.value })} />
            </Field>
            <Field label="Category">
              <input value={payableDraft.category} onChange={(event) => setPayableDraft({ ...payableDraft, category: event.target.value })} />
            </Field>
            <Field label="Amount (PHP)*">
              <input inputMode="decimal" value={payableDraft.amount} onChange={(event) => setPayableDraft({ ...payableDraft, amount: event.target.value })} />
            </Field>
            <Field label="Due day of month (1–31)*">
              <input inputMode="numeric" value={payableDraft.dueDay} onChange={(event) => setPayableDraft({ ...payableDraft, dueDay: event.target.value })} />
            </Field>
            <Field label="Notes" full>
              <input value={payableDraft.notes} onChange={(event) => setPayableDraft({ ...payableDraft, notes: event.target.value })} />
            </Field>
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(agencyDraft)}
        title={agencyDraft?.id ? "Edit marketing agency" : "Add marketing agency"}
        description="Set a per-course rebate for every STCW and in-house course. Cashiers pick the agency and the rebate for that course is applied as a trainee discount."
        onClose={() => setAgencyDraft(null)}
        wide
        footer={
          <>
            <button className="secondary-button" onClick={() => setAgencyDraft(null)}>
              {agencyDraft?.id ? "Done" : "Cancel"}
            </button>
            {!agencyDraft?.id && (
              <button
                className="primary-button"
                onClick={() => {
                  if (!agencyDraft) return;
                  const name = agencyDraft.name.trim();
                  if (!name) {
                    toast("warning", "Agency name is required.");
                    return;
                  }
                  const created = addMarketingAgency({ name, rebates: {} });
                  toast("success", `${name} added. Set its per-course rebates.`);
                  setAgencyDraft({ id: created.id, name: created.name });
                }}
              >
                Add agency
              </button>
            )}
          </>
        }
      >
        {agencyDraft && (
          <div className="form-grid">
            <Field label="Agency name*" full hint="e.g. Seafront Manning Agency">
              <input
                value={agencyDraft.name}
                onChange={(event) => setAgencyDraft({ ...agencyDraft, name: event.target.value })}
                onBlur={() => {
                  if (agencyDraft.id && agencyDraft.name.trim()) updateMarketingAgency(agencyDraft.id, { name: agencyDraft.name.trim() });
                }}
              />
            </Field>
            {agencyDraft.id ? (
              <AgencyRebateEditor agencyId={agencyDraft.id} onSet={setAgencyCourseRebate} />
            ) : (
              <p className="form-full muted-text">Add the agency first, then set its per-course rebates here.</p>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(channelDraft)}
        title={channelDraft?.id ? "Edit payment channel" : "Add payment channel"}
        description="Cashiers pick from active channels when posting a payment."
        onClose={() => setChannelDraft(null)}
        footer={
          <>
            <button className="secondary-button" onClick={() => setChannelDraft(null)}>Cancel</button>
            <button
              className="primary-button"
              onClick={() => {
                if (!channelDraft) return;
                const name = channelDraft.name.trim();
                if (!name) {
                  toast("warning", "Channel name is required.");
                  return;
                }
                if (channelDraft.id) {
                  updatePaymentChannel(channelDraft.id, { name, requiresReference: channelDraft.requiresReference });
                  toast("success", `${name} updated.`);
                } else {
                  addPaymentChannel({ name, requiresReference: channelDraft.requiresReference });
                  toast("success", `${name} added.`);
                }
                setChannelDraft(null);
              }}
            >
              {channelDraft?.id ? "Save changes" : "Add channel"}
            </button>
          </>
        }
      >
        {channelDraft && (
          <div className="form-grid">
            <Field label="Channel name*" full hint="e.g. UnionBank, PSBank, GCash, Cash">
              <input value={channelDraft.name} onChange={(event) => setChannelDraft({ ...channelDraft, name: event.target.value })} />
            </Field>
            <label className="inline-field inline-check field-full">
              <input
                type="checkbox"
                checked={channelDraft.requiresReference}
                onChange={(event) => setChannelDraft({ ...channelDraft, requiresReference: event.target.checked })}
              />
              <span>Requires a transaction reference (bank / e-wallet). Leave unchecked for cash.</span>
            </label>
          </div>
        )}
      </Modal>

      {voucherFor && <ExpenseVoucherPreviewModal expense={voucherFor} onClose={() => setVoucherFor(null)} />}
    </div>
  );
}

/**
 * Expense voucher preview in the shared New Wave document format. Shown on screen
 * first (no auto-download); the half-sheet PDF and print are triggered from here.
 */
function ExpenseVoucherPreviewModal({ expense, onClose }: { expense: Expense; onClose: () => void }) {
  const toast = useToast();
  const [building, setBuilding] = useState(false);

  async function downloadPdf() {
    setBuilding(true);
    try {
      let logoBytes: Uint8Array | undefined;
      try {
        logoBytes = new Uint8Array(await (await fetch("/new-wave-logo.png")).arrayBuffer());
      } catch {
        /* logo optional */
      }
      const bytes = await createExpenseVoucherPdf({
        number: expense.expenseNumber,
        issuedAt: formatDate(expense.createdAt),
        payee: expense.payee,
        category: expense.category,
        purpose: expense.purpose,
        amountCentavos: expense.amountCentavos,
        quantity: expense.quantity,
        unit: expense.itemUnit,
        requestedBy: expense.requestedBy ?? expense.payor ?? "",
        modeOfPayment: expense.modeOfPayment ?? "",
        status: expense.status,
        preparedBy: expense.requestedBy ?? "",
        approvedBy: expense.decidedBy ?? "",
        logoBytes,
      });
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "application/pdf" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${expense.expenseNumber}-expense-voucher.pdf`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      toast("warning", "Could not generate the voucher PDF.");
    } finally {
      setBuilding(false);
    }
  }

  return (
    <Modal
      open
      title="Expense voucher"
      description={`${expense.expenseNumber} · ${expense.payee}`}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="secondary-button" onClick={onClose}>Close</button>
          <button className="secondary-button" onClick={() => window.print()}>Print</button>
          <button className="primary-button" onClick={downloadPdf} disabled={building}>
            {building ? "Generating…" : "Download PDF"}
          </button>
        </>
      }
    >
      <div className="admission-slip" id="voucher-print">
        <div className="slip-head">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/new-wave-logo.png" alt="New Wave Maritime" className="slip-logo" />
          <div>
            <h2>NEW WAVE MARITIME TRAINING AND ASSESSMENT CENTER, INC.</h2>
            <p>Room 103, Bel-Air Apartment, 1020 Roxas Boulevard, Ermita, Manila 1000</p>
            <strong>EXPENSE VOUCHER</strong>
          </div>
        </div>

        <div className="slip-meta">
          <span>Voucher <strong>{expense.expenseNumber}</strong></span>
          <span>Issued <strong>{formatDate(expense.createdAt)}</strong></span>
          <span>Status <strong>{expense.status}</strong></span>
        </div>

        <h3 className="slip-section">Voucher details</h3>
        <div className="slip-grid">
          <div><span>Payee</span><strong>{expense.payee}</strong></div>
          <div><span>Category</span><strong>{expense.category}</strong></div>
          <div><span>Purpose</span><strong>{expense.purpose}</strong></div>
          <div><span>Mode of payment</span><strong>{expense.modeOfPayment ?? "—"}</strong></div>
          <div><span>Quantity / unit</span><strong>{`${expense.quantity ?? "—"} ${expense.itemUnit ?? ""}`.trim()}</strong></div>
          <div><span>Requested by</span><strong>{expense.requestedBy ?? expense.payor ?? "—"}</strong></div>
        </div>

        <div className="slip-grid" style={{ marginTop: 16 }}>
          <div><span>Amount</span><strong>{pesos(expense.amountCentavos)}</strong></div>
          <div><span>Status</span><strong>{expense.status}</strong></div>
        </div>

        <div className="slip-signatures">
          <div>
            <div className="sign-line">{expense.requestedBy ?? " "}</div>
            <span>Prepared by · Signature over Printed Name</span>
          </div>
          <div>
            <div className="sign-line">{expense.decidedBy ?? " "}</div>
            <span>Approved by · Signature over Printed Name</span>
          </div>
        </div>
      </div>
    </Modal>
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

const requestTypes: RequestType[] = ["Rescheduling", "Change Course", "Releasing Rebates", "Expenses", "Batch rescheduling", "Batch cancellation", "Change of instructor", "Change of room", "Refund", "Record correction", "Make-up class", "Reprinting", "Cancellation"];

export function RequestsModule({ role }: { role: Role }) {
  const { state, views, createRequest, decideRequest } = useSystem();
  const toast = useToast();
  // Reschedule/cancellation/reprinting/make-up/course-change are approved by the
  // Accounting Manager. The cashier's tab is read-only — status of their own
  // requests, and changes apply only once approved.
  const canDecide = role === "Admin" || role === "Accounting";
  const [tab, setTab] = useState<"Pending" | "Decided" | "All">("Pending");
  const [newOpen, setNewOpen] = useState(false);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [draft, setDraft] = useState({ type: "Rescheduling" as RequestType, enrollmentId: "", reason: "" });

  const all = views();
  const rows = state.requests
    .filter((request) => (role === "Cashier" ? request.requestedBy === "Cashier" : true))
    .filter((request) => {
      const created = request.createdAt.slice(0, 10);
      return (!fromDate || created >= fromDate) && (!toDate || created <= toDate);
    })
    .filter((request) =>
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
        description={
          canDecide
            ? "Reschedules, corrections, reprinting, make-up, and course changes approved by the Accounting Manager."
            : "Track the status of your requests — changes apply only once the Accounting Manager approves them."
        }
        actions={
          role !== "Cashier" ? (
            <button className="primary-button" onClick={() => setNewOpen(true)}>
              + New request
            </button>
          ) : undefined
        }
      />

      <div className="stat-grid stat-grid-4">
        <StatCard label="Pending" value={String(state.requests.filter((item) => item.status === "Pending").length)} note="Awaiting a decision" tone={1} icon="!" />
        <StatCard label="For clarification" value={String(state.requests.filter((item) => item.status === "For clarification").length)} note="Returned to requester" tone={3} icon="↗" />
        <StatCard label="Approved" value={String(state.requests.filter((item) => item.status === "Approved").length)} note="Applied to records" tone={2} icon="✓" />
        <StatCard label="Rejected" value={String(state.requests.filter((item) => item.status === "Rejected").length)} note="Reason recorded" tone={5} icon="✕" />
      </div>

      <Panel padded={false}>
        <div className="toolbar toolbar-wrap">
          <Segmented options={["Pending", "Decided", "All"] as const} value={tab} onChange={setTab} />
          <label className="inline-field">
            <span>From</span>
            <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
          </label>
          <label className="inline-field">
            <span>To</span>
            <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
          </label>
        </div>
        {rows.length === 0 ? (
          <EmptyState icon="✓" title={canDecide ? "Nothing to decide" : "No requests"} text={canDecide ? "New requests from staff appear here for approval." : "Requests you raise appear here with their status."} />
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
                  {canDecide && (request.status === "Pending" || request.status === "For clarification") ? (
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
                setDraft({ type: "Rescheduling", enrollmentId: "", reason: "" });
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

/** HR account setup — its own nav module. */
export function UserSetupModule() {
  return (
    <div className="page">
      <PageHeader eyebrow="People operations" title="User setup" description="Add, edit, and separate employee accounts with payroll setup." />
      <HrUserSetup />
    </div>
  );
}

const PAYROLL_TABS = ["Attendance", "Payroll & payslips", "13th month"] as const;
type PayrollTab = (typeof PAYROLL_TABS)[number];

/** Consolidated payroll workspace — attendance, payroll, payslips, and 13th month. */
export function PayrollModule() {
  const [tab, setTab] = useState<PayrollTab>("Payroll & payslips");
  const now = new Date();
  const midCutoff = new Date(now.getFullYear(), now.getMonth(), 15);
  const endCutoff = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return (
    <div className="page">
      <PageHeader eyebrow="People operations" title="Payroll" description="Attendance, payroll runs, payslips, and 13th-month pay." />
      <div className="inline-note note-blue">
        <strong>Semi-monthly cut-off — 15th &amp; 30th (end of month)</strong>
        <p>This month: 1st–15th paid on {formatDate(midCutoff.toISOString())}; 16th–end paid on {formatDate(endCutoff.toISOString())}.</p>
      </div>
      <div className="hub-tabs">
        {PAYROLL_TABS.map((item) => (
          <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item}</button>
        ))}
      </div>
      {tab === "Attendance" && <HrAttendanceTab />}
      {tab === "Payroll & payslips" && <HrPayrollTab />}
      {tab === "13th month" && <HrThirteenthTab />}
    </div>
  );
}

/** Employee requests (MyHR) — leave, cash advance, and absences. */
export function HrRequestModule() {
  return (
    <div className="page">
      <PageHeader eyebrow="People operations" title="Request" description="Employee leave, cash-advance requests, and absences (MyHR)." />
      <HrRequestsTab />
    </div>
  );
}

type EmployeeDraft = {
  id: string | null;
  name: string; position: string; department: string;
  employmentType: Employee["employmentType"];
  dateHired: string;
  payFrequency: NonNullable<Employee["payFrequency"]>;
  email: string;
  basic: string; allowance: string; sss: string; pagibig: string; philhealth: string;
};

const EMPLOYMENT_TYPES: Employee["employmentType"][] = ["Probationary", "Regular", "Contractual", "Trainee", "Part-time", "Contract"];
const PAY_FREQUENCIES: NonNullable<Employee["payFrequency"]>[] = ["Daily", "Weekly", "Semi-Monthly", "Monthly"];
const toC = (value: string) => Math.max(0, Math.round(Number(value || "0") * 100));

/** User Setup — add / edit / archive employee accounts with payroll setup. */
function HrUserSetup() {
  const { state, addEmployee, updateEmployee, setEmployeeStatus } = useSystem();
  const toast = useToast();
  const [draft, setDraft] = useState<EmployeeDraft | null>(null);
  const emptyDraft: EmployeeDraft = { id: null, name: "", position: "", department: "", employmentType: "Probationary", dateHired: todayIso(), payFrequency: "Semi-Monthly", email: "", basic: "", allowance: "", sss: "", pagibig: "", philhealth: "" };

  return (
    <>
      <Panel padded={false} action={<button className="link-button" onClick={() => setDraft(emptyDraft)}>＋ Add employee</button>}>
        <DataTable columns={["Employee", "Position / dept", "Type", "Pay", "Basic salary", "Status", ""]} minWidth={1040}>
          {state.employees.map((employee) => (
            <tr key={employee.id} className={employee.status === "Separated" ? "row-muted" : ""}>
              <td>
                <div className="person-cell">
                  <Avatar name={employee.name} tone="orange" />
                  <div><strong>{employee.name}</strong><small>{employee.employeeNumber} · {employee.email}</small></div>
                </div>
              </td>
              <td>{employee.position}<small>{employee.department}</small></td>
              <td>{employee.employmentType}</td>
              <td>{employee.payFrequency ?? "—"}</td>
              <td>{pesos(employee.basicSalaryCentavos ?? employee.monthlyRateCentavos)}</td>
              <td><Pill tone={employee.status === "Active" ? "green" : employee.status === "Separated" ? "red" : "amber"}>{employee.status}</Pill></td>
              <td className="cell-actions">
                <button
                  className="ghost-button"
                  onClick={() => setDraft({ id: employee.id, name: employee.name, position: employee.position, department: employee.department, employmentType: employee.employmentType, dateHired: employee.dateHired ?? "", payFrequency: employee.payFrequency ?? "Semi-Monthly", email: employee.email, basic: String((employee.basicSalaryCentavos ?? employee.monthlyRateCentavos) / 100), allowance: String((employee.allowanceCentavos ?? 0) / 100), sss: String((employee.sssCentavos ?? 0) / 100), pagibig: String((employee.pagibigCentavos ?? 0) / 100), philhealth: String((employee.philhealthCentavos ?? 0) / 100) })}
                >
                  Edit
                </button>
                <button
                  className="ghost-button"
                  onClick={() => {
                    const next = employee.status === "Active" ? "Separated" : "Active";
                    setEmployeeStatus(employee.id, next);
                    toast("warning", `${employee.name} ${next === "Active" ? "reactivated" : "separated"}.`);
                  }}
                >
                  {employee.status === "Active" ? "Separate" : "Reactivate"}
                </button>
              </td>
            </tr>
          ))}
        </DataTable>
      </Panel>

      <Modal
        open={Boolean(draft)}
        title={draft?.id ? "Edit employee" : "Add employee account"}
        description="Creates a portal account with payroll setup."
        onClose={() => setDraft(null)}
        wide
        footer={
          <>
            <button className="secondary-button" onClick={() => setDraft(null)}>Cancel</button>
            <button
              className="primary-button"
              onClick={() => {
                if (!draft) return;
                const name = draft.name.trim();
                if (!name || !draft.position.trim()) {
                  toast("warning", "Name and position are required.");
                  return;
                }
                const basicSalaryCentavos = toC(draft.basic);
                const payload = {
                  name, position: draft.position.trim(), department: draft.department.trim(), employmentType: draft.employmentType,
                  dateHired: draft.dateHired, payFrequency: draft.payFrequency, email: draft.email.trim(),
                  monthlyRateCentavos: basicSalaryCentavos, dailyRateCentavos: Math.round(basicSalaryCentavos / 22),
                  basicSalaryCentavos, allowanceCentavos: toC(draft.allowance), sssCentavos: toC(draft.sss), pagibigCentavos: toC(draft.pagibig), philhealthCentavos: toC(draft.philhealth),
                };
                if (draft.id) {
                  updateEmployee(draft.id, payload);
                  toast("success", `${name} updated.`);
                } else {
                  addEmployee(payload);
                  toast("success", `${name} added.`);
                }
                setDraft(null);
              }}
            >
              {draft?.id ? "Save changes" : "Add employee"}
            </button>
          </>
        }
      >
        {draft && (
          <div className="form-grid">
            <Field label="Full name*" full><input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
            <Field label="Position*"><input value={draft.position} onChange={(e) => setDraft({ ...draft, position: e.target.value })} /></Field>
            <Field label="Department"><input value={draft.department} onChange={(e) => setDraft({ ...draft, department: e.target.value })} /></Field>
            <Field label="Email"><input value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} /></Field>
            <Field label="Date hired"><input type="date" value={draft.dateHired} onChange={(e) => setDraft({ ...draft, dateHired: e.target.value })} /></Field>
            <Field label="Status">
              <select value={draft.employmentType} onChange={(e) => setDraft({ ...draft, employmentType: e.target.value as Employee["employmentType"] })}>
                {EMPLOYMENT_TYPES.map((type) => <option key={type}>{type}</option>)}
              </select>
            </Field>
            <Field label="Pay frequency">
              <select value={draft.payFrequency} onChange={(e) => setDraft({ ...draft, payFrequency: e.target.value as NonNullable<Employee["payFrequency"]> })}>
                {PAY_FREQUENCIES.map((freq) => <option key={freq}>{freq}</option>)}
              </select>
            </Field>
            <Field label="Basic salary (₱ / month)"><input type="number" min={0} value={draft.basic} onChange={(e) => setDraft({ ...draft, basic: e.target.value })} /></Field>
            <Field label="Allowance (₱)"><input type="number" min={0} value={draft.allowance} onChange={(e) => setDraft({ ...draft, allowance: e.target.value })} /></Field>
            <Field label="SSS (₱)"><input type="number" min={0} value={draft.sss} onChange={(e) => setDraft({ ...draft, sss: e.target.value })} /></Field>
            <Field label="Pag-IBIG (₱)"><input type="number" min={0} value={draft.pagibig} onChange={(e) => setDraft({ ...draft, pagibig: e.target.value })} /></Field>
            <Field label="PhilHealth (₱)"><input type="number" min={0} value={draft.philhealth} onChange={(e) => setDraft({ ...draft, philhealth: e.target.value })} /></Field>
          </div>
        )}
      </Modal>
    </>
  );
}

/** Attendance — daily time in / out vs schedule, deriving Present/Late/Undertime/Absent. */
function HrAttendanceTab() {
  const { state, upsertHrAttendance } = useSystem();
  const toast = useToast();
  const [date, setDate] = useState(todayIso());
  const active = state.employees.filter((item) => item.status === "Active");

  const deriveStatus = (scheduleIn: string, scheduleOut: string, timeIn: string, timeOut: string): HrAttendanceRecord["status"] => {
    if (!timeIn && !timeOut) return "Absent";
    if (timeIn > scheduleIn) return "Late";
    if (timeOut && timeOut < scheduleOut) return "Undertime";
    return "Present";
  };

  return (
    <Panel padded={false}>
      <div className="toolbar toolbar-wrap">
        <label className="inline-field"><span>Date</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <span className="toolbar-end catalog-count">{active.length} employees</span>
      </div>
      <DataTable columns={["Employee", "Schedule", "Time in", "Time out", "Status", ""]} minWidth={900}>
        {active.map((employee) => {
          const record = state.hrAttendance.find((item) => item.employeeId === employee.id && item.date === date);
          return <HrAttendanceRow key={employee.id} employee={employee} date={date} record={record} onSave={(timeIn, timeOut) => {
            const scheduleIn = "08:00", scheduleOut = "17:00";
            upsertHrAttendance({ employeeId: employee.id, date, scheduleIn, scheduleOut, timeIn, timeOut, status: deriveStatus(scheduleIn, scheduleOut, timeIn, timeOut) });
            toast("success", `${employee.name} attendance saved.`);
          }} />;
        })}
      </DataTable>
    </Panel>
  );
}

function HrAttendanceRow({ employee, record, onSave }: { employee: Employee; date: string; record?: HrAttendanceRecord; onSave: (timeIn: string, timeOut: string) => void }) {
  const [timeIn, setTimeIn] = useState(record?.timeIn ?? "");
  const [timeOut, setTimeOut] = useState(record?.timeOut ?? "");
  return (
    <tr>
      <td><strong>{employee.name}</strong><small>{employee.employeeNumber}</small></td>
      <td>{record?.scheduleIn ?? "08:00"} – {record?.scheduleOut ?? "17:00"}</td>
      <td><input type="time" value={timeIn} onChange={(e) => setTimeIn(e.target.value)} /></td>
      <td><input type="time" value={timeOut} onChange={(e) => setTimeOut(e.target.value)} /></td>
      <td>{record ? <Pill tone={record.status === "Present" ? "green" : record.status === "Absent" ? "red" : "amber"}>{record.status}</Pill> : <span className="muted-text">Not logged</span>}</td>
      <td className="cell-actions"><button className="ghost-button" onClick={() => onSave(timeIn, timeOut)}>Save</button></td>
    </tr>
  );
}

/** Requests (MyHR) — per-employee leave, absences, and cash advances. */
function HrRequestsTab() {
  const { state, createLeave, decideLeave, createCashAdvance, decideCashAdvance } = useSystem();
  const toast = useToast();
  const [employeeId, setEmployeeId] = useState(state.employees[0]?.id ?? "");
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [advanceOpen, setAdvanceOpen] = useState(false);
  const [leaveDraft, setLeaveDraft] = useState({ leaveType: "Vacation" as LeaveRequest["leaveType"], startsOn: todayIso(), endsOn: todayIso(), reason: "" });
  const [advanceDraft, setAdvanceDraft] = useState({ amount: "", reason: "" });

  const employee = state.employees.find((item) => item.id === employeeId);
  const leaves = state.leaveRequests.filter((item) => item.employeeId === employeeId);
  const advances = state.cashAdvances.filter((item) => item.employeeId === employeeId);
  const absences = state.hrAttendance.filter((item) => item.employeeId === employeeId && item.status === "Absent");

  return (
    <>
      <Panel padded={false}>
        <div className="toolbar toolbar-wrap">
          <label className="inline-field">
            <span>MyHR — employee</span>
            <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              {state.employees.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          {employee && (
            <>
              <button className="secondary-button toolbar-end" onClick={() => { setLeaveDraft({ leaveType: "Vacation", startsOn: todayIso(), endsOn: todayIso(), reason: "" }); setLeaveOpen(true); }}>File leave</button>
              <button className="secondary-button" onClick={() => { setAdvanceDraft({ amount: "", reason: "" }); setAdvanceOpen(true); }}>File cash advance</button>
            </>
          )}
        </div>
      </Panel>

      <div className="two-column">
        <Panel title="Leave requests" description="Filed by / for this employee">
          {leaves.length === 0 ? <EmptyState icon="✓" title="No leave" text="No leave requests on file." /> : leaves.map((leave) => (
            <div key={leave.id} className="activity-row">
              <div><strong>{leave.leaveType} · {formatDateRange(leave.startsOn, leave.endsOn)}</strong><small>{leave.reference} · {leave.reason}</small></div>
              <div className="cell-actions">
                {leave.status === "Pending" ? (
                  <>
                    <button className="ghost-button" onClick={() => { decideLeave(leave.id, "Approved"); toast("success", "Leave approved."); }}>Approve</button>
                    <button className="ghost-button ghost-danger" onClick={() => { decideLeave(leave.id, "Rejected"); toast("warning", "Leave rejected."); }}>Reject</button>
                  </>
                ) : <Pill tone={leave.status === "Approved" ? "green" : "red"}>{leave.status}</Pill>}
              </div>
            </div>
          ))}
        </Panel>

        <Panel title="Cash advances" description="Payroll deduction on approval">
          {advances.length === 0 ? <EmptyState icon="₱" title="No advances" text="No cash-advance requests on file." /> : advances.map((advance) => (
            <div key={advance.id} className="activity-row">
              <div><strong>{pesos(advance.amountCentavos)}</strong><small>{advance.reference} · {advance.reason}</small></div>
              <div className="cell-actions">
                {advance.status === "Pending" ? (
                  <>
                    <button className="ghost-button" onClick={() => { decideCashAdvance(advance.id, "Approved"); toast("success", "Cash advance approved."); }}>Approve</button>
                    <button className="ghost-button ghost-danger" onClick={() => { decideCashAdvance(advance.id, "Rejected"); toast("warning", "Cash advance rejected."); }}>Reject</button>
                  </>
                ) : <Pill tone={advance.status === "Rejected" ? "red" : "green"}>{advance.status}</Pill>}
              </div>
            </div>
          ))}
        </Panel>
      </div>

      <Panel title="Absences" description="Days marked absent in attendance" padded={false}>
        {absences.length === 0 ? <EmptyState icon="✓" title="No absences" text="This employee has no recorded absences." /> : (
          <DataTable columns={["Date", "Schedule", "Status"]}>
            {absences.map((item) => <tr key={item.id}><td>{formatDate(item.date)}</td><td>{item.scheduleIn} – {item.scheduleOut}</td><td><Pill tone="red">Absent</Pill></td></tr>)}
          </DataTable>
        )}
      </Panel>

      <Modal open={leaveOpen} title="File leave" description={employee?.name} onClose={() => setLeaveOpen(false)} footer={
        <>
          <button className="secondary-button" onClick={() => setLeaveOpen(false)}>Cancel</button>
          <button className="primary-button" onClick={() => {
            if (!employee || leaveDraft.reason.trim().length < 4) { toast("warning", "Add a reason."); return; }
            createLeave({ employeeId: employee.id, leaveType: leaveDraft.leaveType, startsOn: leaveDraft.startsOn, endsOn: leaveDraft.endsOn, reason: leaveDraft.reason.trim() });
            toast("success", "Leave filed."); setLeaveOpen(false);
          }}>Submit</button>
        </>
      }>
        <div className="form-grid">
          <Field label="Leave type"><select value={leaveDraft.leaveType} onChange={(e) => setLeaveDraft({ ...leaveDraft, leaveType: e.target.value as LeaveRequest["leaveType"] })}><option>Vacation</option><option>Sick</option><option>Emergency</option><option>Unpaid</option></select></Field>
          <Field label="From"><input type="date" value={leaveDraft.startsOn} onChange={(e) => setLeaveDraft({ ...leaveDraft, startsOn: e.target.value })} /></Field>
          <Field label="To"><input type="date" value={leaveDraft.endsOn} onChange={(e) => setLeaveDraft({ ...leaveDraft, endsOn: e.target.value })} /></Field>
          <Field label="Reason" full><textarea rows={3} value={leaveDraft.reason} onChange={(e) => setLeaveDraft({ ...leaveDraft, reason: e.target.value })} /></Field>
        </div>
      </Modal>

      <Modal open={advanceOpen} title="File cash advance" description={employee?.name} onClose={() => setAdvanceOpen(false)} footer={
        <>
          <button className="secondary-button" onClick={() => setAdvanceOpen(false)}>Cancel</button>
          <button className="primary-button" onClick={() => {
            if (!employee || !(toC(advanceDraft.amount) > 0) || advanceDraft.reason.trim().length < 4) { toast("warning", "Enter an amount and reason."); return; }
            createCashAdvance({ employeeId: employee.id, amountCentavos: toC(advanceDraft.amount), reason: advanceDraft.reason.trim() });
            toast("success", "Cash advance filed."); setAdvanceOpen(false);
          }}>Submit</button>
        </>
      }>
        <div className="form-grid">
          <Field label="Amount (₱)*"><input type="number" min={0} value={advanceDraft.amount} onChange={(e) => setAdvanceDraft({ ...advanceDraft, amount: e.target.value })} /></Field>
          <Field label="Reason*" full><textarea rows={3} value={advanceDraft.reason} onChange={(e) => setAdvanceDraft({ ...advanceDraft, reason: e.target.value })} /></Field>
        </div>
      </Modal>
    </>
  );
}

/** Payroll periods + a payslip generator per employee. */
function HrPayrollTab() {
  const { state, advancePayroll } = useSystem();
  const toast = useToast();
  const [payslipFor, setPayslipFor] = useState<Employee | null>(null);

  return (
    <>
      <Panel title="Payroll periods" description="Draft → review → finalize; finalizing posts a Paid payroll expense">
        <div className="panel-padded">
          {state.payrollPeriods.map((period) => {
            const gross = period.items.reduce((sum, item) => sum + item.grossCentavos, 0);
            const deductions = period.items.reduce((sum, item) => sum + item.deductionCentavos, 0);
            return (
              <div key={period.id} className="payroll-card">
                <div><strong>{period.periodNumber}</strong><small>{formatDateRange(period.startsOn, period.endsOn)} · pay date {formatDate(period.payDate)} · {period.items.length} employees</small></div>
                <div className="payroll-figures">
                  <span>Gross <strong>{pesos(gross)}</strong></span>
                  <span>Deductions <strong>{pesos(deductions)}</strong></span>
                  <span>Net <strong className="value-good">{pesos(gross - deductions)}</strong></span>
                </div>
                <div className="payroll-actions">
                  <Pill tone={period.status === "Finalized" ? "green" : period.status === "For review" ? "blue" : "amber"}>{period.status}</Pill>
                  {period.status !== "Finalized" && (
                    <button className="ghost-button" onClick={() => { advancePayroll(period.id); toast("success", period.status === "Draft" ? "Payroll sent for review." : "Payroll finalized."); }}>
                      {period.status === "Draft" ? "Send for review" : "Finalize"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel title="Payslips" description="Generate a payslip per employee" padded={false}>
        <DataTable columns={["Employee", "Basic", "Allowance", "Deductions", "Net", ""]} minWidth={900}>
          {state.employees.filter((item) => item.status === "Active").map((employee) => {
            const basic = employee.basicSalaryCentavos ?? employee.monthlyRateCentavos;
            const allowance = employee.allowanceCentavos ?? 0;
            const deductions = (employee.sssCentavos ?? 0) + (employee.pagibigCentavos ?? 0) + (employee.philhealthCentavos ?? 0);
            const net = basic + allowance - deductions;
            return (
              <tr key={employee.id}>
                <td><strong>{employee.name}</strong><small>{employee.employeeNumber}</small></td>
                <td>{pesos(basic)}</td>
                <td>{pesos(allowance)}</td>
                <td>{pesos(deductions)}</td>
                <td><strong className="value-good">{pesos(net)}</strong></td>
                <td className="cell-actions"><button className="ghost-button" onClick={() => setPayslipFor(employee)}>Payslip</button></td>
              </tr>
            );
          })}
        </DataTable>
      </Panel>

      {payslipFor && <PayslipModal employee={payslipFor} advances={state.cashAdvances.filter((a) => a.employeeId === payslipFor.id && a.status === "Approved")} onClose={() => setPayslipFor(null)} />}
    </>
  );
}

/** 13th-month calculator: monthly basic × months employed this year ÷ 12. */
function HrThirteenthTab() {
  const { state } = useSystem();
  const toast = useToast();
  const year = new Date().getFullYear();
  const monthsThisYear = (dateHired?: string) => {
    if (!dateHired) return 12;
    const hired = new Date(dateHired);
    const startMonth = hired.getFullYear() < year ? 0 : hired.getMonth();
    return Math.max(0, 12 - startMonth);
  };
  const rows = state.employees.filter((item) => item.status === "Active").map((employee) => {
    const basic = employee.basicSalaryCentavos ?? employee.monthlyRateCentavos;
    const months = monthsThisYear(employee.dateHired);
    const thirteenth = Math.round((basic * months) / 12);
    return { employee, basic, months, thirteenth };
  });
  const total = rows.reduce((sum, row) => sum + row.thirteenth, 0);

  return (
    <Panel
      title={`13th-month pay — ${year}`}
      description="Monthly basic × months employed this year ÷ 12"
      padded={false}
      action={
        <button className="secondary-button" onClick={() => {
          downloadCsv(`13th-month-${year}.csv`, [["Employee", "Basic (monthly)", "Months", "13th month"], ...rows.map((r) => [r.employee.name, (r.basic / 100).toFixed(2), r.months, (r.thirteenth / 100).toFixed(2)]), [], ["Total", "", "", (total / 100).toFixed(2)]]);
          toast("success", "13th-month schedule exported.");
        }}>Download CSV</button>
      }
    >
      <DataTable columns={["Employee", "Basic (monthly)", "Months this year", "13th-month pay"]} minWidth={820}>
        {rows.map((row) => (
          <tr key={row.employee.id}>
            <td><strong>{row.employee.name}</strong><small>{row.employee.employeeNumber}</small></td>
            <td>{pesos(row.basic)}</td>
            <td>{row.months}</td>
            <td><strong className="value-good">{pesos(row.thirteenth)}</strong></td>
          </tr>
        ))}
      </DataTable>
      <div className="summary-total" style={{ padding: "12px 20px" }}><span>Total 13th-month liability</span><strong>{pesos(total)}</strong></div>
    </Panel>
  );
}

function PayslipModal({ employee, advances, onClose }: { employee: Employee; advances: CashAdvance[]; onClose: () => void }) {
  const toast = useToast();
  const [building, setBuilding] = useState(false);
  const basic = employee.basicSalaryCentavos ?? employee.monthlyRateCentavos;
  const allowance = employee.allowanceCentavos ?? 0;
  const advanceTotal = advances.reduce((sum, a) => sum + a.amountCentavos, 0);
  const earnings = [{ label: "Basic salary", amountCentavos: basic }, { label: "Allowance", amountCentavos: allowance }];
  const deductions = [
    { label: "SSS", amountCentavos: employee.sssCentavos ?? 0 },
    { label: "Pag-IBIG", amountCentavos: employee.pagibigCentavos ?? 0 },
    { label: "PhilHealth", amountCentavos: employee.philhealthCentavos ?? 0 },
    ...(advanceTotal > 0 ? [{ label: "Cash advance", amountCentavos: advanceTotal }] : []),
  ];
  const grossCentavos = basic + allowance;
  const totalDeductionsCentavos = deductions.reduce((sum, d) => sum + d.amountCentavos, 0);
  const netCentavos = grossCentavos - totalDeductionsCentavos;

  async function downloadPdf() {
    setBuilding(true);
    try {
      let logoBytes: Uint8Array | undefined;
      try { logoBytes = new Uint8Array(await (await fetch("/new-wave-logo.png")).arrayBuffer()); } catch { /* optional */ }
      const bytes = await createPayslipPdf({
        employeeNumber: employee.employeeNumber, employeeName: employee.name, position: employee.position,
        payFrequency: employee.payFrequency ?? "", dateHired: employee.dateHired ? formatDate(employee.dateHired) : "",
        period: `Current · ${employee.payFrequency ?? ""}`, payDate: formatDate(todayIso()),
        earnings, deductions, grossCentavos, totalDeductionsCentavos, netCentavos, preparedBy: "HR", logoBytes,
      });
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "application/pdf" }));
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${employee.employeeNumber}-payslip.pdf`; anchor.click(); URL.revokeObjectURL(url);
    } catch { toast("warning", "Could not generate the payslip."); } finally { setBuilding(false); }
  }

  return (
    <Modal open title="Payslip" description={`${employee.employeeNumber} · ${employee.name}`} onClose={onClose} wide footer={
      <>
        <button className="secondary-button" onClick={onClose}>Close</button>
        <button className="primary-button" onClick={downloadPdf} disabled={building}>{building ? "Generating…" : "Download PDF"}</button>
      </>
    }>
      <div className="slip-grid">
        <div><span>Name</span><strong>{employee.name}</strong></div>
        <div><span>Position</span><strong>{employee.position}</strong></div>
        <div><span>Pay frequency</span><strong>{employee.payFrequency ?? "—"}</strong></div>
        <div><span>Date hired</span><strong>{employee.dateHired ? formatDate(employee.dateHired) : "—"}</strong></div>
      </div>
      <h3 className="drawer-section">Earnings</h3>
      <div className="ledger-list">
        {earnings.map((e) => <div key={e.label} className="ledger-row ledger-charge"><div><strong>{e.label}</strong></div><div className="ledger-amount"><strong>{pesos(e.amountCentavos)}</strong></div></div>)}
      </div>
      <h3 className="drawer-section">Deductions</h3>
      <div className="ledger-list">
        {deductions.map((d) => <div key={d.label} className="ledger-row ledger-payment"><div><strong>{d.label}</strong></div><div className="ledger-amount"><strong>−{pesos(d.amountCentavos)}</strong></div></div>)}
      </div>
      <div className="summary-total"><span>Net pay</span><strong>{pesos(netCentavos)}</strong></div>
    </Modal>
  );
}

/* ----------------------------------------------------------------- reports */


export function ReportsModule({ role }: { role: Role }) {
  const { state, views } = useSystem();
  const toast = useToast();
  const all = views();
  const [openingPesos, setOpeningPesos] = useState("");
  const showCashierReport = role === "Cashier" || role === "Accounting" || role === "Admin";

  // Every report is bound to a period. An unbounded export is what makes two
  // people quoting "the collections report" disagree about the number. The
  // Cashier's reports (incl. the activity report) default to the current date.
  const [preset, setPreset] = useState<ReportRangePreset>(role === "Cashier" ? "Today" : "This month");
  const [custom, setCustom] = useState<DateRange>({ from: todayIso(), to: todayIso() });
  const range = resolveRange(preset, todayIso(), custom);
  const inRange = (value?: string | null) => withinRange(value, range);

  // Cashier opening/closing figures for the period. Received = verified payments
  // across every channel; disbursement = cash out (refunds/reversals + paid or
  // approved expense vouchers). Closing = opening + received − disbursement.
  const openingCentavos = Math.max(0, Math.round(Number(openingPesos || "0") * 100));
  const receivedCentavos = state.ledger
    .filter((entry) => entry.type === "payment" && entry.verification === "Verified" && inRange(entry.recordedAt))
    .reduce((sum, entry) => sum + entry.amountCentavos, 0);
  const disbursementCentavos =
    state.ledger
      .filter((entry) => (entry.type === "refund" || entry.type === "reversal") && inRange(entry.recordedAt))
      .reduce((sum, entry) => sum + entry.amountCentavos, 0) +
    state.expenses
      .filter((expense) => (expense.status === "Paid" || expense.status === "Approved") && inRange(expense.decidedAt ?? expense.createdAt))
      .reduce((sum, expense) => sum + expense.amountCentavos, 0);
  const closingCentavos = openingCentavos + receivedCentavos - disbursementCentavos;

  const enrollmentsInPeriod = all.filter((item) => inRange(item.enrollment.createdAt));
  const inHouseEnrollments = enrollmentsInPeriod.filter((item) => !item.enrollment.courseCode.startsWith("endorsed:"));
  const endorsedEnrollments = enrollmentsInPeriod
    .filter((item) => item.enrollment.courseCode.startsWith("endorsed:"))
    .map((item) => {
      const offer = state.partnerOffers.find((entry) => `endorsed:${entry.id}` === item.enrollment.courseCode);
      return { item, rebateCentavos: offer?.rebateCentavos ?? 0 };
    });
  const money = (centavos: number) => (centavos / 100).toFixed(2);

  const cashierReportRows = () => [
    ["Cashier Opening/Closing Report", describeRange(range)],
    [],
    ["Opening balance", money(openingCentavos)],
    ["Total received (all channels)", money(receivedCentavos)],
    ["Total disbursement (all channels)", money(disbursementCentavos)],
    ["Closing balance", money(closingCentavos)],
    [],
    ["New Wave trainee enrollments"],
    ["Name", "Course", "Amount"],
    ...inHouseEnrollments.map((item) => [fullName(item.trainee), item.enrollment.courseName, money(item.dueCentavos)]),
    [],
    ["Endorsed trainee enrollments"],
    ["Name", "Course", "Amount", "Rebate"],
    ...endorsedEnrollments.map(({ item, rebateCentavos }) => [
      fullName(item.trainee),
      item.enrollment.courseName,
      money(item.dueCentavos),
      money(rebateCentavos),
    ]),
  ];

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

      {showCashierReport && (
        <Panel
          title="Cashier opening / closing"
          description={`Received, disbursed, and enrollment breakdown for ${describeRange(range)}.`}
          action={
            <button
              className="secondary-button"
              onClick={() => {
                downloadCsv(`cashier-opening-closing-${range.from}-to-${range.to}.csv`, cashierReportRows());
                toast("success", `Cashier report exported for ${describeRange(range)}.`);
              }}
            >
              Download CSV
            </button>
          }
        >
          <div className="cashier-report">
            <div className="cashier-report-figures">
              <label className="inline-field">
                <span>Opening balance (₱)</span>
                <input
                  type="number"
                  min={0}
                  step="1"
                  value={openingPesos}
                  placeholder="0.00"
                  onChange={(event) => setOpeningPesos(event.target.value)}
                />
              </label>
              <div className="stat-grid stat-grid-4">
                <StatCard label="Opening balance" value={pesos(openingCentavos)} note="Cashier-reported float" tone={0} icon="₱" />
                <StatCard label="Total received" value={pesos(receivedCentavos)} note="All channels · verified" tone={2} icon="↧" />
                <StatCard label="Total disbursement" value={pesos(disbursementCentavos)} note="Refunds + paid vouchers" tone={5} icon="↥" />
                <StatCard label="Closing balance" value={pesos(closingCentavos)} note="Opening + received − disbursed" tone={3} icon="◈" />
              </div>
            </div>

            <h3 className="drawer-section">New Wave trainee enrollments</h3>
            {inHouseEnrollments.length === 0 ? (
              <EmptyState title="No New Wave enrollments in this period" text="Widen the reporting period to see enrollments." />
            ) : (
              <DataTable columns={["Name", "Course", "Amount"]}>
                {inHouseEnrollments.map((item) => (
                  <tr key={item.enrollment.id}>
                    <td>{fullName(item.trainee)}</td>
                    <td>{item.enrollment.courseName}</td>
                    <td><strong>{pesos(item.dueCentavos)}</strong></td>
                  </tr>
                ))}
              </DataTable>
            )}

            <h3 className="drawer-section">Endorsed trainee enrollments</h3>
            {endorsedEnrollments.length === 0 ? (
              <EmptyState title="No endorsed enrollments in this period" text="Endorsed enrollments recorded by the cashier will appear here." />
            ) : (
              <DataTable columns={["Name", "Course", "Amount", "Rebate"]}>
                {endorsedEnrollments.map(({ item, rebateCentavos }) => (
                  <tr key={item.enrollment.id}>
                    <td>{fullName(item.trainee)}</td>
                    <td>{item.enrollment.courseName}</td>
                    <td><strong>{pesos(item.dueCentavos)}</strong></td>
                    <td className="value-good">{pesos(rebateCentavos)}</td>
                  </tr>
                ))}
              </DataTable>
            )}
          </div>
        </Panel>
      )}

      {showCashierReport && (() => {
        const salesIn = (from: string, to: string) => state.ledger.filter((e) => e.type === "payment" && e.verification === "Verified" && e.recordedAt.slice(0, 10) >= from && e.recordedAt.slice(0, 10) <= to).reduce((s, e) => s + e.amountCentavos, 0);
        const disbIn = (from: string, to: string) =>
          state.ledger.filter((e) => (e.type === "refund" || e.type === "reversal") && e.recordedAt.slice(0, 10) >= from && e.recordedAt.slice(0, 10) <= to).reduce((s, e) => s + e.amountCentavos, 0) +
          state.expenses.filter((x) => (x.status === "Paid" || x.status === "Approved") && (x.decidedAt ?? x.createdAt).slice(0, 10) >= from && (x.decidedAt ?? x.createdAt).slice(0, 10) <= to).reduce((s, x) => s + x.amountCentavos, 0);
        const rangeSales = salesIn(range.from, range.to);
        const rangeDisb = disbIn(range.from, range.to);
        const months = [0, 1, 2, 3].map((offset) => {
          const d = new Date();
          d.setDate(1);
          d.setMonth(d.getMonth() - offset);
          const y = d.getFullYear();
          const m = d.getMonth();
          const from = `${y}-${String(m + 1).padStart(2, "0")}-01`;
          const to = new Date(y, m + 1, 0).toISOString().slice(0, 10);
          const s = salesIn(from, to);
          const dd = disbIn(from, to);
          return { label: new Intl.DateTimeFormat("en-PH", { month: "long", year: "numeric" }).format(d), sales: s, disb: dd, net: s - dd };
        });
        return (
          <Panel
            title="Sales, disbursements & earnings"
            description={`Selected period ${describeRange(range)} · month-over-month trend`}
            action={
              <button className="secondary-button" onClick={() => {
                downloadCsv(`earnings-overview-${range.from}.csv`, [["Month", "Sales", "Disbursements", "Net earnings"], ...months.map((r) => [r.label, (r.sales / 100).toFixed(2), (r.disb / 100).toFixed(2), (r.net / 100).toFixed(2)])]);
                toast("success", "Earnings overview exported.");
              }}>Download CSV</button>
            }
          >
            <div className="summary-panel">
              <div className="stat-grid stat-grid-3">
                <StatCard label="Total sales" value={pesos(rangeSales)} note="Verified collections" tone={2} icon="₱" />
                <StatCard label="Total disbursements" value={pesos(rangeDisb)} note="Refunds + expenses" tone={5} icon="↥" />
                <StatCard label="Net earnings" value={pesos(rangeSales - rangeDisb)} note={rangeSales - rangeDisb >= 0 ? "Earning this period" : "Loss this period"} tone={rangeSales - rangeDisb >= 0 ? 3 : 1} icon="◈" />
              </div>
              <h3 className="drawer-section">Month-over-month</h3>
              <DataTable columns={["Month", "Sales", "Disbursements", "Net earnings"]}>
                {months.map((r) => (
                  <tr key={r.label}>
                    <td>{r.label}</td>
                    <td>{pesos(r.sales)}</td>
                    <td>{pesos(r.disb)}</td>
                    <td><strong className={r.net >= 0 ? "value-good" : "value-danger"}>{pesos(r.net)}</strong></td>
                  </tr>
                ))}
              </DataTable>
            </div>
          </Panel>
        );
      })()}

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
