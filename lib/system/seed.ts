import { IN_HOUSE_COURSES } from "@/lib/in-house-catalog";
import type {
  AttendanceRecord,
  AttendanceSession,
  Batch,
  Certificate,
  Enrollment,
  LedgerEntry,
  SystemState,
  Trainee,
} from "./types";

export const SYSTEM_VERSION = 3;

function startOfToday() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now;
}

/** ISO date (YYYY-MM-DD) offset by whole days from today. */
export function day(offset: number) {
  const date = startOfToday();
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

/** Full timestamp offset by days + hours from midnight today. */
export function stamp(dayOffset: number, hour = 9, minute = 0) {
  const date = startOfToday();
  date.setDate(date.getDate() + dayOffset);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

function courseByCode(code: string) {
  return IN_HOUSE_COURSES.find((course) => course.code === code);
}

function makeBatch(input: {
  id: string;
  batchNumber: string;
  code: string;
  centerName: string;
  startOffset: number;
  days: number;
  capacity: number;
  instructor: string;
  venue: string;
  status: Batch["status"];
  published: boolean;
}): Batch {
  const course = courseByCode(input.code);
  return {
    id: input.id,
    batchNumber: input.batchNumber,
    courseCode: input.code,
    courseName: course?.course ?? input.code,
    centerName: input.centerName,
    startsOn: day(input.startOffset),
    endsOn: day(input.startOffset + input.days - 1),
    mode: course?.modality ?? "Face-to-face",
    venue: input.venue,
    capacity: input.capacity,
    instructor: input.instructor,
    status: input.status,
    publishedAt: input.published ? stamp(input.startOffset - 30, 9) : null,
    enrollmentDeadline: stamp(input.startOffset - 1, 17),
    feeCentavos: course?.priceCentavos ?? 500000,
    trainingDays: input.days,
  };
}

function sessionsFor(batch: Batch, state: AttendanceSession["state"]): AttendanceSession[] {
  const start = new Date(`${batch.startsOn}T00:00:00`);
  const today = startOfToday();
  return Array.from({ length: batch.trainingDays }, (_, index) => {
    const date = new Date(start);
    date.setDate(date.getDate() + index);
    const isoDate = date.toISOString().slice(0, 10);
    const past = date.getTime() < today.getTime();
    const isToday = date.getTime() === today.getTime();
    return {
      id: `${batch.id}-s${index + 1}`,
      batchId: batch.id,
      dayNumber: index + 1,
      sessionDate: isoDate,
      name: `Day ${index + 1}`,
      startsAt: `${isoDate}T08:00:00`,
      endsAt: `${isoDate}T17:00:00`,
      lateThresholdMinutes: 15,
      minimumRequiredMinutes: 360,
      state: state === "Verified" ? "Verified" : past ? "Verified" : isToday ? "Open" : "Planned",
      submittedAt: past ? `${isoDate}T17:20:00` : undefined,
      verifiedAt: past ? `${isoDate}T18:00:00` : undefined,
    } satisfies AttendanceSession;
  });
}

export function createSeedState(): SystemState {
  const trainees: Trainee[] = [
    { id: "t1", traineeNumber: "NWM-000031", firstName: "Juan", middleName: "Perez", lastName: "Dela Cruz", birthDate: "1994-03-12", email: "juan.delacruz@example.com", mobile: "09171234567", address: "Malate, Manila", emergencyContactName: "Rosa Dela Cruz", emergencyContactMobile: "09171234500", srn: "SRN-2014-004221", createdAt: stamp(-240, 10) },
    { id: "t2", traineeNumber: "NWM-000035", firstName: "Maria", middleName: "Luz", lastName: "Santos", birthDate: "1990-11-02", email: "maria.santos@example.com", mobile: "09281234567", address: "Pasay City", emergencyContactName: "Eduardo Santos", emergencyContactMobile: "09281234500", srn: "SRN-2011-009812", createdAt: stamp(-180, 11) },
    { id: "t3", traineeNumber: "NWM-000037", firstName: "Renato", lastName: "Villanueva", birthDate: "1988-06-21", email: "renato.villanueva@example.com", mobile: "09391234567", address: "Cavite City", emergencyContactName: "Lina Villanueva", emergencyContactMobile: "09391234500", createdAt: stamp(-120, 9) },
    { id: "t4", traineeNumber: "NWM-000039", firstName: "Carlo", middleName: "B", lastName: "Reyes", birthDate: "1996-01-30", email: "carlo.reyes@example.com", mobile: "09451234567", address: "Ermita, Manila", emergencyContactName: "Ana Reyes", emergencyContactMobile: "09451234500", createdAt: stamp(-90, 14) },
    { id: "t5", traineeNumber: "NWM-000042", firstName: "Liza", lastName: "Flores", birthDate: "1993-09-14", email: "liza.flores@example.com", mobile: "09561234567", address: "Paranaque City", emergencyContactName: "Mark Flores", emergencyContactMobile: "09561234500", createdAt: stamp(-45, 8) },
    { id: "t6", traineeNumber: "NWM-000044", firstName: "Leo", lastName: "Ramos", birthDate: "1991-04-08", email: "leo.ramos@example.com", mobile: "09661234567", address: "Taguig City", emergencyContactName: "Cris Ramos", emergencyContactMobile: "09661234500", createdAt: stamp(-20, 16) },
    { id: "t7", traineeNumber: "NWM-000046", firstName: "Ana", middleName: "Grace", lastName: "Mendoza", birthDate: "1997-12-19", email: "ana.mendoza@example.com", mobile: "09771234567", address: "Manila", emergencyContactName: "Jose Mendoza", emergencyContactMobile: "09771234500", createdAt: stamp(-9, 13) },
  ];

  const batches: Batch[] = [
    makeBatch({ id: "b1", batchNumber: "BT-2026-070", code: "BT", centerName: "New Wave Maritime", startOffset: -24, days: 10, capacity: 24, instructor: "Capt. Ruel Aquino", venue: "Room 301", status: "Completed", published: true }),
    makeBatch({ id: "b2", batchNumber: "AFF-2026-072", code: "AFF", centerName: "New Wave Maritime", startOffset: -8, days: 5, capacity: 20, instructor: "Engr. Dan Cruz", venue: "Training yard", status: "Completed", published: true }),
    makeBatch({ id: "b3", batchNumber: "MEFA-2026-074", code: "MEFA", centerName: "New Wave Maritime", startOffset: -2, days: 4, capacity: 18, instructor: "Dr. Vina Lopez", venue: "Room 205", status: "Ongoing", published: true }),
    makeBatch({ id: "b4", batchNumber: "SSO-2026-081", code: "SSO", centerName: "New Wave Maritime", startOffset: 6, days: 3, capacity: 22, instructor: "Capt. Ruel Aquino", venue: "Room 301", status: "Open", published: true }),
    makeBatch({ id: "b5", batchNumber: "BT-2026-083", code: "BT", centerName: "New Wave Maritime", startOffset: 12, days: 10, capacity: 24, instructor: "Capt. Ruel Aquino", venue: "Room 301", status: "Open", published: true }),
    makeBatch({ id: "b6", batchNumber: "SATSDSD-2026-085", code: "SATSDSD", centerName: "New Wave Maritime", startOffset: 9, days: 1, capacity: 30, instructor: "Mr. Alvin Reyes", venue: "Room 102", status: "Open", published: true }),
    makeBatch({ id: "b7", batchNumber: "PSCMT-2026-087", code: "PSCMT", centerName: "New Wave Maritime", startOffset: 18, days: 2, capacity: 25, instructor: "Ms. Karen Diaz", venue: "Room 205", status: "Open", published: true }),
    makeBatch({ id: "b8", batchNumber: "AFF-2026-090", code: "AFF", centerName: "New Wave Maritime", startOffset: 25, days: 5, capacity: 20, instructor: "Engr. Dan Cruz", venue: "Training yard", status: "Draft", published: false }),
    makeBatch({ id: "b9", batchNumber: "CCMI-2026-092", code: "CCMI", centerName: "New Wave Maritime", startOffset: 33, days: 6, capacity: 16, instructor: "Capt. Ruel Aquino", venue: "Room 301", status: "Open", published: true }),
  ];

  const enrollments: Enrollment[] = [
    { id: "e1", reference: "ENR-2026-000101", traineeId: "t1", batchId: "b1", courseCode: "BT", courseName: batches[0].courseName, centerName: "New Wave Maritime", status: "Enrolled", createdAt: stamp(-40, 10), registrationReference: "REG-2026-000201", instructionsSentAt: stamp(-32, 9), instructionsAcknowledgedAt: stamp(-31, 20) },
    { id: "e2", reference: "ENR-2026-000102", traineeId: "t2", batchId: "b2", courseCode: "AFF", courseName: batches[1].courseName, centerName: "New Wave Maritime", status: "Enrolled", createdAt: stamp(-30, 11), registrationReference: "REG-2026-000202", instructionsSentAt: stamp(-14, 9), instructionsAcknowledgedAt: stamp(-13, 21) },
    { id: "e3", reference: "ENR-2026-000103", traineeId: "t4", batchId: "b3", courseCode: "MEFA", courseName: batches[2].courseName, centerName: "New Wave Maritime", status: "Enrolled", createdAt: stamp(-18, 15), registrationReference: "REG-2026-000203", instructionsSentAt: stamp(-8, 9), instructionsAcknowledgedAt: stamp(-7, 19) },
    { id: "e4", reference: "ENR-2026-000104", traineeId: "t5", batchId: "b4", courseCode: "SSO", courseName: batches[3].courseName, centerName: "New Wave Maritime", status: "Enrolled", createdAt: stamp(-10, 9), registrationReference: "REG-2026-000204", instructionsSentAt: stamp(-3, 9) },
    { id: "e5", reference: "ENR-2026-000105", traineeId: "t6", batchId: "b5", courseCode: "BT", courseName: batches[4].courseName, centerName: "New Wave Maritime", status: "Enrolled", createdAt: stamp(-6, 14), registrationReference: "REG-2026-000205" },
    { id: "e6", reference: "ENR-2026-000106", traineeId: "t3", batchId: "b6", courseCode: "SATSDSD", courseName: batches[5].courseName, centerName: "New Wave Maritime", status: "Pending", createdAt: stamp(-2, 11), registrationReference: "REG-2026-000206" },
    { id: "e7", reference: "ENR-2026-000107", traineeId: "t7", batchId: "b7", courseCode: "PSCMT", courseName: batches[6].courseName, centerName: "New Wave Maritime", status: "Enrolled", createdAt: stamp(-1, 16), registrationReference: "REG-2026-000207" },
  ];

  const ledger: LedgerEntry[] = [];
  let paymentSequence = 220;
  let receiptSequence = 180;
  const charge = (id: string, enrollmentId: string, amount: number, description: string, at: string): LedgerEntry => ({
    id, reference: `CHG-${id}`, enrollmentId, type: "charge", amountCentavos: amount, description,
    verification: "Not required", recordedBy: "Registration", recordedAt: at, valid: true,
  });
  const payment = (
    id: string,
    enrollmentId: string,
    amount: number,
    method: LedgerEntry["method"],
    at: string,
    verification: LedgerEntry["verification"] = "Verified",
  ): LedgerEntry => ({
    id,
    reference: `PAY-2026-${String(++paymentSequence).padStart(6, "0")}`,
    enrollmentId,
    type: "payment",
    amountCentavos: amount,
    description: `${method} payment`,
    method,
    receivingAccount: method === "Cash" ? "Main cashier" : method === "GCash" ? "GCash 0917-000-0000" : "BDO 0012-3456-7890",
    referenceNumber: method === "Cash" ? undefined : `${Math.floor(100000 + Math.random() * 899999)}`,
    verification,
    receiptNumber: verification === "Verified" ? `OR-2026-${String(++receiptSequence).padStart(6, "0")}` : undefined,
    recordedBy: "Cashier",
    recordedAt: at,
    valid: true,
  });

  const feeOf = (batchId: string) => batches.find((batch) => batch.id === batchId)?.feeCentavos ?? 0;

  enrollments.forEach((enrollment, index) => {
    ledger.push(charge(`c${index + 1}`, enrollment.id, feeOf(enrollment.batchId), `${enrollment.courseName} training fee`, enrollment.createdAt));
  });
  ledger.push(payment("p1", "e1", feeOf("b1"), "Bank transfer", stamp(-38, 10)));
  ledger.push(payment("p2", "e2", feeOf("b2"), "GCash", stamp(-28, 9)));
  ledger.push(payment("p3", "e3", feeOf("b3"), "Cash", stamp(-16, 14)));
  ledger.push(payment("p4", "e4", 150000, "GCash", stamp(-9, 11)));
  ledger.push(payment("p5", "e5", 200000, "Bank transfer", stamp(-4, 15), "Pending"));

  const attendanceSessions: AttendanceSession[] = [
    ...sessionsFor(batches[0], "Verified"),
    ...sessionsFor(batches[1], "Verified"),
    ...sessionsFor(batches[2], "Open"),
    ...sessionsFor(batches[3], "Planned"),
  ];

  const attendanceRecords: AttendanceRecord[] = [];
  attendanceSessions
    .filter((session) => session.batchId === "b1" || session.batchId === "b2")
    .forEach((session) => {
      const enrollmentId = session.batchId === "b1" ? "e1" : "e2";
      attendanceRecords.push({
        id: `ar-${session.id}-${enrollmentId}`,
        sessionId: session.id,
        enrollmentId,
        status: session.dayNumber === 3 && session.batchId === "b1" ? "Late" : "Present",
        method: "QR",
        checkedInAt: `${session.sessionDate}T07:52:00`,
        checkedOutAt: `${session.sessionDate}T17:04:00`,
        recordedBy: "Instructor",
      });
    });
  attendanceSessions
    .filter((session) => session.batchId === "b3" && session.state === "Verified")
    .forEach((session) => {
      attendanceRecords.push({
        id: `ar-${session.id}-e3`,
        sessionId: session.id,
        enrollmentId: "e3",
        status: "Present",
        method: "QR",
        checkedInAt: `${session.sessionDate}T07:58:00`,
        checkedOutAt: `${session.sessionDate}T17:02:00`,
        recordedBy: "Instructor",
      });
    });

  const certificates: Certificate[] = [
    { id: "cert1", enrollmentId: "e1", status: "Released", certificateNumber: "NWM-BT-2026-000118", printedAt: stamp(-12, 10), releasedAt: stamp(-10, 14), releasedTo: "Juan Dela Cruz", reprintCount: 0, updatedAt: stamp(-10, 14) },
    { id: "cert2", enrollmentId: "e2", status: "Pending Attendance", reprintCount: 0, updatedAt: stamp(-3, 9) },
    { id: "cert3", enrollmentId: "e3", status: "Pending Attendance", reprintCount: 0, updatedAt: stamp(-2, 9) },
  ];

  return {
    version: SYSTEM_VERSION,
    trainees,
    batches,
    registrations: [
      { id: "r1", reference: "REG-2026-000208", firstName: "Miguel", lastName: "Torres", birthDate: "1995-05-05", email: "miguel.torres@example.com", mobile: "09181234567", address: "Las Pinas City", emergencyContactName: "Rita Torres", emergencyContactMobile: "09181234500", courseCode: "SSO", courseName: batches[3].courseName, batchId: "b4", status: "Submitted", submittedAt: stamp(0, 8, 42) },
      { id: "r2", reference: "REG-2026-000209", firstName: "Grace", middleName: "P", lastName: "Lim", birthDate: "1992-08-17", email: "grace.lim@example.com", mobile: "09191234567", address: "Makati City", courseCode: "BT", courseName: batches[4].courseName, batchId: "b5", status: "Under Review", remarks: "Waiting for valid ID copy.", submittedAt: stamp(-1, 15, 10) },
      { id: "r3", reference: "REG-2026-000210", firstName: "Juan", middleName: "Perez", lastName: "Dela Cruz", birthDate: "1994-03-12", email: "juan.delacruz@example.com", mobile: "09171234567", courseCode: "PSCMT", courseName: batches[6].courseName, batchId: "b7", status: "Possible Duplicate", remarks: "Matches trainee NWM-000031.", submittedAt: stamp(0, 7, 15) },
    ],
    enrollments,
    ledger,
    attendanceSessions,
    attendanceRecords,
    certificates,
    requests: [
      { id: "q1", reference: "REQ-2026-000041", type: "Reschedule", enrollmentId: "e5", traineeName: "Leo Ramos", reason: "Vessel joining date moved to next month.", requestedBy: "Enrollment status page", status: "Pending", createdAt: stamp(-1, 9) },
      { id: "q2", reference: "REQ-2026-000042", type: "Record correction", enrollmentId: "e4", traineeName: "Liza Flores", reason: "Middle name spelling on record.", requestedBy: "Registration", status: "Pending", createdAt: stamp(0, 8) },
      { id: "q3", reference: "REQ-2026-000043", type: "Refund", enrollmentId: "e6", traineeName: "Renato Villanueva", reason: "Company cancelled the deployment.", requestedBy: "Enrollment status page", status: "For clarification", remarks: "Please attach the company advisory.", createdAt: stamp(-2, 13) },
      { id: "q4", reference: "REQ-2026-000044", type: "Make-up class", enrollmentId: "e2", traineeName: "Maria Santos", reason: "Missed practical session due to illness.", requestedBy: "Instructor", status: "Approved", remarks: "Scheduled with the next AFF batch.", createdAt: stamp(-5, 10), decidedAt: stamp(-4, 11), decidedBy: "Training Operations" },
    ],
    employees: [
      { id: "emp1", employeeNumber: "EMP-001", name: "Jocelyn Eala", position: "Center Administrator", department: "Administration", employmentType: "Regular", monthlyRateCentavos: 6500000, dailyRateCentavos: 295000, status: "Active", email: "jocelyn@newwave.example" },
      { id: "emp2", employeeNumber: "EMP-004", name: "Capt. Ruel Aquino", position: "Senior Instructor", department: "Training", employmentType: "Regular", monthlyRateCentavos: 7200000, dailyRateCentavos: 327000, status: "Active", email: "ruel@newwave.example" },
      { id: "emp3", employeeNumber: "EMP-007", name: "Engr. Dan Cruz", position: "Instructor", department: "Training", employmentType: "Regular", monthlyRateCentavos: 6200000, dailyRateCentavos: 281000, status: "Active", email: "dan@newwave.example" },
      { id: "emp4", employeeNumber: "EMP-011", name: "Sheila Bautista", position: "Cashier", department: "Finance", employmentType: "Regular", monthlyRateCentavos: 3200000, dailyRateCentavos: 145000, status: "Active", email: "sheila@newwave.example" },
      { id: "emp5", employeeNumber: "EMP-014", name: "Marvin Ocampo", position: "Registration Officer", department: "Registration", employmentType: "Probationary", monthlyRateCentavos: 2800000, dailyRateCentavos: 127000, status: "Active", email: "marvin@newwave.example" },
      { id: "emp6", employeeNumber: "EMP-019", name: "Dr. Vina Lopez", position: "Medical Instructor", department: "Training", employmentType: "Part-time", monthlyRateCentavos: 0, dailyRateCentavos: 350000, status: "Active", email: "vina@newwave.example" },
    ],
    leaveRequests: [
      { id: "lv1", reference: "LVE-2026-000018", employeeId: "emp3", leaveType: "Vacation", startsOn: day(9), endsOn: day(12), reason: "Family trip.", status: "Pending" },
      { id: "lv2", reference: "LVE-2026-000019", employeeId: "emp4", leaveType: "Sick", startsOn: day(-1), endsOn: day(-1), reason: "Medical consultation.", status: "Pending" },
      { id: "lv3", reference: "LVE-2026-000020", employeeId: "emp5", leaveType: "Emergency", startsOn: day(3), endsOn: day(3), reason: "Household emergency.", status: "Approved", decidedAt: stamp(-1, 10) },
    ],
    payrollPeriods: [
      {
        id: "pr1", periodNumber: "PAY-2026-14", startsOn: day(-22), endsOn: day(-8), payDate: day(-7), status: "Finalized", finalizedAt: stamp(-7, 12),
        items: [
          { employeeId: "emp1", grossCentavos: 3250000, deductionCentavos: 412000 },
          { employeeId: "emp2", grossCentavos: 3600000, deductionCentavos: 458000 },
          { employeeId: "emp3", grossCentavos: 3100000, deductionCentavos: 396000 },
          { employeeId: "emp4", grossCentavos: 1600000, deductionCentavos: 214000 },
          { employeeId: "emp5", grossCentavos: 1400000, deductionCentavos: 188000 },
          { employeeId: "emp6", grossCentavos: 1400000, deductionCentavos: 98000 },
        ],
      },
      {
        id: "pr2", periodNumber: "PAY-2026-15", startsOn: day(-7), endsOn: day(7), payDate: day(8), status: "Draft",
        items: [
          { employeeId: "emp1", grossCentavos: 3250000, deductionCentavos: 412000 },
          { employeeId: "emp2", grossCentavos: 3600000, deductionCentavos: 458000 },
          { employeeId: "emp3", grossCentavos: 3100000, deductionCentavos: 396000 },
          { employeeId: "emp4", grossCentavos: 1600000, deductionCentavos: 214000 },
          { employeeId: "emp5", grossCentavos: 1400000, deductionCentavos: 188000 },
          { employeeId: "emp6", grossCentavos: 1050000, deductionCentavos: 74000 },
        ],
      },
    ],
    expenses: [
      { id: "x1", expenseNumber: "EXP-2026-000061", payee: "Manila Fire Supplies", category: "Training materials", amountCentavos: 486000, purpose: "Refill of fire extinguishers for AFF practical.", status: "Approved", createdAt: stamp(-4, 10) },
      { id: "x2", expenseNumber: "EXP-2026-000062", payee: "Roxas Utilities", category: "Utilities", amountCentavos: 1284000, purpose: "Electricity for July billing period.", status: "Pending", createdAt: stamp(-2, 9) },
      { id: "x3", expenseNumber: "EXP-2026-000063", payee: "Ermita Printhouse", category: "Office supplies", amountCentavos: 172000, purpose: "Training certificates paper stock.", status: "Pending", createdAt: stamp(-1, 15) },
    ],
    contactMessages: [
      { id: "m1", name: "Rico Estrada", email: "rico.estrada@example.com", mobile: "09201234567", message: "Do you have a Basic Training schedule for next month?", createdAt: stamp(-1, 11) },
      { id: "m2", name: "Diane Sy", email: "diane.sy@example.com", message: "What are the requirements for SSO enrollment?", createdAt: stamp(0, 8, 20) },
    ],
    notifications: [
      { id: "n1", audience: "staff", title: "Payment awaiting verification", body: "Leo Ramos submitted a bank transfer proof for ENR-2026-000105.", createdAt: stamp(-4, 15) },
      { id: "n2", audience: "staff", title: "New registration received", body: "Miguel Torres registered for Ship Security Officer.", createdAt: stamp(0, 8, 42) },
      { id: "n3", audience: "staff", title: "Possible duplicate trainee", body: "REG-2026-000210 matches trainee NWM-000031.", createdAt: stamp(0, 7, 15) },
    ],
    activity: [
      { id: "a1", action: "Certificate released", recordType: "Certificate", recordRef: "NWM-BT-2026-000118", actor: "Training Operations", createdAt: stamp(-10, 14) },
      { id: "a2", action: "Payment posted", recordType: "Payment", recordRef: "ENR-2026-000103", actor: "Cashier", createdAt: stamp(-16, 14) },
      { id: "a3", action: "Batch published", recordType: "Batch", recordRef: "SSO-2026-081", actor: "Training Operations", createdAt: stamp(-24, 9) },
    ],
    settings: {
      organizationName: "New Wave Maritime Training and Assessment Center, Inc.",
      address: "103 Bel Air Apartments, 1020 Roxas Boulevard, Ermita, Manila 1000",
      mobile: "+63 948 847 6530",
      telephone: "8553 0310",
      email: "newwavemaritime@gmail.com",
      privacyNoticePublished: true,
      termsPublished: true,
      sendingDomainVerified: false,
      receivingAccountsConfigured: true,
      payrollConfigured: true,
      certificateTemplateApproved: false,
      certificateIssuanceEnabled: false,
      onlineRegistrationOpen: true,
      reservationFeeCentavos: 100000,
    },
    traineeSessionId: null,
  };
}
