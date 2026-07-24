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
import { chooseSurvivor, findSrnDuplicates, mergeInto } from "@/lib/trainee-identity";
import { IN_HOUSE_COURSES } from "@/lib/in-house-catalog";
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
  CourseSelection,
  Enrollment,
  EnrollmentView,
  LedgerEntry,
  RegistrationStatus,
  RegistrationSubmission,
  RequestType,
  SelectionStatus,
  Settings,
  Stage,
  SystemState,
  Trainee,
} from "./types";

const STORAGE_KEY = "new-wave-system-v6";

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
  cancelEnrollment: (id: string, reason: string) => void;
  createTrainee: (input: Omit<Trainee, "id" | "traineeNumber" | "createdAt">) => Trainee;
  /* money */
  recordPayment: (input: PaymentInput) => LedgerEntry | undefined;
  setPaymentVerification: (id: string, verification: "Verified" | "Rejected") => void;
  addLedgerEntry: (input: { enrollmentId: string; type: LedgerEntry["type"]; amountCentavos: number; description: string }) => void;
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
  createRequest: (input: { type: RequestType; enrollmentId?: string; traineeName: string; reason: string; requestedBy?: string }) => ChangeRequest;
  decideRequest: (id: string, decision: "Approved" | "Rejected" | "For clarification", remarks?: string) => void;
  decideLeave: (id: string, decision: "Approved" | "Rejected") => void;
  advancePayroll: (id: string) => void;
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

function loadInitialState(): SystemState {
  if (typeof window === "undefined") return createSeedState();
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as SystemState;
      if (parsed.version === SYSTEM_VERSION) return reconcile(parsed);
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
        if (parsed.version === SYSTEM_VERSION) setState(parsed);
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
        // An existing trainee sharing email, mobile or SRN flags the whole
        // submission for authorized duplicate review before any enrollment.
        const duplicate = draft.trainees.find(
          (trainee) =>
            trainee.email.toLowerCase() === input.applicant.email.toLowerCase() ||
            trainee.mobile === input.applicant.mobile ||
            (Boolean(input.applicant.srn) && trainee.srn === input.applicant.srn),
        );
        if (duplicate) {
          submission.status = "Possible Duplicate";
          submission.traineeId = duplicate.id;
          submission.remarks = `Matches existing trainee ${duplicate.traineeNumber}.`;
          submission.publicStatusMessage = "Your selected courses are being reviewed.";
        }
        draft.submissions.unshift(submission);
        input.selections.slice(0, 5).forEach((selection, index) => {
          draft.courseSelections.push({
            id: uid("sel"),
            submissionId: submission.id,
            courseCode: selection.courseCode,
            courseName: selection.courseName,
            batchId: selection.batchId,
            sequence: index + 1,
            status: "New",
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
        notify(draft, {
          audience: "staff",
          title: "New registration received",
          body: `${fullName(input.applicant)} selected ${input.selections.length} course${input.selections.length === 1 ? "" : "s"}.`,
        });
        log(draft, {
          action: "Registration submitted",
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
      const course = IN_HOUSE_COURSES.find((item) => item.code === courseCode);
      if (!course) return 0;
      let created = 0;
      update((draft) => {
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
          const highest = draft.certificates.reduce((top, item) => {
            const match = /-(\d{6})$/.exec(item.certificateNumber ?? "");
            return match ? Math.max(top, Number(match[1])) : top;
          }, 0);
          certificate.certificateNumber = `NWM-${enrollment.courseCode}-${new Date().getFullYear()}-${String(highest + 1).padStart(6, "0")}`;
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
        period.status = period.status === "Draft" ? "For review" : "Finalized";
        if (period.status === "Finalized") period.finalizedAt = new Date().toISOString();
        log(draft, { action: `Payroll ${period.status.toLowerCase()}`, recordType: "Payroll", recordRef: period.periodNumber });
      });
    },
    [log, update],
  );

  const decideExpense = useCallback<SystemContextValue["decideExpense"]>(
    (id, decision) => {
      update((draft) => {
        const expense = draft.expenses.find((item) => item.id === id);
        if (!expense) return;
        expense.status = decision;
        log(draft, { action: `Expense ${decision.toLowerCase()}`, recordType: "Expense", recordRef: expense.expenseNumber });
      });
    },
    [log, update],
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
      cancelEnrollment,
      createTrainee,
      recordPayment,
      setPaymentVerification,
      addLedgerEntry,
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
      addLedgerEntry,
      advancePayroll,
      approveSelection,
      cancelEnrollment,
      createBatch,
      createEnrollment,
      autoOpenMonth,
      createRequest,
      createTrainee,
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
      setPaymentVerification,
      setSessionState,
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
