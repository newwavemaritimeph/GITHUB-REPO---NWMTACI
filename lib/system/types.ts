import type {
  AttendanceStatus,
  CertificateStatus,
  EnrollmentStatus,
  PaymentStatus,
} from "@/lib/domain";

export type Role =
  | "Admin"
  | "Registration"
  | "Cashier"
  | "Accounting"
  | "Training Operations"
  | "HR"
  | "Instructor";

export type CivilStatus = "Single" | "Married" | "Widowed" | "Separated" | "Divorced";
export type SeafarerStatus = "Active seafarer" | "Aspiring seafarer" | "Officer" | "Rating" | "Non-seafarer";

export type Trainee = {
  id: string;
  traineeNumber: string;
  firstName: string;
  middleName?: string;
  lastName: string;
  birthDate: string;
  email: string;
  mobile: string;
  address?: string;
  emergencyContactName?: string;
  emergencyContactRelation?: string;
  emergencyContactMobile?: string;
  srn?: string;
  /** Kept in step with the public registration form. */
  suffix?: string;
  placeOfBirth?: string;
  gender?: string;
  nationality?: string;
  civilStatus?: string;
  seafarerStatus?: string;
  rank?: string;
  company?: string;
  createdAt: string;
  /** Set when this record was folded into another on a matching SRN. */
  mergedIntoTraineeId?: string;
  mergedAt?: string;
};

/**
 * Everything one public enrollment form collects about the applicant, shared by
 * the form draft and the stored submission so the two never drift.
 */
export type Applicant = {
  firstName: string;
  middleName?: string;
  lastName: string;
  suffix?: string;
  birthDate: string;
  gender?: string;
  nationality?: string;
  civilStatus?: string;
  address?: string;
  mobile: string;
  email: string;
  srn?: string;
  seafarerStatus?: string;
  company?: string;
  rank?: string;
  emergencyContactName?: string;
  emergencyContactRelation?: string;
  emergencyContactMobile?: string;
  sourceOfInquiry?: string;
  referralSource?: string;
  promoCode?: string;
  additionalNotes?: string;
};

export type BatchStatus = "Draft" | "Open" | "Full" | "Ongoing" | "Completed" | "Cancelled";

export type Batch = {
  id: string;
  batchNumber: string;
  courseCode: string;
  courseName: string;
  centerName: string;
  startsOn: string;
  endsOn: string;
  mode: string;
  venue: string;
  capacity: number;
  instructor: string;
  status: BatchStatus;
  publishedAt: string | null;
  enrollmentDeadline: string;
  feeCentavos: number;
  trainingDays: number;
};

/** Overall status of a whole registration submission (one form, 1–5 courses). */
export type RegistrationStatus =
  | "Submitted"
  | "Under Review"
  | "Partially Approved"
  | "Approved"
  | "Rejected"
  | "Possible Duplicate";

/**
 * One public enrollment form. Holds the applicant snapshot and fans out to 1–5
 * course selections and the consent records captured at submission time.
 */
export type RegistrationSubmission = {
  id: string;
  reference: string; // NWM-REG-YYYY-NNNNNN
  applicant: Applicant;
  status: RegistrationStatus;
  traineeId?: string;
  publicStatusMessage: string;
  remarks?: string;
  submittedAt: string;
  decidedAt?: string;
};

/** Per-selection processing status — each course in a submission is decided on its own. */
export type SelectionStatus = "New" | "For Review" | "Approved" | "Change Requested" | "Rejected" | "Cancelled";

export type CourseSelection = {
  id: string;
  submissionId: string;
  courseCode: string;
  courseName: string;
  batchId: string;
  sequence: number; // 1..5
  status: SelectionStatus;
  publicInstruction?: string;
  internalRemark?: string;
  createdEnrollmentId?: string;
  decidedAt?: string;
  decidedBy?: string;
};

export type ConsentType =
  | "Data Privacy Notice"
  | "Accuracy of Information"
  | "Training Terms and Conditions"
  | "Payment Policy"
  | "Cancellation Policy"
  | "Rescheduling Policy"
  | "Certificate Release Policy";

export type RegistrationConsent = {
  id: string;
  submissionId: string;
  consentType: ConsentType;
  version: string;
  textSnapshot: string;
  acceptedAt: string;
  sessionRef?: string;
};

export type Enrollment = {
  id: string;
  reference: string; // NWM-ENR-YYYY-NNNNNN
  traineeId: string;
  batchId: string;
  courseCode: string;
  courseName: string;
  centerName: string;
  status: EnrollmentStatus;
  createdAt: string;
  registrationReference?: string;
  registrationSubmissionId?: string;
  courseSelectionId?: string;
  instructionsSentAt?: string;
  instructionsAcknowledgedAt?: string;
  cancelledReason?: string;
  /** Training completion is marked manually by staff off verified printed attendance. */
  completedAt?: string;
};

export type LedgerType = "charge" | "payment" | "discount" | "refund" | "reversal";

export type LedgerEntry = {
  id: string;
  reference: string;
  enrollmentId: string;
  type: LedgerType;
  amountCentavos: number;
  description: string;
  method?: "Cash" | "GCash" | "Bank transfer" | "Card" | "Adjustment";
  receivingAccount?: string;
  referenceNumber?: string;
  proofFileName?: string;
  verification: "Not required" | "Pending" | "Verified" | "Rejected";
  receiptNumber?: string;
  recordedBy: string;
  recordedAt: string;
  valid: boolean;
};

export type AttendanceSessionState = "Planned" | "Open" | "Submitted" | "Verified";

export type AttendanceSession = {
  id: string;
  batchId: string;
  dayNumber: number;
  sessionDate: string;
  name: string;
  startsAt: string;
  endsAt: string;
  lateThresholdMinutes: number;
  minimumRequiredMinutes: number;
  state: AttendanceSessionState;
  submittedAt?: string;
  verifiedAt?: string;
};

export type AttendanceRecord = {
  id: string;
  sessionId: string;
  enrollmentId: string;
  status: AttendanceStatus;
  /** Printed-sheet verification only — no QR (masterplan T.3). */
  method: "Manual";
  manualReason?: string;
  checkedInAt?: string;
  checkedOutAt?: string;
  recordedBy: string;
};

export type Certificate = {
  id: string;
  enrollmentId: string;
  status: CertificateStatus;
  certificateNumber?: string;
  printedAt?: string;
  releasedAt?: string;
  releasedTo?: string;
  reprintCount: number;
  blockedReason?: string;
  updatedAt: string;
};

export type RequestType =
  | "Reschedule"
  | "Course change"
  | "Refund"
  | "Record correction"
  | "Make-up class"
  | "Cancellation";

export type ChangeRequest = {
  id: string;
  reference: string;
  type: RequestType;
  enrollmentId?: string;
  traineeName: string;
  reason: string;
  requestedBy: string;
  status: "Pending" | "For clarification" | "Approved" | "Rejected";
  remarks?: string;
  payload?: Record<string, string>;
  createdAt: string;
  decidedAt?: string;
  decidedBy?: string;
};

export type Employee = {
  id: string;
  employeeNumber: string;
  name: string;
  position: string;
  department: string;
  employmentType: "Regular" | "Probationary" | "Part-time" | "Contract";
  monthlyRateCentavos: number;
  dailyRateCentavos: number;
  status: "Active" | "On leave" | "Separated";
  email: string;
};

export type LeaveRequest = {
  id: string;
  reference: string;
  employeeId: string;
  leaveType: "Vacation" | "Sick" | "Emergency" | "Unpaid";
  startsOn: string;
  endsOn: string;
  reason: string;
  status: "Pending" | "Approved" | "Rejected";
  decidedAt?: string;
};

export type PayrollPeriod = {
  id: string;
  periodNumber: string;
  startsOn: string;
  endsOn: string;
  payDate: string;
  status: "Draft" | "For review" | "Finalized";
  items: { employeeId: string; grossCentavos: number; deductionCentavos: number }[];
  finalizedAt?: string;
};

export type Expense = {
  id: string;
  expenseNumber: string;
  payee: string;
  category: string;
  amountCentavos: number;
  purpose: string;
  status: "Pending" | "Approved" | "Rejected" | "Paid";
  createdAt: string;
};

export type ContactMessage = {
  id: string;
  name: string;
  email: string;
  mobile?: string;
  message: string;
  createdAt: string;
  resolvedAt?: string;
};

export type NotificationItem = {
  id: string;
  audience: "staff" | "trainee";
  traineeId?: string;
  title: string;
  body: string;
  createdAt: string;
  readAt?: string;
};

export type ActivityEntry = {
  id: string;
  action: string;
  recordType: string;
  recordRef: string;
  actor: string;
  createdAt: string;
  detail?: string;
};

export type Settings = {
  organizationName: string;
  address: string;
  mobile: string;
  telephone: string;
  email: string;
  privacyNoticePublished: boolean;
  termsPublished: boolean;
  sendingDomainVerified: boolean;
  receivingAccountsConfigured: boolean;
  payrollConfigured: boolean;
  certificateTemplateApproved: boolean;
  certificateIssuanceEnabled: boolean;
  onlineRegistrationOpen: boolean;
  reservationFeeCentavos: number;
};

export type Course = {
  id: string;
  category: string;
  code: string;
  course: string;
  duration: string;
  modality: string;
  priceCentavos: number;
  active: boolean;
};

export type PartnerOfferRecord = {
  id: string;
  center: string;
  course: string;
  duration: string;
  trainingFeeCentavos: number;
  rebateCentavos: number;
  active: boolean;
};

export type SystemState = {
  version: number;
  trainees: Trainee[];
  batches: Batch[];
  courses: Course[];
  partnerOffers: PartnerOfferRecord[];
  submissions: RegistrationSubmission[];
  courseSelections: CourseSelection[];
  consents: RegistrationConsent[];
  enrollments: Enrollment[];
  ledger: LedgerEntry[];
  attendanceSessions: AttendanceSession[];
  attendanceRecords: AttendanceRecord[];
  certificates: Certificate[];
  requests: ChangeRequest[];
  employees: Employee[];
  leaveRequests: LeaveRequest[];
  payrollPeriods: PayrollPeriod[];
  expenses: Expense[];
  contactMessages: ContactMessage[];
  notifications: NotificationItem[];
  activity: ActivityEntry[];
  settings: Settings;
};

export type EnrollmentView = {
  enrollment: Enrollment;
  trainee: Trainee;
  batch: Batch | undefined;
  entries: LedgerEntry[];
  dueCentavos: number;
  paidCentavos: number;
  balanceCentavos: number;
  paymentStatus: PaymentStatus;
  attendance: { session: AttendanceSession; record: AttendanceRecord | undefined }[];
  attendanceStatuses: AttendanceStatus[];
  attendanceComplete: boolean;
  certificate: Certificate | undefined;
  stage: Stage;
};

export type Stage =
  | "Registered"
  | "Awaiting payment"
  | "Payment verification"
  | "Paid"
  | "Instructions sent"
  | "In training"
  | "Training complete"
  | "Certificate ready"
  | "Certificate released"
  | "Cancelled";

export type { AttendanceStatus, CertificateStatus, EnrollmentStatus, PaymentStatus };
