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
  emergencyContactMobile?: string;
  srn?: string;
  createdAt: string;
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

export type RegistrationStatus =
  | "Submitted"
  | "Under Review"
  | "Approved"
  | "Rejected"
  | "Possible Duplicate";

export type Registration = {
  id: string;
  reference: string;
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
  status: RegistrationStatus;
  traineeId?: string;
  enrollmentId?: string;
  remarks?: string;
  submittedAt: string;
  decidedAt?: string;
};

export type Enrollment = {
  id: string;
  reference: string;
  traineeId: string;
  batchId: string;
  courseCode: string;
  courseName: string;
  centerName: string;
  status: EnrollmentStatus;
  createdAt: string;
  registrationReference?: string;
  instructionsSentAt?: string;
  instructionsAcknowledgedAt?: string;
  cancelledReason?: string;
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
  method: "QR" | "Manual";
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

export type SystemState = {
  version: number;
  trainees: Trainee[];
  batches: Batch[];
  registrations: Registration[];
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
  traineeSessionId: string | null;
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
