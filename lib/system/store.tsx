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
  isCompletionRequirementMet,
  suggestAttendanceStatus,
  type AttendanceStatus,
  type CompletionRequirement,
} from "@/lib/domain";
import { IN_HOUSE_COURSES } from "@/lib/in-house-catalog";
import { createSeedState, SYSTEM_VERSION } from "./seed";
import type {
  ActivityEntry,
  AttendanceSession,
  Batch,
  Certificate,
  ChangeRequest,
  Enrollment,
  EnrollmentView,
  LedgerEntry,
  Registration,
  RequestType,
  Settings,
  Stage,
  SystemState,
  Trainee,
} from "./types";

const STORAGE_KEY = "new-wave-system-v4";

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

/** Courses New Wave delivers itself, as opposed to endorsed partner offers. */
function isNewWaveCourse(courseCode: string) {
  return IN_HOUSE_COURSES.some((course) => course.code === courseCode);
}

export function completionRequirementOf(enrollment: Enrollment): CompletionRequirement {
  return {
    isNewWaveCourse: isNewWaveCourse(enrollment.courseCode),
    feedbackFormCompleted: Boolean(enrollment.feedbackFormCompletedAt),
    completionProofUploaded: Boolean(enrollment.completionProofUploadedAt),
  };
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
  return {
    sessions,
    attendance,
    eligible: isCertificateEligible({
      attendance: everySessionRecorded ? attendance : [],
      instructorSubmitted: sessions.length > 0 && sessions.every((session) => session.state === "Submitted" || session.state === "Verified"),
      operationsVerified: sessions.length > 0 && sessions.every((session) => session.state === "Verified"),
      templateActive: state.settings.certificateTemplateApproved && state.settings.certificateIssuanceEnabled,
      certificateNumberAvailable: true,
      legalNameConfirmed: true,
      completion: completionRequirementOf(enrollment),
    }),
    attendanceComplete:
      everySessionRecorded &&
      attendance.every((status) => ["Present", "Late", "Make-Up Completed"].includes(status)),
  };
}

function certificateBlockReason(state: SystemState, enrollment: Enrollment) {
  const { sessions, attendanceComplete } = certificateEligibility(state, enrollment);
  if (sessions.length === 0) return "No attendance sessions scheduled yet.";
  if (!attendanceComplete) return "Attendance is incomplete or has make-up requirements.";
  if (!sessions.every((session) => session.state === "Verified")) return "Training Operations has not verified all sessions.";
  if (!isCompletionRequirementMet(completionRequirementOf(enrollment))) {
    return "The trainee must complete the feedback form or upload the required screenshot.";
  }
  if (!state.settings.certificateTemplateApproved) return "No approved certificate template.";
  if (!state.settings.certificateIssuanceEnabled) return "Certificate issuance is switched off in Settings.";
  return undefined;
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

type RegistrationInput = {
  firstName: string;
  middleName?: string;
  lastName: string;
  birthDate: string;
  email: string;
  mobile: string;
  address?: string;
  emergencyContactName?: string;
  emergencyContactMobile?: string;
  courseCode: string;
  courseName: string;
  batchId: string;
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
  submitRegistration: (input: RegistrationInput) => Registration;
  updateRegistrationStatus: (id: string, status: Registration["status"], remarks?: string) => void;
  approveRegistration: (id: string) => Enrollment | undefined;
  createEnrollment: (input: { traineeId: string; batchId: string }) => Enrollment | undefined;
  cancelEnrollment: (id: string, reason: string) => void;
  createTrainee: (input: Omit<Trainee, "id" | "traineeNumber" | "createdAt">) => Trainee;
  /* money */
  recordPayment: (input: PaymentInput) => LedgerEntry | undefined;
  setPaymentVerification: (id: string, verification: "Verified" | "Rejected") => void;
  addLedgerEntry: (input: { enrollmentId: string; type: LedgerEntry["type"]; amountCentavos: number; description: string }) => void;
  /* operations */
  createBatch: (input: Omit<Batch, "id" | "status" | "publishedAt">) => Batch;
  publishBatch: (id: string) => void;
  setBatchStatus: (id: string, status: Batch["status"]) => void;
  sendInstructions: (enrollmentId: string) => void;
  acknowledgeInstructions: (enrollmentId: string) => void;
  setSessionState: (id: string, state: AttendanceSession["state"]) => void;
  markAttendance: (input: { sessionId: string; enrollmentId: string; status: AttendanceStatus; method?: "QR" | "Manual"; manualReason?: string }) => void;
  scanAttendance: (input: { sessionId: string; enrollmentId: string; scanType: "check-in" | "check-out" }) => { ok: boolean; message: string };
  recordCompletionStep: (input: { enrollmentId: string; feedbackForm?: boolean; proofFileName?: string }) => void;
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
  signInTrainee: (identifier: string) => { ok: boolean; message: string };
  signOutTrainee: () => void;
  resetSystem: () => void;
  /* selectors */
  view: (enrollmentId: string) => EnrollmentView | undefined;
  views: () => EnrollmentView[];
  traineeViews: (traineeId: string) => EnrollmentView[];
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

  const traineeViews = useCallback(
    (traineeId: string) => views().filter((item) => item.trainee.id === traineeId),
    [views],
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
      const registration: Registration = {
        ...input,
        id: uid("reg"),
        reference: "",
        status: "Submitted",
        submittedAt: new Date().toISOString(),
      };
      update((draft) => {
        registration.reference = nextReference(
          draft.registrations.map((item) => item.reference),
          "REG",
        );
        const duplicate = draft.trainees.find(
          (trainee) =>
            trainee.email.toLowerCase() === input.email.toLowerCase() || trainee.mobile === input.mobile,
        );
        if (duplicate) {
          registration.status = "Possible Duplicate";
          registration.traineeId = duplicate.id;
          registration.remarks = `Matches existing trainee ${duplicate.traineeNumber}.`;
        }
        draft.registrations.unshift(registration);
        notify(draft, {
          audience: "staff",
          title: "New registration received",
          body: `${fullName(input)} registered for ${input.courseName}.`,
        });
        log(draft, {
          action: "Registration submitted",
          recordType: "Registration",
          recordRef: registration.reference,
          actor: "Public website",
          detail: input.courseName,
        });
      });
      return registration;
    },
    [log, notify, update],
  );

  const updateRegistrationStatus = useCallback<SystemContextValue["updateRegistrationStatus"]>(
    (id, status, remarks) => {
      update((draft) => {
        const registration = draft.registrations.find((item) => item.id === id);
        if (!registration) return;
        registration.status = status;
        registration.remarks = remarks ?? registration.remarks;
        registration.decidedAt = new Date().toISOString();
        log(draft, { action: `Registration ${status.toLowerCase()}`, recordType: "Registration", recordRef: registration.reference });
      });
    },
    [log, update],
  );

  const approveRegistration = useCallback<SystemContextValue["approveRegistration"]>(
    (id) => {
      let created: Enrollment | undefined;
      update((draft) => {
        const registration = draft.registrations.find((item) => item.id === id);
        if (!registration || registration.status === "Approved") return;
        const batch = draft.batches.find((item) => item.id === registration.batchId);
        if (!batch) return;

        let trainee = draft.trainees.find(
          (item) =>
            item.id === registration.traineeId ||
            item.email.toLowerCase() === registration.email.toLowerCase(),
        );
        if (!trainee) {
          const highest = draft.trainees.reduce((top, item) => {
            const match = /^NWM-(\d{6})$/.exec(item.traineeNumber);
            return match ? Math.max(top, Number(match[1])) : top;
          }, 0);
          trainee = {
            id: uid("t"),
            traineeNumber: `NWM-${String(highest + 1).padStart(6, "0")}`,
            firstName: registration.firstName,
            middleName: registration.middleName,
            lastName: registration.lastName,
            birthDate: registration.birthDate,
            email: registration.email,
            mobile: registration.mobile,
            address: registration.address,
            emergencyContactName: registration.emergencyContactName,
            emergencyContactMobile: registration.emergencyContactMobile,
            createdAt: new Date().toISOString(),
          };
          draft.trainees.push(trainee);
        }

        const enrollment: Enrollment = {
          id: uid("e"),
          reference: nextReference(draft.enrollments.map((item) => item.reference), "ENR"),
          traineeId: trainee.id,
          batchId: batch.id,
          courseCode: batch.courseCode,
          courseName: batch.courseName,
          centerName: batch.centerName,
          status: "Enrolled",
          createdAt: new Date().toISOString(),
          registrationReference: registration.reference,
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
        registration.status = "Approved";
        registration.traineeId = trainee.id;
        registration.enrollmentId = enrollment.id;
        registration.decidedAt = new Date().toISOString();
        created = enrollment;
        notify(draft, {
          audience: "trainee",
          traineeId: trainee.id,
          title: "Enrollment created",
          body: `${batch.courseName} · ${enrollment.reference}. Settle your training fee to confirm your slot.`,
        });
        log(draft, {
          action: "Registration approved",
          recordType: "Enrollment",
          recordRef: enrollment.reference,
          detail: `${trainee.traineeNumber} · ${batch.batchNumber}`,
        });
      });
      return created;
    },
    [actor, log, notify, update],
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

  const scanAttendance = useCallback<SystemContextValue["scanAttendance"]>(
    ({ sessionId, enrollmentId, scanType }) => {
      const session = state.attendanceSessions.find((item) => item.id === sessionId);
      if (!session || session.state !== "Open") return { ok: false, message: "The attendance session is not open." };
      const record = state.attendanceRecords.find(
        (item) => item.sessionId === sessionId && item.enrollmentId === enrollmentId,
      );
      if (scanType === "check-out" && !record?.checkedInAt) {
        return { ok: false, message: "Check-in is required before check-out." };
      }
      if (scanType === "check-in" && record?.checkedInAt) {
        return { ok: false, message: "This trainee already checked in." };
      }
      if (scanType === "check-out" && record?.checkedOutAt) {
        return { ok: false, message: "This trainee already checked out." };
      }
      const now = new Date().toISOString();
      update((draft) => {
        const target = draft.attendanceRecords.find(
          (item) => item.sessionId === sessionId && item.enrollmentId === enrollmentId,
        );
        const draftSession = draft.attendanceSessions.find((item) => item.id === sessionId)!;
        if (!target) {
          draft.attendanceRecords.push({
            id: uid("ar"),
            sessionId,
            enrollmentId,
            status: new Date(now).getTime() > new Date(draftSession.startsAt).getTime() + draftSession.lateThresholdMinutes * 60_000 ? "Late" : "Present",
            method: "QR",
            checkedInAt: now,
            recordedBy: actor,
          });
        } else if (scanType === "check-in") {
          target.checkedInAt = now;
          target.method = "QR";
        } else {
          target.checkedOutAt = now;
          target.status = suggestAttendanceStatus({
            checkedInAt: new Date(target.checkedInAt!),
            checkedOutAt: new Date(now),
            sessionStartsAt: new Date(draftSession.startsAt),
            lateThresholdMinutes: draftSession.lateThresholdMinutes,
            minimumRequiredMinutes: draftSession.minimumRequiredMinutes,
          });
        }
        const enrollment = draft.enrollments.find((item) => item.id === enrollmentId);
        log(draft, {
          action: `QR ${scanType}`,
          recordType: "Attendance",
          recordRef: enrollment?.reference ?? enrollmentId,
          detail: draftSession.name,
        });
      });
      return { ok: true, message: `${scanType === "check-in" ? "Check-in" : "Check-out"} recorded with server time.` };
    },
    [actor, log, state.attendanceRecords, state.attendanceSessions, update],
  );

  const recordCompletionStep = useCallback<SystemContextValue["recordCompletionStep"]>(
    ({ enrollmentId, feedbackForm, proofFileName }) => {
      update((draft) => {
        const enrollment = draft.enrollments.find((item) => item.id === enrollmentId);
        if (!enrollment) return;
        const now = new Date().toISOString();
        if (feedbackForm) enrollment.feedbackFormCompletedAt = now;
        if (proofFileName) {
          enrollment.completionProofFileName = proofFileName;
          enrollment.completionProofUploadedAt = now;
        }
        log(draft, {
          action: feedbackForm ? "Feedback form completed" : "Completion proof uploaded",
          recordType: "Enrollment",
          recordRef: enrollment.reference,
          detail: proofFileName,
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

  const signInTrainee = useCallback<SystemContextValue["signInTrainee"]>(
    (identifier) => {
      const term = identifier.trim().toLowerCase();
      if (!term) return { ok: false, message: "Enter your email or registration reference." };
      const byEmail = state.trainees.find((trainee) => trainee.email.toLowerCase() === term);
      const registration = state.registrations.find(
        (item) => item.reference.toLowerCase() === term || item.email.toLowerCase() === term,
      );
      const enrollment = state.enrollments.find((item) => item.reference.toLowerCase() === term);
      const traineeId =
        byEmail?.id ??
        (registration?.traineeId ||
          state.trainees.find((trainee) => trainee.email.toLowerCase() === registration?.email.toLowerCase())?.id) ??
        enrollment?.traineeId;
      if (!traineeId) {
        return {
          ok: false,
          message: registration
            ? "Your registration is still being reviewed. The portal opens once an enrollment is created."
            : "No record matched that email or reference.",
        };
      }
      update((draft) => {
        draft.traineeSessionId = traineeId;
      });
      return { ok: true, message: "Signed in." };
    },
    [state.enrollments, state.registrations, state.trainees, update],
  );

  const signOutTrainee = useCallback(() => {
    update((draft) => {
      draft.traineeSessionId = null;
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
      updateRegistrationStatus,
      approveRegistration,
      createEnrollment,
      cancelEnrollment,
      createTrainee,
      recordPayment,
      setPaymentVerification,
      addLedgerEntry,
      createBatch,
      publishBatch,
      setBatchStatus,
      sendInstructions,
      acknowledgeInstructions,
      setSessionState,
      markAttendance,
      scanAttendance,
      recordCompletionStep,
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
      signInTrainee,
      signOutTrainee,
      resetSystem,
      view,
      views,
      traineeViews,
      seats,
      openBatchesFor,
    }),
    [
      acknowledgeInstructions,
      actor,
      addLedgerEntry,
      advancePayroll,
      approveRegistration,
      cancelEnrollment,
      createBatch,
      createEnrollment,
      createRequest,
      createTrainee,
      decideExpense,
      decideLeave,
      decideRequest,
      markAttendance,
      markNotificationsRead,
      openBatchesFor,
      printCertificate,
      publishBatch,
      ready,
      recordCompletionStep,
      recordPayment,
      releaseCertificate,
      resetSystem,
      resolveMessage,
      scanAttendance,
      seats,
      sendInstructions,
      setBatchStatus,
      setPaymentVerification,
      setSessionState,
      signInTrainee,
      signOutTrainee,
      state,
      submitRegistration,
      traineeViews,
      updateRegistrationStatus,
      updateSettings,
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
