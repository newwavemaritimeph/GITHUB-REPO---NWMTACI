"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  derivePaymentStatus,
  isCertificateEligible,
  type AttendanceStatus,
} from "@/lib/domain";
import { chooseSurvivor, findContactDuplicates, findSrnDuplicates, mergeInto } from "@/lib/trainee-identity";
import { automaticEndDate, courseDays, monthlyBatchStarts } from "@/lib/scheduling";
import { createSeedState, SYSTEM_VERSION } from "./seed";
import type {
  ActivityEntry,
  Applicant,
  AttendanceSession,
  Batch,
  Certificate,
  ChangeRequest,
  ConsentType,
  Course,
  CourseSelection,
  Announcement,
  Enrollment,
  EnrollmentView,
  Expense,
  CashAdvance,
  Classroom,
  Employee,
  ExpenseCategory,
  MonthlyPayable,
  HrAttendanceRecord,
  Instructor,
  LeaveRequest,
  LedgerEntry,
  MarketingAgency,
  OtherCharge,
  PartnerOfferRecord,
  PaymentChannel,
  RegistrationLifecycle,
  RegistrationStatus,
  RegistrationSubmission,
  RequestType,
  SelectionStatus,
  Settings,
  Stage,
  SystemState,
  Trainee,
} from "./types";

const STORAGE_KEY = "new-wave-system-v11";

/* ------------------------------------------------------------------ helpers */

function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`;
}

function nextReference(existing: string[], prefix: string) {
  const year = new Date().getFullYear();
  const highest = existing.reduce((top, value) => {
    const match = new RegExp(`^${prefix}-\\d{4}-(\\d{6})$`).exec(value);
    return match ? Math.max(top, Number(match[1])) : top;
  }, 0);
  return `${prefix}-${year}-${String(highest + 1).padStart(6, "0")}`;
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function fullName(person: { firstName: string; middleName?: string; lastName: string }) {
  return `${person.firstName} ${person.middleName ?? ""} ${person.lastName}`.replace(/\s+/g, " ").trim();
}

export function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function formatDate(value?: string) {
  if (!value) return "—";
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

export function formatDateRange(from?: string, to?: string) {
  if (!from) return "—";
  if (!to || to === from) return formatDate(from);
  return `${formatDate(from)} – ${formatDate(to)}`;
}

export function formatTime(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit" }).format(date);
}

export function formatDateTime(value?: string) {
  if (!value) return "—";
  return `${formatDate(value)} · ${formatTime(value)}`;
}

/* --------------------------------------------------------------- reconciler */

function batchSeatCount(state: SystemState, batchId: string) {
  return state.enrollments.filter(
    (enrollment) => enrollment.batchId === batchId && enrollment.status !== "Cancelled",
  ).length;
}

function sessionsOfBatch(state: SystemState, batchId: string) {
  return state.attendanceSessions
    .filter((session) => session.batchId === batchId)
    .sort((left, right) => left.dayNumber - right.dayNumber);
}

function certificateEligibility(state: SystemState, enrollment: Enrollment) {
  const sessions = sessionsOfBatch(state, enrollment.batchId);
  const records = sessions.map((session) =>
    state.attendanceRecords.find(
      (record) => record.sessionId === session.id && record.enrollmentId === enrollment.id,
    ),
  );
  const attendance = records.filter(Boolean).map((record) => record!.status) as AttendanceStatus[];
  const everySessionRecorded = sessions.length > 0 && records.every(Boolean);
  // Completion is a manual staff decision (markTrainingComplete) taken off
  // verified printed attendance — no trainee uploads, no QR (masterplan T.2/T.3/T.18).
  const trainingComplete = Boolean(enrollment.completedAt);
  return {
    sessions,
    attendance,
    eligible: isCertificateEligible({
      attendance: trainingComplete && everySessionRecorded ? attendance : [],
      instructorSubmitted: trainingComplete && sessions.length > 0 && sessions.every((session) => session.state === "Submitted" || session.state === "Verified"),
      operationsVerified: trainingComplete && sessions.length > 0 && sessions.every((session) => session.state === "Verified"),
      templateActive: state.settings.certificateTemplateApproved && state.settings.certificateIssuanceEnabled,
      certificateNumberAvailable: true,
      legalNameConfirmed: true,
    }),
    attendanceComplete:
      everySessionRecorded &&
      attendance.every((status) => ["Present", "Late", "Make-Up Completed"].includes(status)),
  };
}

function certificateBlockReason(state: SystemState, enrollment: Enrollment) {
  const { sessions, attendanceComplete } = certificateEligibility(state, enrollment);
  if (sessions.length === 0) return "No attendance sessions scheduled yet.";
  if (!sessions.every((session) => session.state === "Verified")) return "Training Operations has not verified the printed attendance.";
  if (!attendanceComplete) return "Attendance is incomplete or has make-up requirements.";
  if (!enrollment.completedAt) return "Training has not been marked complete by staff.";
  if (!state.settings.certificateTemplateApproved) return "No approved certificate template.";
  if (!state.settings.certificateIssuanceEnabled) return "Certificate issuance is switched off in Settings.";
  return undefined;
}

/** Fields backfilled onto a survivor when a duplicate is folded in. */
const MERGE_FIELDS = [
  "middleName", "suffix", "srn", "address", "company", "rank", "facebookLink", "placeOfBirth",
  "gender", "nationality", "civilStatus", "seafarerStatus",
  "emergencyContactName", "emergencyContactRelation", "emergencyContactMobile",
] as const;

/** Folds `duplicate` into `survivor`: backfills blanks, moves the duplicate's
 * enrollments and submissions onto the survivor, and tombstones the duplicate. */
function foldTrainee(draft: SystemState, survivor: Trainee, duplicate: Trainee) {
  if (survivor.id === duplicate.id) return;
  Object.assign(survivor, mergeInto(survivor as unknown as Record<string, unknown>, duplicate as unknown as Record<string, unknown>, MERGE_FIELDS as unknown as string[]));
  draft.enrollments.forEach((item) => { if (item.traineeId === duplicate.id) item.traineeId = survivor.id; });
  draft.submissions.forEach((item) => { if (item.traineeId === duplicate.id) item.traineeId = survivor.id; });
  draft.trainees = draft.trainees.filter((item) => item.id !== duplicate.id);
}

/** Normalised exact-name key (first+middle+last) for duplicate grouping. */
function nameKey(trainee: Trainee): string {
  return [trainee.firstName, trainee.middleName ?? "", trainee.lastName]
    .map((part) => part.trim().toLowerCase().replace(/\s+/g, " "))
    .join("|");
}

/**
 * Idempotent sweep that automatically merges duplicate trainees so no manual
 * review is left: records sharing a normalised SRN are always folded together,
 * and records with an identical full name are folded only when they also share a
 * contact (email or mobile), never on name alone. The earliest-created record
 * survives so the trainee keeps their original number and history.
 */
function autoMergeDuplicates(draft: SystemState) {
  let changed = true;
  // Loop until stable — folding can expose transitive matches (A≡B, B≡C).
  while (changed) {
    changed = false;
    for (const trainee of draft.trainees) {
      // SRN matches: authoritative, merge unconditionally.
      const srnMatches = findSrnDuplicates(trainee, draft.trainees);
      // Same exact name AND a shared contact.
      const nameMatches = draft.trainees.filter(
        (other) =>
          other.id !== trainee.id &&
          nameKey(other) === nameKey(trainee) &&
          findContactDuplicates(trainee, [other]).length > 0,
      );
      const group = [trainee, ...srnMatches, ...nameMatches];
      const unique = Array.from(new Map(group.map((item) => [item.id, item])).values());
      if (unique.length < 2) continue;
      const survivor = chooseSurvivor(unique) ?? unique[0];
      unique.filter((item) => item.id !== survivor.id).forEach((duplicate) => foldTrainee(draft, survivor, duplicate));
      changed = true;
      break; // restart the scan after mutating the list
    }
  }
}

/**
 * Returns the trainee for a submission, creating one from the applicant snapshot
 * on first approval and folding any SRN duplicates into the earliest record so a
 * seafarer keeps one trainee number. Reuses the identity helpers.
 */
function ensureTraineeForSubmission(draft: SystemState, submission: RegistrationSubmission): Trainee {
  const applicant = submission.applicant;
  const srnMatches = applicant.srn
    ? findSrnDuplicates({ id: "incoming", srn: applicant.srn }, draft.trainees)
    : [];
  let trainee =
    (srnMatches.length ? chooseSurvivor(srnMatches) : undefined) ??
    (submission.traineeId ? draft.trainees.find((item) => item.id === submission.traineeId) : undefined) ??
    draft.trainees.find((item) => item.email.toLowerCase() === applicant.email.toLowerCase());

  if (trainee && srnMatches.length > 1) {
    const survivor = trainee;
    srnMatches
      .filter((item) => item.id !== survivor.id)
      .forEach((duplicate) => {
        Object.assign(
          survivor,
          mergeInto(survivor, duplicate, ["address", "srn", "suffix", "placeOfBirth", "rank", "company", "gender", "nationality", "civilStatus", "seafarerStatus", "emergencyContactName", "emergencyContactRelation", "emergencyContactMobile"]),
        );
        draft.enrollments.filter((item) => item.traineeId === duplicate.id).forEach((item) => {
          item.traineeId = survivor.id;
        });
        duplicate.mergedIntoTraineeId = survivor.id;
        duplicate.mergedAt = new Date().toISOString();
      });
  }

  if (!trainee) {
    const highest = draft.trainees.reduce((top, item) => {
      const match = /^NWM-(\d{6})$/.exec(item.traineeNumber);
      return match ? Math.max(top, Number(match[1])) : top;
    }, 0);
    trainee = {
      id: uid("t"),
      traineeNumber: `NWM-${String(highest + 1).padStart(6, "0")}`,
      firstName: applicant.firstName,
      middleName: applicant.middleName,
      lastName: applicant.lastName,
      suffix: applicant.suffix,
      birthDate: applicant.birthDate,
      placeOfBirth: undefined,
      gender: applicant.gender,
      nationality: applicant.nationality,
      civilStatus: applicant.civilStatus,
      seafarerStatus: applicant.seafarerStatus,
      email: applicant.email,
      mobile: applicant.mobile,
      address: applicant.address,
      srn: applicant.srn,
      rank: applicant.rank,
      company: applicant.company,
      emergencyContactName: applicant.emergencyContactName,
      emergencyContactRelation: applicant.emergencyContactRelation,
      emergencyContactMobile: applicant.emergencyContactMobile,
      createdAt: new Date().toISOString(),
    };
    draft.trainees.push(trainee);
  }
  submission.traineeId = trainee.id;
  return trainee;
}

/** Recomputes a submission's overall status and public message from its selections. */
function recomputeSubmissionStatus(draft: SystemState, submissionId: string) {
  const submission = draft.submissions.find((item) => item.id === submissionId);
  if (!submission) return;
  const selections = draft.courseSelections.filter((item) => item.submissionId === submissionId);
  const approved = selections.filter((item) => item.status === "Approved").length;
  const closed = selections.filter((item) => item.status === "Rejected" || item.status === "Cancelled").length;
  const total = selections.length;
  if (total > 0 && approved === total) {
    submission.status = "Approved";
    submission.publicStatusMessage = "Your enrollment records have been confirmed.";
  } else if (approved > 0) {
    submission.status = "Partially Approved";
    submission.publicStatusMessage = "Some of your selected courses have been confirmed; others are still being reviewed.";
  } else if (total > 0 && closed === total) {
    submission.status = "Rejected";
    submission.publicStatusMessage = "Your registration could not be processed. Please contact New Wave.";
  } else if (submission.status !== "Possible Duplicate") {
    submission.status = "Under Review";
    submission.publicStatusMessage = "Your selected courses are being reviewed.";
  }
}

/** Keeps derived records (certificates, batch status, seat counts) consistent. */
function reconcile(state: SystemState): SystemState {
  // Collapse any duplicate trainees automatically so no manual review is left.
  autoMergeDuplicates(state);

  // Auto-send training instructions once an enrollment is paid or partially paid.
  const paidOf = (enrollmentId: string) => {
    const entries = state.ledger.filter((entry) => entry.enrollmentId === enrollmentId && entry.valid);
    const paid = entries.filter((entry) => entry.type === "payment" && entry.verification === "Verified").reduce((sum, entry) => sum + entry.amountCentavos, 0);
    const out = entries.filter((entry) => entry.type === "refund" || entry.type === "reversal").reduce((sum, entry) => sum + entry.amountCentavos, 0);
    return paid - out;
  };
  state.enrollments.forEach((enrollment) => {
    if (enrollment.status === "Cancelled" || enrollment.instructionsSentAt) return;
    if (paidOf(enrollment.id) > 0) enrollment.instructionsSentAt = new Date().toISOString();
  });

  const batches: Batch[] = state.batches.map((batch) => {
    const seats = batchSeatCount(state, batch.id);
    if (batch.status === "Cancelled" || batch.status === "Draft") return batch;
    const today = todayIso();
    let status = batch.status;
    if (batch.endsOn < today) status = "Completed";
    else if (batch.startsOn <= today) status = "Ongoing";
    else status = seats >= batch.capacity ? "Full" : "Open";
    return status === batch.status ? batch : { ...batch, status };
  });

  const certificates: Certificate[] = [...state.certificates];
  state.enrollments
    .filter((enrollment) => enrollment.status !== "Cancelled")
    .forEach((enrollment) => {
      const index = certificates.findIndex((item) => item.enrollmentId === enrollment.id);
      const existing = index >= 0 ? certificates[index] : undefined;
      if (existing && (existing.status === "Released" || existing.status === "Cancelled")) return;
      const { eligible } = certificateEligibility(state, enrollment);
      const blockedReason = certificateBlockReason(state, enrollment);
      const status: Certificate["status"] =
        existing?.status === "Printed" ? "Printed" : eligible ? "Ready to Print" : "Pending Attendance";
      const next: Certificate = {
        id: existing?.id ?? uid("cert"),
        enrollmentId: enrollment.id,
        status,
        certificateNumber: existing?.certificateNumber,
        printedAt: existing?.printedAt,
        releasedAt: existing?.releasedAt,
        releasedTo: existing?.releasedTo,
        reprintCount: existing?.reprintCount ?? 0,
        blockedReason: status === "Pending Attendance" ? blockedReason : undefined,
        updatedAt: new Date().toISOString(),
      };
      if (index >= 0) certificates[index] = next;
      else certificates.push(next);
    });

  return { ...state, batches, certificates };
}

/* ------------------------------------------------------------------ context */

type SelectionInput = { courseCode: string; courseName: string; batchId: string };
type ConsentInput = { consentType: ConsentType; version: string; textSnapshot: string };
type SubmitRegistrationInput = {
  applicant: Applicant;
  selections: SelectionInput[]; // 1..5
  consents: ConsentInput[];
  sessionRef?: string;
};

type PaymentInput = {
  enrollmentId: string;
  amountCentavos: number;
  method: NonNullable<LedgerEntry["method"]>;
  receivingAccount?: string;
  referenceNumber?: string;
  proofFileName?: string;
  description?: string;
  needsVerification?: boolean;
  recordedBy?: string;
};

type SystemContextValue = {
  ready: boolean;
  state: SystemState;
  actor: string;
  setActor: (actor: string) => void;
  /* registration + enrollment */
  submitRegistration: (input: SubmitRegistrationInput) => RegistrationSubmission;
  updateSubmissionStatus: (id: string, status: RegistrationStatus, remarks?: string) => void;
  reviewSelection: (id: string, status: SelectionStatus, remark?: string) => void;
  approveSelection: (id: string) => Enrollment | undefined;
  createEnrollment: (input: { traineeId: string; batchId: string }) => Enrollment | undefined;
  createEndorsedEnrollment: (input: { traineeId: string; offerId: string }) => Enrollment | undefined;
  changeEnrollmentBatch: (enrollmentId: string, newBatchId: string) => void;
  setRegistrationStatus: (enrollmentId: string, status: RegistrationLifecycle) => void;
  generateAdmissionSlip: (enrollmentId: string, input: { officer: string; cashier: string }) => void;
  cancelEnrollment: (id: string, reason: string) => void;
  createTrainee: (input: Omit<Trainee, "id" | "traineeNumber" | "createdAt">) => Trainee;
  setTraineeFacebook: (id: string, facebookLink: string) => void;
  mergeTrainees: (survivorId: string, duplicateId: string) => void;
  /* money */
  recordPayment: (input: PaymentInput) => LedgerEntry | undefined;
  setPaymentVerification: (id: string, verification: "Verified" | "Rejected") => void;
  addLedgerEntry: (input: { enrollmentId: string; type: LedgerEntry["type"]; amountCentavos: number; description: string }) => void;
  /* catalog administration */
  addCourse: (input: Omit<Course, "id" | "active">) => Course;
  updateCourse: (id: string, patch: Partial<Omit<Course, "id">>) => void;
  setCourseActive: (id: string, active: boolean) => void;
  addPartnerOffer: (input: Omit<PartnerOfferRecord, "id" | "active">) => PartnerOfferRecord;
  updatePartnerOffer: (id: string, patch: Partial<Omit<PartnerOfferRecord, "id">>) => void;
  setPartnerOfferActive: (id: string, active: boolean) => void;
  addPaymentChannel: (input: Omit<PaymentChannel, "id" | "active">) => PaymentChannel;
  updatePaymentChannel: (id: string, patch: Partial<Omit<PaymentChannel, "id">>) => void;
  setPaymentChannelActive: (id: string, active: boolean) => void;
  addOtherCharge: (input: Omit<OtherCharge, "id" | "active">) => OtherCharge;
  updateOtherCharge: (id: string, patch: Partial<Omit<OtherCharge, "id">>) => void;
  setOtherChargeActive: (id: string, active: boolean) => void;
  addExpenseCategory: (input: Omit<ExpenseCategory, "id" | "active">) => ExpenseCategory;
  updateExpenseCategory: (id: string, patch: Partial<Omit<ExpenseCategory, "id">>) => void;
  setExpenseCategoryActive: (id: string, active: boolean) => void;
  addMonthlyPayable: (input: Omit<MonthlyPayable, "id" | "active">) => MonthlyPayable;
  updateMonthlyPayable: (id: string, patch: Partial<Omit<MonthlyPayable, "id">>) => void;
  setMonthlyPayableActive: (id: string, active: boolean) => void;
  removeMonthlyPayable: (id: string) => void;
  addMarketingAgency: (input: Omit<MarketingAgency, "id" | "active">) => MarketingAgency;
  updateMarketingAgency: (id: string, patch: Partial<Omit<MarketingAgency, "id">>) => void;
  setMarketingAgencyActive: (id: string, active: boolean) => void;
  setAgencyCourseRebate: (id: string, courseCode: string, centavos: number) => void;
  addInstructor: (input: Omit<Instructor, "id" | "active">) => Instructor;
  updateInstructor: (id: string, patch: Partial<Omit<Instructor, "id">>) => void;
  setInstructorActive: (id: string, active: boolean) => void;
  addClassroom: (input: Omit<Classroom, "id" | "active">) => Classroom;
  updateClassroom: (id: string, patch: Partial<Omit<Classroom, "id">>) => void;
  setClassroomActive: (id: string, active: boolean) => void;
  addEmployee: (input: Omit<Employee, "id" | "employeeNumber" | "status">) => Employee | undefined;
  updateEmployee: (id: string, patch: Partial<Omit<Employee, "id">>) => void;
  setEmployeeStatus: (id: string, status: Employee["status"]) => void;
  upsertHrAttendance: (input: Omit<HrAttendanceRecord, "id">) => void;
  createLeave: (input: Omit<LeaveRequest, "id" | "reference" | "status">) => LeaveRequest | undefined;
  createCashAdvance: (input: Omit<CashAdvance, "id" | "reference" | "status" | "createdAt">) => CashAdvance | undefined;
  decideCashAdvance: (id: string, decision: CashAdvance["status"]) => void;
  postAnnouncement: (input: Omit<Announcement, "id" | "postedBy" | "postedAt">) => Announcement;
  updateAnnouncement: (id: string, patch: Partial<Omit<Announcement, "id">>) => void;
  removeAnnouncement: (id: string) => void;
  /* operations */
  createBatch: (input: Omit<Batch, "id" | "status" | "publishedAt">) => Batch;
  autoOpenMonth: (input: { courseCode: string; year: number; month: number; capacity: number; venue: string; instructor: string }) => number;
  publishBatch: (id: string) => void;
  setBatchStatus: (id: string, status: Batch["status"]) => void;
  sendInstructions: (enrollmentId: string) => void;
  acknowledgeInstructions: (enrollmentId: string) => void;
  setSessionState: (id: string, state: AttendanceSession["state"]) => void;
  markAttendance: (input: { sessionId: string; enrollmentId: string; status: AttendanceStatus; method?: "Manual"; manualReason?: string }) => void;
  markTrainingComplete: (enrollmentId: string, complete: boolean) => void;
  /* certificates */
  printCertificate: (enrollmentId: string) => void;
  releaseCertificate: (enrollmentId: string, recipient: string) => void;
  /* requests + people */
  createRequest: (input: { type: RequestType; enrollmentId?: string; traineeName: string; reason: string; requestedBy?: string; payload?: Record<string, string> }) => ChangeRequest;
  decideRequest: (id: string, decision: "Approved" | "Rejected" | "For clarification", remarks?: string) => void;
  decideLeave: (id: string, decision: "Approved" | "Rejected") => void;
  advancePayroll: (id: string) => void;
  createExpense: (input: {
    category: string;
    itemUnit?: string;
    quantity?: number;
    purpose: string;
    payor?: string;
    payee?: string;
    amountCentavos: number;
    modeOfPayment?: string;
    remarks?: string;
  }) => Expense;
  decideExpense: (id: string, decision: "Approved" | "Rejected" | "Paid") => void;
  resolveMessage: (id: string) => void;
  /* system */
  updateSettings: (patch: Partial<Settings>) => void;
  markNotificationsRead: () => void;
  resetSystem: () => void;
  /* selectors */
  view: (enrollmentId: string) => EnrollmentView | undefined;
  views: () => EnrollmentView[];
  submissionSelections: (submissionId: string) => CourseSelection[];
  seats: (batchId: string) => { capacity: number; taken: number; available: number };
  openBatchesFor: (courseCode: string) => Batch[];
};

const SystemContext = createContext<SystemContextValue | null>(null);

// Every top-level collection the app iterates. A stored state missing any of
// these — e.g. one persisted mid-upgrade before a new array existed — would
// crash the portal, so we treat it as invalid and reseed instead.
const REQUIRED_COLLECTIONS: (keyof SystemState)[] = [
  "trainees",
  "batches",
  "courses",
  "partnerOffers",
  "paymentChannels",
  "otherCharges",
  "expenseCategories",
  "monthlyPayables",
  "marketingAgencies",
  "instructors",
  "classrooms",
  "hrAttendance",
  "cashAdvances",
  "announcements",
  "submissions",
  "courseSelections",
  "consents",
  "enrollments",
  "ledger",
  "attendanceSessions",
  "attendanceRecords",
  "certificates",
  "requests",
  "employees",
  "leaveRequests",
  "payrollPeriods",
  "expenses",
  "contactMessages",
  "notifications",
  "activity",
];

function isCompleteState(value: SystemState): boolean {
  return REQUIRED_COLLECTIONS.every((key) => Array.isArray(value[key])) && Boolean(value.settings);
}

function loadInitialState(): SystemState {
  if (typeof window === "undefined") return createSeedState();
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as SystemState;
      if (parsed.version === SYSTEM_VERSION && isCompleteState(parsed)) return reconcile(parsed);
    }
  } catch {
    /* corrupted or unavailable storage falls back to the seeded demo data */
  }
  return createSeedState();
}

const noopSubscribe = () => () => undefined;

export function SystemProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SystemState>(loadInitialState);
  // False during SSR and the hydration pass, true afterwards. Consumers hold back
  // stored records until then so server and client markup always agree.
  const ready = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  const [actor, setActor] = useState("Admin");
  const writing = useRef(false);

  useEffect(() => {
    if (!ready) return;
    try {
      writing.current = true;
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* storage full or blocked — the session keeps working in memory */
    } finally {
      writing.current = false;
    }
  }, [state, ready]);

  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key !== STORAGE_KEY || !event.newValue || writing.current) return;
      try {
        const parsed = JSON.parse(event.newValue) as SystemState;
        if (parsed.version === SYSTEM_VERSION && isCompleteState(parsed)) setState(parsed);
      } catch {
        /* ignore malformed cross-tab payloads */
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const update = useCallback((mutate: (draft: SystemState) => void) => {
    setState((current) => {
      const draft: SystemState = structuredClone(current);
      mutate(draft);
      return reconcile(draft);
    });
  }, []);

  const log = useCallback(
    (draft: SystemState, entry: Omit<ActivityEntry, "id" | "createdAt" | "actor"> & { actor?: string }) => {
      draft.activity.unshift({
        id: uid("act"),
        createdAt: new Date().toISOString(),
        actor: entry.actor ?? actor,
        action: entry.action,
        recordType: entry.recordType,
        recordRef: entry.recordRef,
        detail: entry.detail,
      });
      draft.activity = draft.activity.slice(0, 120);
    },
    [actor],
  );

  const notify = useCallback(
    (draft: SystemState, input: { audience: "staff" | "trainee"; traineeId?: string; title: string; body: string }) => {
      draft.notifications.unshift({ id: uid("ntf"), createdAt: new Date().toISOString(), ...input });
      draft.notifications = draft.notifications.slice(0, 60);
    },
    [],
  );

  /* ------------------------------------------------------------ selectors */

  const view = useCallback(
    (enrollmentId: string): EnrollmentView | undefined => {
      const enrollment = state.enrollments.find((item) => item.id === enrollmentId);
      if (!enrollment) return undefined;
      const trainee = state.trainees.find((item) => item.id === enrollment.traineeId);
      if (!trainee) return undefined;
      const batch = state.batches.find((item) => item.id === enrollment.batchId);
      const entries = state.ledger
        .filter((entry) => entry.enrollmentId === enrollment.id)
        .sort((left, right) => right.recordedAt.localeCompare(left.recordedAt));
      const countable = entries.filter((entry) => entry.valid && entry.verification !== "Rejected");
      const dueCentavos = Math.max(
        0,
        countable.filter((entry) => entry.type === "charge").reduce((sum, entry) => sum + entry.amountCentavos, 0) -
          countable.filter((entry) => entry.type === "discount").reduce((sum, entry) => sum + entry.amountCentavos, 0),
      );
      const verified = countable.filter((entry) => entry.type === "payment" && entry.verification === "Verified");
      const outflow = countable.filter((entry) => entry.type === "refund" || entry.type === "reversal");
      const paidCentavos = Math.max(
        0,
        verified.reduce((sum, entry) => sum + entry.amountCentavos, 0) -
          outflow.reduce((sum, entry) => sum + entry.amountCentavos, 0),
      );
      const paymentStatus = derivePaymentStatus(
        [
          ...countable
            .filter((entry) => entry.type !== "payment")
            .map((entry) => ({ type: entry.type, amountCentavos: entry.amountCentavos, valid: entry.valid })),
          ...verified.map((entry) => ({ type: "payment" as const, amountCentavos: entry.amountCentavos, valid: true })),
        ],
        enrollment.status === "Cancelled",
      );

      const sessions = sessionsOfBatch(state, enrollment.batchId);
      const attendance = sessions.map((session) => ({
        session,
        record: state.attendanceRecords.find(
          (record) => record.sessionId === session.id && record.enrollmentId === enrollment.id,
        ),
      }));
      const { attendanceComplete } = certificateEligibility(state, enrollment);
      const certificate = state.certificates.find((item) => item.enrollmentId === enrollment.id);
      const awaitingVerification = entries.some(
        (entry) => entry.type === "payment" && entry.verification === "Pending",
      );

      let stage: Stage = "Registered";
      if (enrollment.status === "Cancelled") stage = "Cancelled";
      else if (certificate?.status === "Released") stage = "Certificate released";
      else if (certificate?.status === "Ready to Print" || certificate?.status === "Printed") stage = "Certificate ready";
      else if (attendanceComplete) stage = "Training complete";
      else if (batch && batch.startsOn <= todayIso() && batch.endsOn >= todayIso()) stage = "In training";
      else if (enrollment.instructionsSentAt) stage = "Instructions sent";
      else if (paymentStatus === "Paid") stage = "Paid";
      else if (awaitingVerification) stage = "Payment verification";
      else if (paidCentavos > 0 || dueCentavos > 0) stage = "Awaiting payment";

      return {
        enrollment,
        trainee,
        batch,
        entries,
        dueCentavos,
        paidCentavos,
        balanceCentavos: Math.max(0, dueCentavos - paidCentavos),
        paymentStatus,
        attendance,
        attendanceStatuses: attendance.filter((item) => item.record).map((item) => item.record!.status),
        attendanceComplete,
        certificate,
        stage,
      };
    },
    [state],
  );

  const views = useCallback(
    () =>
      state.enrollments
        .map((enrollment) => view(enrollment.id))
        .filter((item): item is EnrollmentView => Boolean(item))
        .sort((left, right) => right.enrollment.createdAt.localeCompare(left.enrollment.createdAt)),
    [state.enrollments, view],
  );

  const submissionSelections = useCallback(
    (submissionId: string) =>
      state.courseSelections
        .filter((item) => item.submissionId === submissionId)
        .sort((left, right) => left.sequence - right.sequence),
    [state.courseSelections],
  );

  const seats = useCallback(
    (batchId: string) => {
      const batch = state.batches.find((item) => item.id === batchId);
      const taken = batchSeatCount(state, batchId);
      const capacity = batch?.capacity ?? 0;
      return { capacity, taken, available: Math.max(0, capacity - taken) };
    },
    [state],
  );

  const openBatchesFor = useCallback(
    (courseCode: string) =>
      state.batches
        .filter(
          (batch) =>
            batch.courseCode === courseCode &&
            batch.publishedAt !== null &&
            (batch.status === "Open" || batch.status === "Full") &&
            batch.startsOn > todayIso() &&
            batchSeatCount(state, batch.id) < batch.capacity,
        )
        .sort((left, right) => left.startsOn.localeCompare(right.startsOn)),
    [state],
  );

  /* -------------------------------------------------------------- actions */

  const createTrainee = useCallback<SystemContextValue["createTrainee"]>(
    (input) => {
      const trainee: Trainee = {
        ...input,
        id: uid("t"),
        traineeNumber: "",
        createdAt: new Date().toISOString(),
      };
      update((draft) => {
        const highest = draft.trainees.reduce((top, item) => {
          const match = /^NWM-(\d{6})$/.exec(item.traineeNumber);
          return match ? Math.max(top, Number(match[1])) : top;
        }, 0);
        trainee.traineeNumber = `NWM-${String(highest + 1).padStart(6, "0")}`;
        draft.trainees.push(trainee);
        log(draft, { action: "Trainee created", recordType: "Trainee", recordRef: trainee.traineeNumber });
      });
      return trainee;
    },
    [log, update],
  );

  const setTraineeFacebook = useCallback<SystemContextValue["setTraineeFacebook"]>(
    (id, facebookLink) => {
      update((draft) => {
        const trainee = draft.trainees.find((item) => item.id === id);
        if (!trainee) return;
        trainee.facebookLink = facebookLink.trim() || undefined;
        log(draft, { action: "Facebook link encoded", recordType: "Trainee", recordRef: trainee.traineeNumber });
      });
    },
    [log, update],
  );

  const mergeTrainees = useCallback<SystemContextValue["mergeTrainees"]>(
    (survivorId, duplicateId) => {
      if (survivorId === duplicateId) return;
      update((draft) => {
        const survivor = draft.trainees.find((item) => item.id === survivorId);
        const duplicate = draft.trainees.find((item) => item.id === duplicateId);
        if (!survivor || !duplicate) return;
        // Keep the survivor's data, backfilling only blanks from the duplicate.
        survivor.middleName ??= duplicate.middleName;
        survivor.suffix ??= duplicate.suffix;
        survivor.srn ??= duplicate.srn;
        survivor.address ??= duplicate.address;
        survivor.company ??= duplicate.company;
        survivor.rank ??= duplicate.rank;
        survivor.facebookLink ??= duplicate.facebookLink;
        survivor.emergencyContactName ??= duplicate.emergencyContactName;
        survivor.emergencyContactRelation ??= duplicate.emergencyContactRelation;
        survivor.emergencyContactMobile ??= duplicate.emergencyContactMobile;
        // Move the duplicate's records onto the survivor, then remove the duplicate.
        draft.enrollments.forEach((enrollment) => {
          if (enrollment.traineeId === duplicateId) enrollment.traineeId = survivorId;
        });
        draft.submissions.forEach((submission) => {
          if (submission.traineeId === duplicateId) submission.traineeId = survivorId;
        });
        draft.trainees = draft.trainees.filter((item) => item.id !== duplicateId);
        log(draft, {
          action: "Duplicate trainee merged",
          recordType: "Trainee",
          recordRef: survivor.traineeNumber,
          detail: `Merged ${duplicate.traineeNumber} into ${survivor.traineeNumber}`,
        });
      });
    },
    [log, update],
  );

  const submitRegistration = useCallback<SystemContextValue["submitRegistration"]>(
    (input) => {
      const submission: RegistrationSubmission = {
        id: uid("sub"),
        reference: "",
        applicant: input.applicant,
        status: "Submitted",
        publicStatusMessage: "Your registration form has been received.",
        submittedAt: new Date().toISOString(),
      };
      update((draft) => {
        submission.reference = nextReference(draft.submissions.map((item) => item.reference), "NWM-REG");
        draft.submissions.unshift(submission);
        input.selections.slice(0, 5).forEach((selection, index) => {
          draft.courseSelections.push({
            id: uid("sel"),
            submissionId: submission.id,
            courseCode: selection.courseCode,
            courseName: selection.courseName,
            batchId: selection.batchId,
            sequence: index + 1,
            status: "Approved",
          });
        });
        input.consents.forEach((consent) => {
          draft.consents.push({
            id: uid("con"),
            submissionId: submission.id,
            consentType: consent.consentType,
            version: consent.version,
            textSnapshot: consent.textSnapshot,
            acceptedAt: new Date().toISOString(),
            sessionRef: input.sessionRef,
          });
        });
        // No approval step: create/merge the trainee, then open one enrollment
        // per selection at "Waiting for Payment" straight away.
        const trainee = ensureTraineeForSubmission(draft, submission);
        draft.courseSelections
          .filter((selection) => selection.submissionId === submission.id)
          .forEach((selection) => {
            const batch = draft.batches.find((item) => item.id === selection.batchId);
            if (!batch) return;
            const enrollment: Enrollment = {
              id: uid("e"),
              reference: nextReference(draft.enrollments.map((item) => item.reference), "NWM-ENR"),
              traineeId: trainee.id,
              batchId: batch.id,
              courseCode: batch.courseCode,
              courseName: batch.courseName,
              centerName: batch.centerName,
              status: "Enrolled",
              createdAt: new Date().toISOString(),
              registrationStatus: "Waiting for Payment",
              registrationReference: submission.reference,
              registrationSubmissionId: submission.id,
              courseSelectionId: selection.id,
            };
            draft.enrollments.unshift(enrollment);
            draft.ledger.unshift({
              id: uid("chg"),
              reference: `CHG-${enrollment.reference}`,
              enrollmentId: enrollment.id,
              type: "charge",
              amountCentavos: batch.feeCentavos,
              description: `${batch.courseName} training fee`,
              verification: "Not required",
              recordedBy: "Registration",
              recordedAt: new Date().toISOString(),
              valid: true,
            });
            selection.createdEnrollmentId = enrollment.id;
          });
        submission.status = "Approved";
        submission.publicStatusMessage = "Your enrollment is confirmed. Please proceed with payment to secure your slot.";
        notify(draft, {
          audience: "staff",
          title: "New registration enrolled",
          body: `${fullName(input.applicant)} enrolled in ${input.selections.length} course${input.selections.length === 1 ? "" : "s"}.`,
        });
        log(draft, {
          action: "Registration enrolled (no approval)",
          recordType: "Registration",
          recordRef: submission.reference,
          actor: "Public website",
          detail: `${input.selections.length} course selection${input.selections.length === 1 ? "" : "s"}`,
        });
      });
      return submission;
    },
    [log, notify, update],
  );

  const updateSubmissionStatus = useCallback<SystemContextValue["updateSubmissionStatus"]>(
    (id, status, remarks) => {
      update((draft) => {
        const submission = draft.submissions.find((item) => item.id === id);
        if (!submission) return;
        submission.status = status;
        submission.remarks = remarks ?? submission.remarks;
        submission.decidedAt = new Date().toISOString();
        log(draft, { action: `Registration ${status.toLowerCase()}`, recordType: "Registration", recordRef: submission.reference });
      });
    },
    [log, update],
  );

  const reviewSelection = useCallback<SystemContextValue["reviewSelection"]>(
    (id, status, remark) => {
      update((draft) => {
        const selection = draft.courseSelections.find((item) => item.id === id);
        if (!selection) return;
        selection.status = status;
        if (remark) selection.internalRemark = remark;
        selection.decidedAt = new Date().toISOString();
        selection.decidedBy = actor;
        recomputeSubmissionStatus(draft, selection.submissionId);
        log(draft, { action: `Course selection ${status.toLowerCase()}`, recordType: "Course selection", recordRef: selection.courseName });
      });
    },
    [actor, log, update],
  );

  const approveSelection = useCallback<SystemContextValue["approveSelection"]>(
    (id) => {
      let created: Enrollment | undefined;
      update((draft) => {
        const selection = draft.courseSelections.find((item) => item.id === id);
        if (!selection || selection.createdEnrollmentId) return;
        const submission = draft.submissions.find((item) => item.id === selection.submissionId);
        const batch = draft.batches.find((item) => item.id === selection.batchId);
        if (!submission || !batch) return;

        const trainee = ensureTraineeForSubmission(draft, submission);
        const enrollment: Enrollment = {
          id: uid("e"),
          reference: nextReference(draft.enrollments.map((item) => item.reference), "NWM-ENR"),
          traineeId: trainee.id,
          batchId: batch.id,
          courseCode: batch.courseCode,
          courseName: batch.courseName,
          centerName: batch.centerName,
          status: "Enrolled",
          createdAt: new Date().toISOString(),
          registrationStatus: "Waiting for Payment",
          processedBy: actor,
          registrationReference: submission.reference,
          registrationSubmissionId: submission.id,
          courseSelectionId: selection.id,
        };
        draft.enrollments.unshift(enrollment);
        draft.ledger.unshift({
          id: uid("chg"),
          reference: `CHG-${enrollment.reference}`,
          enrollmentId: enrollment.id,
          type: "charge",
          amountCentavos: batch.feeCentavos,
          description: `${batch.courseName} training fee`,
          verification: "Not required",
          recordedBy: actor,
          recordedAt: new Date().toISOString(),
          valid: true,
        });
        selection.status = "Approved";
        selection.createdEnrollmentId = enrollment.id;
        selection.decidedAt = new Date().toISOString();
        selection.decidedBy = actor;
        recomputeSubmissionStatus(draft, submission.id);
        created = enrollment;
        log(draft, {
          action: "Course selection approved",
          recordType: "Enrollment",
          recordRef: enrollment.reference,
          detail: `${trainee.traineeNumber} · ${batch.batchNumber}`,
        });
      });
      return created;
    },
    [actor, log, update],
  );

  const createEnrollment = useCallback<SystemContextValue["createEnrollment"]>(
    ({ traineeId, batchId }) => {
      let created: Enrollment | undefined;
      update((draft) => {
        const batch = draft.batches.find((item) => item.id === batchId);
        const trainee = draft.trainees.find((item) => item.id === traineeId);
        if (!batch || !trainee) return;
        const enrollment: Enrollment = {
          id: uid("e"),
          reference: nextReference(draft.enrollments.map((item) => item.reference), "ENR"),
          traineeId,
          batchId,
          courseCode: batch.courseCode,
          courseName: batch.courseName,
          centerName: batch.centerName,
          status: "Enrolled",
          createdAt: new Date().toISOString(),
          registrationStatus: "Waiting for Payment",
          processedBy: actor,
        };
        draft.enrollments.unshift(enrollment);
        draft.ledger.unshift({
          id: uid("chg"),
          reference: `CHG-${enrollment.reference}`,
          enrollmentId: enrollment.id,
          type: "charge",
          amountCentavos: batch.feeCentavos,
          description: `${batch.courseName} training fee`,
          verification: "Not required",
          recordedBy: actor,
          recordedAt: new Date().toISOString(),
          valid: true,
        });
        created = enrollment;
        log(draft, { action: "Enrollment created", recordType: "Enrollment", recordRef: enrollment.reference });
      });
      return created;
    },
    [actor, log, update],
  );

  // Endorsed partner trainings have no New Wave batch, so a staff-created
  // endorsed enrollment carries an empty batchId and takes its course, center,
  // and fee from the partner offer. The courseCode is keyed "endorsed:<offerId>"
  // so a marketing-agency rebate set against the same offer lines up.
  const createEndorsedEnrollment = useCallback<SystemContextValue["createEndorsedEnrollment"]>(
    ({ traineeId, offerId }) => {
      let created: Enrollment | undefined;
      update((draft) => {
        const offer = draft.partnerOffers.find((item) => item.id === offerId);
        const trainee = draft.trainees.find((item) => item.id === traineeId);
        if (!offer || !trainee) return;
        const enrollment: Enrollment = {
          id: uid("e"),
          reference: nextReference(draft.enrollments.map((item) => item.reference), "ENR"),
          traineeId,
          batchId: "",
          courseCode: `endorsed:${offer.id}`,
          courseName: offer.course,
          centerName: offer.center,
          status: "Enrolled",
          createdAt: new Date().toISOString(),
          registrationStatus: "Waiting for Payment",
          processedBy: actor,
        };
        draft.enrollments.unshift(enrollment);
        draft.ledger.unshift({
          id: uid("chg"),
          reference: `CHG-${enrollment.reference}`,
          enrollmentId: enrollment.id,
          type: "charge",
          amountCentavos: offer.trainingFeeCentavos,
          description: `${offer.course} training fee (endorsed · ${offer.center})`,
          verification: "Not required",
          recordedBy: actor,
          recordedAt: new Date().toISOString(),
          valid: true,
        });
        created = enrollment;
        log(draft, { action: "Endorsed enrollment created", recordType: "Enrollment", recordRef: enrollment.reference, detail: offer.center });
      });
      return created;
    },
    [actor, log, update],
  );

  const changeEnrollmentBatch = useCallback<SystemContextValue["changeEnrollmentBatch"]>(
    (enrollmentId, newBatchId) => {
      update((draft) => {
        const enrollment = draft.enrollments.find((item) => item.id === enrollmentId);
        const batch = draft.batches.find((item) => item.id === newBatchId);
        if (!enrollment || !batch || enrollment.batchId === newBatchId) return;
        enrollment.batchId = batch.id;
        enrollment.courseCode = batch.courseCode;
        enrollment.courseName = batch.courseName;
        enrollment.centerName = batch.centerName;
        // Re-price the training-fee charge to the new batch. Payments already
        // posted are untouched, so the balance simply reflects the new fee.
        const charge = draft.ledger.find(
          (item) => item.enrollmentId === enrollmentId && item.type === "charge" && item.valid,
        );
        if (charge) {
          charge.amountCentavos = batch.feeCentavos;
          charge.description = `${batch.courseName} training fee`;
        }
        log(draft, {
          action: "Enrollment course/schedule changed",
          recordType: "Enrollment",
          recordRef: enrollment.reference,
          detail: `${batch.courseName} · ${batch.batchNumber} (${batch.startsOn})`,
        });
      });
    },
    [log, update],
  );

  const setRegistrationStatus = useCallback<SystemContextValue["setRegistrationStatus"]>(
    (enrollmentId, status) => {
      update((draft) => {
        const enrollment = draft.enrollments.find((item) => item.id === enrollmentId);
        if (!enrollment) return;
        enrollment.registrationStatus = status;
        if (status === "Cancelled") enrollment.status = "Cancelled";
        log(draft, {
          action: `Registration status → ${status}`,
          recordType: "Enrollment",
          recordRef: enrollment.reference,
        });
      });
    },
    [log, update],
  );

  const generateAdmissionSlip = useCallback<SystemContextValue["generateAdmissionSlip"]>(
    (enrollmentId, { officer, cashier }) => {
      update((draft) => {
        const enrollment = draft.enrollments.find((item) => item.id === enrollmentId);
        if (!enrollment) return;
        enrollment.admissionSlipGeneratedAt = new Date().toISOString();
        enrollment.cashierAssigned = cashier || undefined;
        if (officer) enrollment.processedBy = officer;
        enrollment.registrationStatus = "Generated Voucher";
        log(draft, {
          action: "Admission slip generated",
          recordType: "Enrollment",
          recordRef: enrollment.reference,
          detail: `Officer ${officer || "—"} · Cashier ${cashier || "—"}`,
        });
      });
    },
    [log, update],
  );

  const cancelEnrollment = useCallback<SystemContextValue["cancelEnrollment"]>(
    (id, reason) => {
      update((draft) => {
        const enrollment = draft.enrollments.find((item) => item.id === id);
        if (!enrollment) return;
        enrollment.status = "Cancelled";
        enrollment.cancelledReason = reason;
        const certificate = draft.certificates.find((item) => item.enrollmentId === id);
        if (certificate && certificate.status !== "Released") certificate.status = "Cancelled";
        log(draft, { action: "Enrollment cancelled", recordType: "Enrollment", recordRef: enrollment.reference, detail: reason });
      });
    },
    [log, update],
  );

  const recordPayment = useCallback<SystemContextValue["recordPayment"]>(
    (input) => {
      let created: LedgerEntry | undefined;
      update((draft) => {
        const enrollment = draft.enrollments.find((item) => item.id === input.enrollmentId);
        if (!enrollment || input.amountCentavos <= 0) return;
        const needsVerification = input.needsVerification ?? input.method !== "Cash";
        const entry: LedgerEntry = {
          id: uid("pay"),
          reference: nextReference(draft.ledger.filter((item) => item.type === "payment").map((item) => item.reference), "PAY"),
          enrollmentId: input.enrollmentId,
          type: "payment",
          amountCentavos: input.amountCentavos,
          description: input.description ?? `${input.method} payment`,
          method: input.method,
          receivingAccount: input.receivingAccount,
          referenceNumber: input.referenceNumber,
          proofFileName: input.proofFileName,
          verification: needsVerification ? "Pending" : "Verified",
          receiptNumber: needsVerification
            ? undefined
            : nextReference(draft.ledger.map((item) => item.receiptNumber ?? ""), "OR"),
          recordedBy: input.recordedBy ?? actor,
          recordedAt: new Date().toISOString(),
          valid: true,
        };
        draft.ledger.unshift(entry);
        created = entry;
        if (needsVerification) {
          notify(draft, {
            audience: "staff",
            title: "Payment awaiting verification",
            body: `${entry.reference} · ${enrollment.reference} needs cashier confirmation.`,
          });
        }
        log(draft, {
          action: needsVerification ? "Payment submitted" : "Payment posted",
          recordType: "Payment",
          recordRef: entry.reference,
          detail: enrollment.reference,
        });
      });
      return created;
    },
    [actor, log, notify, update],
  );

  const setPaymentVerification = useCallback<SystemContextValue["setPaymentVerification"]>(
    (id, verification) => {
      update((draft) => {
        const entry = draft.ledger.find((item) => item.id === id);
        if (!entry) return;
        entry.verification = verification;
        if (verification === "Verified" && !entry.receiptNumber) {
          entry.receiptNumber = nextReference(draft.ledger.map((item) => item.receiptNumber ?? ""), "OR");
        }
        const enrollment = draft.enrollments.find((item) => item.id === entry.enrollmentId);
        if (enrollment) {
          notify(draft, {
            audience: "trainee",
            traineeId: enrollment.traineeId,
            title: verification === "Verified" ? "Payment verified" : "Payment proof returned",
            body:
              verification === "Verified"
                ? `Receipt ${entry.receiptNumber} is ready for ${enrollment.reference}.`
                : `Please re-upload a clearer proof for ${entry.reference}.`,
          });
        }
        log(draft, { action: `Payment ${verification.toLowerCase()}`, recordType: "Payment", recordRef: entry.reference });
      });
    },
    [log, notify, update],
  );

  const addLedgerEntry = useCallback<SystemContextValue["addLedgerEntry"]>(
    (input) => {
      update((draft) => {
        const enrollment = draft.enrollments.find((item) => item.id === input.enrollmentId);
        if (!enrollment || input.amountCentavos <= 0) return;
        draft.ledger.unshift({
          id: uid(input.type),
          reference: `${input.type.slice(0, 3).toUpperCase()}-${enrollment.reference}-${draft.ledger.length + 1}`,
          enrollmentId: input.enrollmentId,
          type: input.type,
          amountCentavos: input.amountCentavos,
          description: input.description,
          verification: "Not required",
          recordedBy: actor,
          recordedAt: new Date().toISOString(),
          valid: true,
        });
        log(draft, {
          action: `${input.type[0].toUpperCase()}${input.type.slice(1)} recorded`,
          recordType: "Ledger",
          recordRef: enrollment.reference,
          detail: input.description,
        });
      });
    },
    [actor, log, update],
  );

  /* --------------------------------------------------- catalog administration */

  const addCourse = useCallback<SystemContextValue["addCourse"]>(
    (input) => {
      const course: Course = { ...input, id: uid("crs"), active: true };
      update((draft) => {
        draft.courses.push(course);
        log(draft, { action: "Course added", recordType: "Course", recordRef: course.code, detail: course.course });
      });
      return course;
    },
    [log, update],
  );

  const updateCourse = useCallback<SystemContextValue["updateCourse"]>(
    (id, patch) => {
      update((draft) => {
        const course = draft.courses.find((item) => item.id === id);
        if (!course) return;
        Object.assign(course, patch);
        log(draft, { action: "Course updated", recordType: "Course", recordRef: course.code, detail: course.course });
      });
    },
    [log, update],
  );

  const setCourseActive = useCallback<SystemContextValue["setCourseActive"]>(
    (id, active) => {
      update((draft) => {
        const course = draft.courses.find((item) => item.id === id);
        if (!course) return;
        course.active = active;
        log(draft, {
          action: active ? "Course restored" : "Course archived",
          recordType: "Course",
          recordRef: course.code,
          detail: course.course,
        });
      });
    },
    [log, update],
  );

  const addPartnerOffer = useCallback<SystemContextValue["addPartnerOffer"]>(
    (input) => {
      const offer: PartnerOfferRecord = { ...input, id: uid("off"), active: true };
      update((draft) => {
        draft.partnerOffers.push(offer);
        log(draft, { action: "Partner offer added", recordType: "PartnerOffer", recordRef: offer.center, detail: offer.course });
      });
      return offer;
    },
    [log, update],
  );

  const updatePartnerOffer = useCallback<SystemContextValue["updatePartnerOffer"]>(
    (id, patch) => {
      update((draft) => {
        const offer = draft.partnerOffers.find((item) => item.id === id);
        if (!offer) return;
        Object.assign(offer, patch);
        log(draft, { action: "Partner offer updated", recordType: "PartnerOffer", recordRef: offer.center, detail: offer.course });
      });
    },
    [log, update],
  );

  const setPartnerOfferActive = useCallback<SystemContextValue["setPartnerOfferActive"]>(
    (id, active) => {
      update((draft) => {
        const offer = draft.partnerOffers.find((item) => item.id === id);
        if (!offer) return;
        offer.active = active;
        log(draft, {
          action: active ? "Partner offer restored" : "Partner offer archived",
          recordType: "PartnerOffer",
          recordRef: offer.center,
          detail: offer.course,
        });
      });
    },
    [log, update],
  );

  const addPaymentChannel = useCallback<SystemContextValue["addPaymentChannel"]>(
    (input) => {
      const channel: PaymentChannel = { ...input, id: uid("pc"), active: true };
      update((draft) => {
        draft.paymentChannels.push(channel);
        log(draft, { action: "Payment channel added", recordType: "PaymentChannel", recordRef: channel.name });
      });
      return channel;
    },
    [log, update],
  );

  const updatePaymentChannel = useCallback<SystemContextValue["updatePaymentChannel"]>(
    (id, patch) => {
      update((draft) => {
        const channel = draft.paymentChannels.find((item) => item.id === id);
        if (!channel) return;
        Object.assign(channel, patch);
        log(draft, { action: "Payment channel updated", recordType: "PaymentChannel", recordRef: channel.name });
      });
    },
    [log, update],
  );

  const setPaymentChannelActive = useCallback<SystemContextValue["setPaymentChannelActive"]>(
    (id, active) => {
      update((draft) => {
        const channel = draft.paymentChannels.find((item) => item.id === id);
        if (!channel) return;
        channel.active = active;
        log(draft, {
          action: active ? "Payment channel restored" : "Payment channel archived",
          recordType: "PaymentChannel",
          recordRef: channel.name,
        });
      });
    },
    [log, update],
  );

  const addOtherCharge = useCallback<SystemContextValue["addOtherCharge"]>(
    (input) => {
      const charge: OtherCharge = { ...input, id: uid("oc"), active: true };
      update((draft) => {
        draft.otherCharges.push(charge);
        log(draft, { action: "Other charge added", recordType: "OtherCharge", recordRef: charge.name });
      });
      return charge;
    },
    [log, update],
  );

  const updateOtherCharge = useCallback<SystemContextValue["updateOtherCharge"]>(
    (id, patch) => {
      update((draft) => {
        const charge = draft.otherCharges.find((item) => item.id === id);
        if (!charge) return;
        Object.assign(charge, patch);
        log(draft, { action: "Other charge updated", recordType: "OtherCharge", recordRef: charge.name });
      });
    },
    [log, update],
  );

  const setOtherChargeActive = useCallback<SystemContextValue["setOtherChargeActive"]>(
    (id, active) => {
      update((draft) => {
        const charge = draft.otherCharges.find((item) => item.id === id);
        if (!charge) return;
        charge.active = active;
        log(draft, {
          action: active ? "Other charge restored" : "Other charge archived",
          recordType: "OtherCharge",
          recordRef: charge.name,
        });
      });
    },
    [log, update],
  );

  const addExpenseCategory = useCallback<SystemContextValue["addExpenseCategory"]>(
    (input) => {
      const category: ExpenseCategory = { ...input, id: uid("ec"), active: true };
      update((draft) => {
        draft.expenseCategories.push(category);
        log(draft, { action: "Expense category added", recordType: "ExpenseCategory", recordRef: category.name });
      });
      return category;
    },
    [log, update],
  );

  const updateExpenseCategory = useCallback<SystemContextValue["updateExpenseCategory"]>(
    (id, patch) => {
      update((draft) => {
        const category = draft.expenseCategories.find((item) => item.id === id);
        if (!category) return;
        Object.assign(category, patch);
        log(draft, { action: "Expense category updated", recordType: "ExpenseCategory", recordRef: category.name });
      });
    },
    [log, update],
  );

  const setExpenseCategoryActive = useCallback<SystemContextValue["setExpenseCategoryActive"]>(
    (id, active) => {
      update((draft) => {
        const category = draft.expenseCategories.find((item) => item.id === id);
        if (!category) return;
        category.active = active;
        log(draft, {
          action: active ? "Expense category restored" : "Expense category archived",
          recordType: "ExpenseCategory",
          recordRef: category.name,
        });
      });
    },
    [log, update],
  );

  const addMonthlyPayable = useCallback<SystemContextValue["addMonthlyPayable"]>(
    (input) => {
      const payable: MonthlyPayable = { ...input, id: uid("mp"), active: true };
      update((draft) => {
        draft.monthlyPayables.push(payable);
        log(draft, { action: "Monthly payable added", recordType: "MonthlyPayable", recordRef: payable.name });
      });
      return payable;
    },
    [log, update],
  );

  const updateMonthlyPayable = useCallback<SystemContextValue["updateMonthlyPayable"]>(
    (id, patch) => {
      update((draft) => {
        const payable = draft.monthlyPayables.find((item) => item.id === id);
        if (!payable) return;
        Object.assign(payable, patch);
        log(draft, { action: "Monthly payable updated", recordType: "MonthlyPayable", recordRef: payable.name });
      });
    },
    [log, update],
  );

  const setMonthlyPayableActive = useCallback<SystemContextValue["setMonthlyPayableActive"]>(
    (id, active) => {
      update((draft) => {
        const payable = draft.monthlyPayables.find((item) => item.id === id);
        if (!payable) return;
        payable.active = active;
        log(draft, {
          action: active ? "Monthly payable restored" : "Monthly payable archived",
          recordType: "MonthlyPayable",
          recordRef: payable.name,
        });
      });
    },
    [log, update],
  );

  const removeMonthlyPayable = useCallback<SystemContextValue["removeMonthlyPayable"]>(
    (id) => {
      update((draft) => {
        const payable = draft.monthlyPayables.find((item) => item.id === id);
        if (!payable) return;
        draft.monthlyPayables = draft.monthlyPayables.filter((item) => item.id !== id);
        log(draft, { action: "Monthly payable removed", recordType: "MonthlyPayable", recordRef: payable.name });
      });
    },
    [log, update],
  );

  const addMarketingAgency = useCallback<SystemContextValue["addMarketingAgency"]>(
    (input) => {
      const agency: MarketingAgency = { ...input, id: uid("ma"), active: true };
      update((draft) => {
        draft.marketingAgencies.push(agency);
        log(draft, { action: "Marketing agency added", recordType: "MarketingAgency", recordRef: agency.name });
      });
      return agency;
    },
    [log, update],
  );

  const updateMarketingAgency = useCallback<SystemContextValue["updateMarketingAgency"]>(
    (id, patch) => {
      update((draft) => {
        const agency = draft.marketingAgencies.find((item) => item.id === id);
        if (!agency) return;
        Object.assign(agency, patch);
        log(draft, { action: "Marketing agency updated", recordType: "MarketingAgency", recordRef: agency.name });
      });
    },
    [log, update],
  );

  const setMarketingAgencyActive = useCallback<SystemContextValue["setMarketingAgencyActive"]>(
    (id, active) => {
      update((draft) => {
        const agency = draft.marketingAgencies.find((item) => item.id === id);
        if (!agency) return;
        agency.active = active;
        log(draft, {
          action: active ? "Marketing agency restored" : "Marketing agency archived",
          recordType: "MarketingAgency",
          recordRef: agency.name,
        });
      });
    },
    [log, update],
  );

  const setAgencyCourseRebate = useCallback<SystemContextValue["setAgencyCourseRebate"]>(
    (id, courseCode, centavos) => {
      update((draft) => {
        const agency = draft.marketingAgencies.find((item) => item.id === id);
        if (!agency) return;
        if (centavos > 0) agency.rebates[courseCode] = centavos;
        else delete agency.rebates[courseCode];
        log(draft, { action: "Agency rebate updated", recordType: "MarketingAgency", recordRef: agency.name, detail: courseCode });
      });
    },
    [log, update],
  );

  const addInstructor = useCallback<SystemContextValue["addInstructor"]>(
    (input) => {
      const instructor: Instructor = { ...input, id: uid("ins"), active: true };
      update((draft) => {
        draft.instructors.push(instructor);
        log(draft, { action: "Instructor added", recordType: "Instructor", recordRef: instructor.name });
      });
      return instructor;
    },
    [log, update],
  );

  const updateInstructor = useCallback<SystemContextValue["updateInstructor"]>(
    (id, patch) => {
      update((draft) => {
        const instructor = draft.instructors.find((item) => item.id === id);
        if (!instructor) return;
        Object.assign(instructor, patch);
        log(draft, { action: "Instructor updated", recordType: "Instructor", recordRef: instructor.name });
      });
    },
    [log, update],
  );

  const setInstructorActive = useCallback<SystemContextValue["setInstructorActive"]>(
    (id, active) => {
      update((draft) => {
        const instructor = draft.instructors.find((item) => item.id === id);
        if (!instructor) return;
        instructor.active = active;
        log(draft, { action: active ? "Instructor restored" : "Instructor archived", recordType: "Instructor", recordRef: instructor.name });
      });
    },
    [log, update],
  );

  const addClassroom = useCallback<SystemContextValue["addClassroom"]>(
    (input) => {
      const classroom: Classroom = { ...input, id: uid("room"), active: true };
      update((draft) => {
        draft.classrooms.push(classroom);
        log(draft, { action: "Classroom added", recordType: "Classroom", recordRef: classroom.name });
      });
      return classroom;
    },
    [log, update],
  );

  const updateClassroom = useCallback<SystemContextValue["updateClassroom"]>(
    (id, patch) => {
      update((draft) => {
        const classroom = draft.classrooms.find((item) => item.id === id);
        if (!classroom) return;
        Object.assign(classroom, patch);
        log(draft, { action: "Classroom updated", recordType: "Classroom", recordRef: classroom.name });
      });
    },
    [log, update],
  );

  const setClassroomActive = useCallback<SystemContextValue["setClassroomActive"]>(
    (id, active) => {
      update((draft) => {
        const classroom = draft.classrooms.find((item) => item.id === id);
        if (!classroom) return;
        classroom.active = active;
        log(draft, { action: active ? "Classroom restored" : "Classroom archived", recordType: "Classroom", recordRef: classroom.name });
      });
    },
    [log, update],
  );

  const addEmployee = useCallback<SystemContextValue["addEmployee"]>(
    (input) => {
      let created: Employee | undefined;
      update((draft) => {
        const highest = draft.employees.reduce((top, item) => {
          const match = /^EMP-(\d+)$/.exec(item.employeeNumber);
          return match ? Math.max(top, Number(match[1])) : top;
        }, 0);
        const employee: Employee = { ...input, id: uid("emp"), employeeNumber: `EMP-${String(highest + 1).padStart(3, "0")}`, status: "Active" };
        draft.employees.push(employee);
        created = employee;
        log(draft, { action: "Employee added", recordType: "Employee", recordRef: employee.employeeNumber, detail: employee.name });
      });
      return created;
    },
    [log, update],
  );

  const updateEmployee = useCallback<SystemContextValue["updateEmployee"]>(
    (id, patch) => {
      update((draft) => {
        const employee = draft.employees.find((item) => item.id === id);
        if (!employee) return;
        Object.assign(employee, patch);
        log(draft, { action: "Employee updated", recordType: "Employee", recordRef: employee.employeeNumber, detail: employee.name });
      });
    },
    [log, update],
  );

  const setEmployeeStatus = useCallback<SystemContextValue["setEmployeeStatus"]>(
    (id, status) => {
      update((draft) => {
        const employee = draft.employees.find((item) => item.id === id);
        if (!employee) return;
        employee.status = status;
        log(draft, { action: `Employee ${status.toLowerCase()}`, recordType: "Employee", recordRef: employee.employeeNumber, detail: employee.name });
      });
    },
    [log, update],
  );

  const upsertHrAttendance = useCallback<SystemContextValue["upsertHrAttendance"]>(
    (input) => {
      update((draft) => {
        const existing = draft.hrAttendance.find((item) => item.employeeId === input.employeeId && item.date === input.date);
        if (existing) Object.assign(existing, input);
        else draft.hrAttendance.unshift({ ...input, id: uid("att") });
        const employee = draft.employees.find((item) => item.id === input.employeeId);
        log(draft, { action: "Attendance logged", recordType: "HrAttendance", recordRef: employee?.employeeNumber ?? input.employeeId, detail: `${input.date} · ${input.status}` });
      });
    },
    [log, update],
  );

  const createLeave = useCallback<SystemContextValue["createLeave"]>(
    (input) => {
      let created: LeaveRequest | undefined;
      update((draft) => {
        const leave: LeaveRequest = { ...input, id: uid("lv"), reference: nextReference(draft.leaveRequests.map((item) => item.reference), "LVE"), status: "Pending" };
        draft.leaveRequests.unshift(leave);
        created = leave;
        log(draft, { action: "Leave filed", recordType: "Leave", recordRef: leave.reference });
      });
      return created;
    },
    [log, update],
  );

  const createCashAdvance = useCallback<SystemContextValue["createCashAdvance"]>(
    (input) => {
      let created: CashAdvance | undefined;
      update((draft) => {
        const advance: CashAdvance = { ...input, id: uid("ca"), reference: nextReference(draft.cashAdvances.map((item) => item.reference), "CA"), status: "Pending", createdAt: new Date().toISOString() };
        draft.cashAdvances.unshift(advance);
        created = advance;
        log(draft, { action: "Cash advance filed", recordType: "CashAdvance", recordRef: advance.reference });
      });
      return created;
    },
    [log, update],
  );

  const decideCashAdvance = useCallback<SystemContextValue["decideCashAdvance"]>(
    (id, decision) => {
      update((draft) => {
        const advance = draft.cashAdvances.find((item) => item.id === id);
        if (!advance) return;
        advance.status = decision;
        advance.decidedAt = new Date().toISOString();
        advance.decidedBy = actor;
        log(draft, { action: `Cash advance ${decision.toLowerCase()}`, recordType: "CashAdvance", recordRef: advance.reference });
      });
    },
    [actor, log, update],
  );

  const postAnnouncement = useCallback<SystemContextValue["postAnnouncement"]>(
    (input) => {
      const announcement: Announcement = {
        ...input,
        id: uid("ann"),
        postedBy: actor,
        postedAt: new Date().toISOString(),
      };
      update((draft) => {
        draft.announcements.unshift(announcement);
        log(draft, { action: "Announcement posted", recordType: "Announcement", recordRef: announcement.title });
      });
      return announcement;
    },
    [actor, log, update],
  );

  const updateAnnouncement = useCallback<SystemContextValue["updateAnnouncement"]>(
    (id, patch) => {
      update((draft) => {
        const announcement = draft.announcements.find((item) => item.id === id);
        if (!announcement) return;
        Object.assign(announcement, patch);
        log(draft, { action: "Announcement updated", recordType: "Announcement", recordRef: announcement.title });
      });
    },
    [log, update],
  );

  const removeAnnouncement = useCallback<SystemContextValue["removeAnnouncement"]>(
    (id) => {
      update((draft) => {
        const announcement = draft.announcements.find((item) => item.id === id);
        draft.announcements = draft.announcements.filter((item) => item.id !== id);
        if (announcement) {
          log(draft, { action: "Announcement removed", recordType: "Announcement", recordRef: announcement.title });
        }
      });
    },
    [log, update],
  );

  const createBatch = useCallback<SystemContextValue["createBatch"]>(
    (input) => {
      const batch: Batch = { ...input, id: uid("b"), status: "Draft", publishedAt: null };
      update((draft) => {
        draft.batches.push(batch);
        for (let index = 0; index < batch.trainingDays; index += 1) {
          const date = new Date(`${batch.startsOn}T00:00:00`);
          date.setDate(date.getDate() + index);
          const isoDate = date.toISOString().slice(0, 10);
          draft.attendanceSessions.push({
            id: `${batch.id}-s${index + 1}`,
            batchId: batch.id,
            dayNumber: index + 1,
            sessionDate: isoDate,
            name: `Day ${index + 1}`,
            startsAt: `${isoDate}T08:00:00`,
            endsAt: `${isoDate}T17:00:00`,
            lateThresholdMinutes: 15,
            minimumRequiredMinutes: 360,
            state: "Planned",
          });
        }
        log(draft, { action: "Batch created", recordType: "Batch", recordRef: batch.batchNumber });
      });
      return batch;
    },
    [log, update],
  );

  const autoOpenMonth = useCallback<SystemContextValue["autoOpenMonth"]>(
    ({ courseCode, year, month, capacity, venue, instructor }) => {
      let created = 0;
      update((draft) => {
        const course = draft.courses.find((item) => item.code === courseCode);
        if (!course) return;
        const trainingDays = courseDays(course.duration);
        // Only future dates matter, and only ones not already scheduled — the
        // action is idempotent, so re-running a month never duplicates batches.
        const today = todayIso();
        const starts = monthlyBatchStarts(courseCode, course.duration, year, month).filter((startsOn) => startsOn > today);
        starts.forEach((startsOn) => {
          const exists = draft.batches.some(
            (batch) => batch.courseCode === courseCode && batch.startsOn === startsOn && batch.status !== "Cancelled",
          );
          if (exists) return;
          const endsOn = automaticEndDate(startsOn, course.duration);
          const deadline = new Date(`${startsOn}T17:00:00`);
          deadline.setDate(deadline.getDate() - 1);
          const batch: Batch = {
            id: uid("b"),
            batchNumber: `${course.code}-${year}-${String(Math.floor(100 + Math.random() * 899))}`,
            courseCode: course.code,
            courseName: course.course,
            centerName: "New Wave Maritime",
            startsOn,
            endsOn,
            mode: course.modality,
            venue,
            capacity,
            instructor,
            status: "Open",
            publishedAt: new Date().toISOString(),
            enrollmentDeadline: deadline.toISOString(),
            feeCentavos: course.priceCentavos,
            trainingDays,
          };
          draft.batches.push(batch);
          for (let index = 0; index < trainingDays; index += 1) {
            const date = new Date(`${startsOn}T00:00:00`);
            date.setDate(date.getDate() + index);
            const isoDate = date.toISOString().slice(0, 10);
            draft.attendanceSessions.push({
              id: `${batch.id}-s${index + 1}`,
              batchId: batch.id,
              dayNumber: index + 1,
              sessionDate: isoDate,
              name: `Day ${index + 1}`,
              startsAt: `${isoDate}T08:00:00`,
              endsAt: `${isoDate}T17:00:00`,
              lateThresholdMinutes: 15,
              minimumRequiredMinutes: 360,
              state: "Planned",
            });
          }
          created += 1;
        });
        if (created > 0) {
          log(draft, {
            action: "Monthly schedules auto-opened",
            recordType: "Batch",
            recordRef: `${course.code} · ${year}-${String(month).padStart(2, "0")}`,
            detail: `${created} batch${created === 1 ? "" : "es"} published`,
          });
        }
      });
      return created;
    },
    [log, update],
  );

  const publishBatch = useCallback<SystemContextValue["publishBatch"]>(
    (id) => {
      update((draft) => {
        const batch = draft.batches.find((item) => item.id === id);
        if (!batch) return;
        batch.publishedAt = new Date().toISOString();
        batch.status = "Open";
        log(draft, { action: "Batch published", recordType: "Batch", recordRef: batch.batchNumber });
      });
    },
    [log, update],
  );

  const setBatchStatus = useCallback<SystemContextValue["setBatchStatus"]>(
    (id, status) => {
      update((draft) => {
        const batch = draft.batches.find((item) => item.id === id);
        if (!batch) return;
        batch.status = status;
        if (status === "Cancelled") batch.publishedAt = null;
        log(draft, { action: `Batch set to ${status}`, recordType: "Batch", recordRef: batch.batchNumber });
      });
    },
    [log, update],
  );

  const sendInstructions = useCallback<SystemContextValue["sendInstructions"]>(
    (enrollmentId) => {
      update((draft) => {
        const enrollment = draft.enrollments.find((item) => item.id === enrollmentId);
        if (!enrollment) return;
        enrollment.instructionsSentAt = new Date().toISOString();
        const batch = draft.batches.find((item) => item.id === enrollment.batchId);
        notify(draft, {
          audience: "trainee",
          traineeId: enrollment.traineeId,
          title: "Training instructions sent",
          body: `Review the reporting details for ${batch?.batchNumber ?? enrollment.courseName} and acknowledge.`,
        });
        log(draft, { action: "Instructions sent", recordType: "Enrollment", recordRef: enrollment.reference });
      });
    },
    [log, notify, update],
  );

  const acknowledgeInstructions = useCallback<SystemContextValue["acknowledgeInstructions"]>(
    (enrollmentId) => {
      update((draft) => {
        const enrollment = draft.enrollments.find((item) => item.id === enrollmentId);
        if (!enrollment || !enrollment.instructionsSentAt) return;
        enrollment.instructionsAcknowledgedAt = new Date().toISOString();
        notify(draft, {
          audience: "staff",
          title: "Instructions acknowledged",
          body: `${enrollment.reference} acknowledged the training instructions.`,
        });
        log(draft, {
          action: "Instructions acknowledged",
          recordType: "Enrollment",
          recordRef: enrollment.reference,
          actor: "Enrollment status page",
        });
      });
    },
    [log, notify, update],
  );

  const setSessionState = useCallback<SystemContextValue["setSessionState"]>(
    (id, sessionState) => {
      update((draft) => {
        const session = draft.attendanceSessions.find((item) => item.id === id);
        if (!session) return;
        session.state = sessionState;
        if (sessionState === "Submitted") session.submittedAt = new Date().toISOString();
        if (sessionState === "Verified") session.verifiedAt = new Date().toISOString();
        const batch = draft.batches.find((item) => item.id === session.batchId);
        log(draft, {
          action: `Attendance ${sessionState.toLowerCase()}`,
          recordType: "Attendance session",
          recordRef: `${batch?.batchNumber ?? session.batchId} · ${session.name}`,
        });
      });
    },
    [log, update],
  );

  const markAttendance = useCallback<SystemContextValue["markAttendance"]>(
    ({ sessionId, enrollmentId, status, method = "Manual", manualReason }) => {
      update((draft) => {
        const existing = draft.attendanceRecords.find(
          (record) => record.sessionId === sessionId && record.enrollmentId === enrollmentId,
        );
        const session = draft.attendanceSessions.find((item) => item.id === sessionId);
        if (existing) {
          existing.status = status;
          existing.method = method;
          existing.manualReason = manualReason ?? existing.manualReason;
          existing.recordedBy = actor;
        } else {
          draft.attendanceRecords.push({
            id: uid("ar"),
            sessionId,
            enrollmentId,
            status,
            method,
            manualReason,
            checkedInAt: status === "Absent" ? undefined : `${session?.sessionDate}T08:00:00`,
            checkedOutAt: status === "Absent" ? undefined : `${session?.sessionDate}T17:00:00`,
            recordedBy: actor,
          });
        }
        const enrollment = draft.enrollments.find((item) => item.id === enrollmentId);
        log(draft, {
          action: `Attendance marked ${status}`,
          recordType: "Attendance",
          recordRef: enrollment?.reference ?? enrollmentId,
          detail: session?.name,
        });
      });
    },
    [actor, log, update],
  );

  const markTrainingComplete = useCallback<SystemContextValue["markTrainingComplete"]>(
    (enrollmentId, complete) => {
      update((draft) => {
        const enrollment = draft.enrollments.find((item) => item.id === enrollmentId);
        if (!enrollment) return;
        enrollment.completedAt = complete ? new Date().toISOString() : undefined;
        log(draft, {
          action: complete ? "Training marked complete" : "Training completion reversed",
          recordType: "Enrollment",
          recordRef: enrollment.reference,
        });
      });
    },
    [log, update],
  );

  const printCertificate = useCallback<SystemContextValue["printCertificate"]>(
    (enrollmentId) => {
      update((draft) => {
        const certificate = draft.certificates.find((item) => item.enrollmentId === enrollmentId);
        const enrollment = draft.enrollments.find((item) => item.id === enrollmentId);
        if (!certificate || !enrollment) return;
        if (!draft.settings.certificateTemplateApproved || !draft.settings.certificateIssuanceEnabled) return;
        if (certificate.status !== "Ready to Print" && certificate.status !== "Printed") return;
        if (!certificate.certificateNumber) {
          // Per-course-code running sequence, e.g. BST-2026-0001.
          const prefix = `${enrollment.courseCode}-${new Date().getFullYear()}-`;
          const highest = draft.certificates.reduce((top, item) => {
            const number = item.certificateNumber ?? "";
            if (!number.startsWith(prefix)) return top;
            const match = /-(\d+)$/.exec(number);
            return match ? Math.max(top, Number(match[1])) : top;
          }, 0);
          certificate.certificateNumber = `${prefix}${String(highest + 1).padStart(4, "0")}`;
        }
        if (certificate.status === "Printed") certificate.reprintCount += 1;
        certificate.status = "Printed";
        certificate.printedAt = new Date().toISOString();
        certificate.updatedAt = new Date().toISOString();
        log(draft, {
          action: certificate.reprintCount > 0 ? "Certificate reprinted" : "Certificate printed",
          recordType: "Certificate",
          recordRef: certificate.certificateNumber,
          detail: enrollment.reference,
        });
      });
    },
    [log, update],
  );

  const releaseCertificate = useCallback<SystemContextValue["releaseCertificate"]>(
    (enrollmentId, recipient) => {
      update((draft) => {
        const certificate = draft.certificates.find((item) => item.enrollmentId === enrollmentId);
        const enrollment = draft.enrollments.find((item) => item.id === enrollmentId);
        if (!certificate || !enrollment || certificate.status !== "Printed") return;
        certificate.status = "Released";
        certificate.releasedAt = new Date().toISOString();
        certificate.releasedTo = recipient;
        certificate.updatedAt = new Date().toISOString();
        notify(draft, {
          audience: "trainee",
          traineeId: enrollment.traineeId,
          title: "Certificate released",
          body: `${certificate.certificateNumber} was released to ${recipient}.`,
        });
        log(draft, {
          action: "Certificate released",
          recordType: "Certificate",
          recordRef: certificate.certificateNumber ?? enrollment.reference,
          detail: recipient,
        });
      });
    },
    [log, notify, update],
  );

  const createRequest = useCallback<SystemContextValue["createRequest"]>(
    (input) => {
      const request: ChangeRequest = {
        id: uid("q"),
        reference: "",
        type: input.type,
        enrollmentId: input.enrollmentId,
        traineeName: input.traineeName,
        reason: input.reason,
        requestedBy: input.requestedBy ?? actor,
        status: "Pending",
        payload: input.payload,
        createdAt: new Date().toISOString(),
      };
      update((draft) => {
        request.reference = nextReference(draft.requests.map((item) => item.reference), "REQ");
        draft.requests.unshift(request);
        notify(draft, {
          audience: "staff",
          title: "Request needs review",
          body: `${request.type} · ${request.traineeName}`,
        });
        log(draft, { action: "Request submitted", recordType: "Request", recordRef: request.reference, detail: request.type });
      });
      return request;
    },
    [actor, log, notify, update],
  );

  const decideRequest = useCallback<SystemContextValue["decideRequest"]>(
    (id, decision, remarks) => {
      update((draft) => {
        const request = draft.requests.find((item) => item.id === id);
        if (!request) return;
        request.status = decision;
        request.remarks = remarks ?? request.remarks;
        request.decidedAt = new Date().toISOString();
        request.decidedBy = actor;
        if (decision === "Approved" && request.type === "Cancellation" && request.enrollmentId) {
          const enrollment = draft.enrollments.find((item) => item.id === request.enrollmentId);
          if (enrollment) {
            enrollment.status = "Cancelled";
            enrollment.cancelledReason = request.reason;
          }
        }
        // Expense approval now flows through Requests: approving the request
        // approves the linked voucher, rejecting it rejects the voucher.
        if (request.type === "Expenses" && request.payload?.expenseId) {
          const expense = draft.expenses.find((item) => item.id === request.payload?.expenseId);
          if (expense && (decision === "Approved" || decision === "Rejected")) {
            expense.status = decision;
            expense.decidedBy = actor;
            expense.decidedAt = new Date().toISOString();
          }
        }
        // Releasing a rebate posts the agency discount to the enrollment ledger
        // only once Accounting approves the request.
        if (decision === "Approved" && request.type === "Releasing Rebates" && request.enrollmentId) {
          const enrollment = draft.enrollments.find((item) => item.id === request.enrollmentId);
          const amountCentavos = Number(request.payload?.amountCentavos ?? "0");
          if (enrollment && amountCentavos > 0) {
            draft.ledger.unshift({
              id: uid("discount"),
              reference: `DIS-${enrollment.reference}-${draft.ledger.length + 1}`,
              enrollmentId: enrollment.id,
              type: "discount",
              amountCentavos,
              description: `Marketing agency rebate — ${request.payload?.agencyName ?? "agency"}`,
              verification: "Not required",
              recordedBy: actor,
              recordedAt: new Date().toISOString(),
              valid: true,
            });
          }
        }
        // Batch-change requests (Training Ops) apply to a batch on approval.
        if (decision === "Approved" && request.payload?.batchId) {
          const batch = draft.batches.find((item) => item.id === request.payload?.batchId);
          if (batch) {
            if (request.type === "Change of instructor" && request.payload.value) batch.instructor = request.payload.value;
            if (request.type === "Change of room" && request.payload.value) batch.venue = request.payload.value;
            if (request.type === "Batch cancellation") batch.status = "Cancelled";
            if (request.type === "Batch rescheduling") {
              if (request.payload.startsOn) batch.startsOn = request.payload.startsOn;
              if (request.payload.endsOn) batch.endsOn = request.payload.endsOn;
            }
          }
        }
        const enrollment = draft.enrollments.find((item) => item.id === request.enrollmentId);
        if (enrollment) {
          notify(draft, {
            audience: "trainee",
            traineeId: enrollment.traineeId,
            title: `Request ${decision.toLowerCase()}`,
            body: `${request.type} · ${request.reference}${remarks ? ` — ${remarks}` : ""}`,
          });
        }
        log(draft, { action: `Request ${decision.toLowerCase()}`, recordType: "Request", recordRef: request.reference });
      });
    },
    [actor, log, notify, update],
  );

  const decideLeave = useCallback<SystemContextValue["decideLeave"]>(
    (id, decision) => {
      update((draft) => {
        const leave = draft.leaveRequests.find((item) => item.id === id);
        if (!leave) return;
        leave.status = decision;
        leave.decidedAt = new Date().toISOString();
        log(draft, { action: `Leave ${decision.toLowerCase()}`, recordType: "Leave", recordRef: leave.reference });
      });
    },
    [log, update],
  );

  const advancePayroll = useCallback<SystemContextValue["advancePayroll"]>(
    (id) => {
      update((draft) => {
        const period = draft.payrollPeriods.find((item) => item.id === id);
        if (!period) return;
        const finalizing = period.status === "For review";
        period.status = period.status === "Draft" ? "For review" : "Finalized";
        if (period.status === "Finalized") period.finalizedAt = new Date().toISOString();
        // Once released, payroll is a real disbursement — post it as a Paid
        // expense so it flows into the expense/disbursement figures.
        if (finalizing && period.status === "Finalized") {
          const net = period.items.reduce((sum, item) => sum + item.grossCentavos - item.deductionCentavos, 0);
          const year = new Date().getFullYear();
          const highest = draft.expenses.reduce((top, item) => {
            const match = new RegExp(`^EXP-${year}-(\\d{4})$`).exec(item.expenseNumber);
            return match ? Math.max(top, Number(match[1])) : top;
          }, 0);
          draft.expenses.unshift({
            id: uid("exp"),
            expenseNumber: `EXP-${year}-${String(highest + 1).padStart(4, "0")}`,
            payee: "Payroll",
            category: "Payroll",
            amountCentavos: net,
            purpose: `Payroll disbursement — ${period.periodNumber}`,
            status: "Paid",
            createdAt: new Date().toISOString(),
            decidedBy: actor,
            decidedAt: new Date().toISOString(),
            modeOfPayment: "Bank transfer",
            requestedBy: actor,
          });
        }
        log(draft, { action: `Payroll ${period.status.toLowerCase()}`, recordType: "Payroll", recordRef: period.periodNumber });
      });
    },
    [actor, log, update],
  );

  const createExpense = useCallback<SystemContextValue["createExpense"]>(
    (input) => {
      const year = new Date().getFullYear();
      const expense: Expense = {
        id: uid("exp"),
        expenseNumber: "",
        payee: input.payee ?? input.payor ?? "—",
        category: input.category,
        amountCentavos: input.amountCentavos,
        purpose: input.purpose,
        status: "Pending",
        createdAt: new Date().toISOString(),
        itemUnit: input.itemUnit,
        quantity: input.quantity,
        payor: input.payor,
        modeOfPayment: input.modeOfPayment,
        remarks: input.remarks,
        requestedBy: actor,
      };
      update((draft) => {
        const highest = draft.expenses.reduce((top, item) => {
          const match = new RegExp(`^EXP-${year}-(\\d{4})$`).exec(item.expenseNumber);
          return match ? Math.max(top, Number(match[1])) : top;
        }, 0);
        expense.expenseNumber = `EXP-${year}-${String(highest + 1).padStart(4, "0")}`;
        draft.expenses.unshift(expense);
        notify(draft, {
          audience: "staff",
          title: "Expense voucher for approval",
          body: `${expense.expenseNumber} · ${expense.category} · needs Accounting Manager approval.`,
        });
        log(draft, { action: "Expense voucher created", recordType: "Expense", recordRef: expense.expenseNumber });
      });
      return expense;
    },
    [actor, log, notify, update],
  );

  const decideExpense = useCallback<SystemContextValue["decideExpense"]>(
    (id, decision) => {
      update((draft) => {
        const expense = draft.expenses.find((item) => item.id === id);
        if (!expense) return;
        expense.status = decision;
        expense.decidedBy = actor;
        expense.decidedAt = new Date().toISOString();
        log(draft, { action: `Expense ${decision.toLowerCase()}`, recordType: "Expense", recordRef: expense.expenseNumber });
      });
    },
    [actor, log, update],
  );

  const resolveMessage = useCallback<SystemContextValue["resolveMessage"]>(
    (id) => {
      update((draft) => {
        const message = draft.contactMessages.find((item) => item.id === id);
        if (message) message.resolvedAt = new Date().toISOString();
      });
    },
    [update],
  );

  const updateSettings = useCallback<SystemContextValue["updateSettings"]>(
    (patch) => {
      update((draft) => {
        Object.assign(draft.settings, patch);
        if (!draft.settings.certificateTemplateApproved) draft.settings.certificateIssuanceEnabled = false;
        log(draft, {
          action: "Settings updated",
          recordType: "Settings",
          recordRef: Object.keys(patch).join(", "),
        });
      });
    },
    [log, update],
  );

  const markNotificationsRead = useCallback(() => {
    update((draft) => {
      const now = new Date().toISOString();
      draft.notifications.forEach((item) => {
        if (!item.readAt) item.readAt = now;
      });
    });
  }, [update]);

  const resetSystem = useCallback(() => {
    setState(reconcile(createSeedState()));
  }, []);

  const value = useMemo<SystemContextValue>(
    () => ({
      ready,
      state,
      actor,
      setActor,
      submitRegistration,
      updateSubmissionStatus,
      reviewSelection,
      approveSelection,
      createEnrollment,
      createEndorsedEnrollment,
      changeEnrollmentBatch,
      setRegistrationStatus,
      generateAdmissionSlip,
      cancelEnrollment,
      createTrainee,
      setTraineeFacebook,
      mergeTrainees,
      recordPayment,
      setPaymentVerification,
      addLedgerEntry,
      addCourse,
      updateCourse,
      setCourseActive,
      addPartnerOffer,
      updatePartnerOffer,
      setPartnerOfferActive,
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
      addInstructor,
      updateInstructor,
      setInstructorActive,
      addClassroom,
      updateClassroom,
      setClassroomActive,
      addEmployee,
      updateEmployee,
      setEmployeeStatus,
      upsertHrAttendance,
      createLeave,
      createCashAdvance,
      decideCashAdvance,
      postAnnouncement,
      updateAnnouncement,
      removeAnnouncement,
      createBatch,
      autoOpenMonth,
      publishBatch,
      setBatchStatus,
      sendInstructions,
      acknowledgeInstructions,
      setSessionState,
      markAttendance,
      markTrainingComplete,
      printCertificate,
      releaseCertificate,
      createRequest,
      decideRequest,
      decideLeave,
      advancePayroll,
      createExpense,
      decideExpense,
      resolveMessage,
      updateSettings,
      markNotificationsRead,
      resetSystem,
      view,
      views,
      submissionSelections,
      seats,
      openBatchesFor,
    }),
    [
      acknowledgeInstructions,
      actor,
      addCourse,
      addLedgerEntry,
      addPartnerOffer,
      addPaymentChannel,
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
      addInstructor,
      updateInstructor,
      setInstructorActive,
      addClassroom,
      updateClassroom,
      setClassroomActive,
      addEmployee,
      updateEmployee,
      setEmployeeStatus,
      upsertHrAttendance,
      createLeave,
      createCashAdvance,
      decideCashAdvance,
      advancePayroll,
      postAnnouncement,
      removeAnnouncement,
      updateAnnouncement,
      approveSelection,
      cancelEnrollment,
      changeEnrollmentBatch,
      setRegistrationStatus,
      generateAdmissionSlip,
      createBatch,
      createEnrollment,
      createEndorsedEnrollment,
      autoOpenMonth,
      createRequest,
      createTrainee,
      setTraineeFacebook,
      mergeTrainees,
      createExpense,
      decideExpense,
      decideLeave,
      decideRequest,
      markAttendance,
      markNotificationsRead,
      markTrainingComplete,
      openBatchesFor,
      printCertificate,
      publishBatch,
      ready,
      recordPayment,
      releaseCertificate,
      resetSystem,
      resolveMessage,
      reviewSelection,
      seats,
      sendInstructions,
      setBatchStatus,
      setCourseActive,
      setPartnerOfferActive,
      setPaymentChannelActive,
      setPaymentVerification,
      setSessionState,
      updateCourse,
      updatePartnerOffer,
      updatePaymentChannel,
      state,
      submissionSelections,
      submitRegistration,
      updateSettings,
      updateSubmissionStatus,
      view,
      views,
    ],
  );

  return <SystemContext.Provider value={value}>{children}</SystemContext.Provider>;
}

export function useSystem() {
  const context = useContext(SystemContext);
  if (!context) throw new Error("useSystem must be used inside <SystemProvider>.");
  return context;
}
