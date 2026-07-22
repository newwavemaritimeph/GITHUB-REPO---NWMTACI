"use client";

import { useMemo, useState } from "react";

type EnrollmentStatus = "On-Process" | "Enrolled" | "Cancelled";
type PaymentStatus = "Unpaid" | "Partial" | "Paid";

type Payment = {
  ref: string;
  invoice: string;
  amount: number;
  method: string;
  reference?: string;
  date: string;
};

type Enrollment = {
  ref: string;
  trainee: string;
  code: string;
  initials: string;
  course: string;
  courseCode: string;
  center: string;
  schedule: string;
  time: string;
  venue: string;
  fee: number;
  discount: number;
  partnerRate: number;
  status: EnrollmentStatus;
  source: string;
  payments: Payment[];
  instructionsSent?: string;
};

const seedEnrollments: Enrollment[] = [
  {
    ref: "ENR-2026-000106",
    trainee: "JUAN DELA CRUZ",
    code: "TBMS-0000042",
    initials: "JD",
    course: "Basic Training — Full Course",
    courseCode: "BT-FULL",
    center: "Nautical Options Training Institute",
    schedule: "Aug 04–08, 2026",
    time: "8:00 AM–5:00 PM",
    venue: "Intramuros, Manila",
    fee: 6500,
    discount: 0,
    partnerRate: 5200,
    status: "Enrolled",
    source: "Walk-in",
    payments: [
      { ref: "PAY-2026-000231", invoice: "TB-INV-2026-000231", amount: 2000, method: "GCash", reference: "99231", date: "Jul 22, 2026" },
    ],
  },
  {
    ref: "ENR-2026-000105",
    trainee: "MARIA SANTOS",
    code: "TBMS-0000039",
    initials: "MS",
    course: "Advanced Fire Fighting",
    courseCode: "AFF",
    center: "Great Seas Maritime Training",
    schedule: "Jul 27–30, 2026",
    time: "8:00 AM–5:00 PM",
    venue: "Ermita, Manila",
    fee: 4800,
    discount: 300,
    partnerRate: 3900,
    status: "Enrolled",
    source: "Online",
    payments: [
      { ref: "PAY-2026-000229", invoice: "TB-INV-2026-000229", amount: 4500, method: "Cash", date: "Jul 22, 2026" },
    ],
  },
  {
    ref: "ENR-2026-000104",
    trainee: "RENATO VILLANUEVA",
    code: "TBMS-0000037",
    initials: "RV",
    course: "Proficiency in Survival Craft",
    courseCode: "SCRB",
    center: "United International Maritime",
    schedule: "Aug 10–13, 2026",
    time: "8:00 AM–5:00 PM",
    venue: "Makati City",
    fee: 5200,
    discount: 0,
    partnerRate: 4300,
    status: "On-Process",
    source: "Referral",
    payments: [],
  },
  {
    ref: "ENR-2026-000103",
    trainee: "CARLO REYES",
    code: "TBMS-0000035",
    initials: "CR",
    course: "Medical First Aid",
    courseCode: "MEFA",
    center: "New Wave Maritime Training",
    schedule: "Jul 28–29, 2026",
    time: "8:00 AM–5:00 PM",
    venue: "Pasay City",
    fee: 3200,
    discount: 0,
    partnerRate: 2600,
    status: "Enrolled",
    source: "Agency",
    payments: [
      { ref: "PAY-2026-000226", invoice: "TB-INV-2026-000226", amount: 3200, method: "PSBank", reference: "PSB-88410", date: "Jul 21, 2026" },
    ],
    instructionsSent: "Jul 21, 2026 · 4:32 PM",
  },
  {
    ref: "ENR-2026-000102",
    trainee: "LEO RAMOS",
    code: "TBMS-0000031",
    initials: "LR",
    course: "Ship Security Officer",
    courseCode: "SSO",
    center: "PNTC Colleges Maritime Training",
    schedule: "Aug 03–05, 2026",
    time: "8:00 AM–5:00 PM",
    venue: "Dasmariñas, Cavite",
    fee: 3900,
    discount: 0,
    partnerRate: 3200,
    status: "On-Process",
    source: "Marketing",
    payments: [
      { ref: "PAY-2026-000222", invoice: "TB-INV-2026-000222", amount: 1000, method: "Maribank", reference: "MB-70181", date: "Jul 20, 2026" },
    ],
  },
];

const navItems = [
  ["Dashboard", "grid"],
  ["Enrollments", "file"],
  ["Payments & Accounting", "wallet"],
  ["Training Instructions", "mail"],
  ["Courses & Centers", "cap"],
  ["Requests", "request"],
  ["Settings", "gear"],
];

const money = (value: number) => `₱${value.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;

function totalPaid(enrollment: Enrollment) {
  return enrollment.payments.reduce((sum, payment) => sum + payment.amount, 0);
}

function paymentStatus(enrollment: Enrollment): PaymentStatus {
  const paid = totalPaid(enrollment);
  const net = enrollment.fee - enrollment.discount;
  if (paid <= 0) return "Unpaid";
  if (paid < net) return "Partial";
  return "Paid";
}

function Icon({ name }: { name: string }) {
  const glyphs: Record<string, string> = {
    grid: "▦", file: "▤", wallet: "▰", mail: "✉", cap: "◒", request: "↻", gear: "⚙",
    bell: "●", search: "⌕", plus: "+", arrow: "→", check: "✓", clock: "◷", calendar: "□", chart: "▥",
  };
  return <span className={`icon icon-${name}`} aria-hidden="true">{glyphs[name] ?? "•"}</span>;
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? "brand-compact" : ""}`}>
      <div className="brand-mark" aria-label="Tara Barko mark">
        <span className="sail sail-a" />
        <span className="sail sail-b" />
        <span className="wave" />
      </div>
      {!compact && <div><strong>TARA BARKO</strong><span>MARITIME SERVICES</span></div>}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  return <span className={`status status-${status.toLowerCase().replaceAll(" ", "-")}`}>{status}</span>;
}

export default function Home() {
  const [active, setActive] = useState("Dashboard");
  const [enrollments, setEnrollments] = useState(seedEnrollments);
  const [selectedRef, setSelectedRef] = useState<string | null>(null);
  const [filter, setFilter] = useState("All");
  const [query, setQuery] = useState("");
  const [toast, setToast] = useState("");
  const [modal, setModal] = useState<"payment" | "enrollment" | "public" | null>(null);

  const selected = enrollments.find((item) => item.ref === selectedRef) ?? null;

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 3000);
  }

  function openEnrollment(ref: string) {
    setSelectedRef(ref);
    setActive("Enrollments");
  }

  function updateStatus(status: EnrollmentStatus) {
    if (!selected) return;
    setEnrollments((items) => items.map((item) => item.ref === selected.ref ? { ...item, status } : item));
    notify(`Enrollment marked ${status}.`);
  }

  const filtered = useMemo(() => enrollments.filter((item) => {
    const matchesFilter = filter === "All" || paymentStatus(item) === filter;
    const haystack = `${item.trainee} ${item.ref} ${item.code} ${item.course}`.toLowerCase();
    return matchesFilter && haystack.includes(query.toLowerCase());
  }), [enrollments, filter, query]);

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <Brand />
        <nav aria-label="Main navigation">
          <p className="nav-label">WORKSPACE</p>
          {navItems.map(([label, icon]) => (
            <button key={label} className={`nav-item ${active === label ? "active" : ""}`} onClick={() => { setActive(label); setSelectedRef(null); }}>
              <Icon name={icon} /><span>{label}</span>{label === "Requests" && <small>Soon</small>}
            </button>
          ))}
        </nav>
        <div className="sidebar-help">
          <div className="help-icon">?</div>
          <div><strong>Need help?</strong><span>View the officer guide</span></div>
          <button aria-label="Open help">↗</button>
        </div>
        <div className="profile-card">
          <div className="avatar">JE</div>
          <div><strong>Jocelyn Eala</strong><span>Registration Officer</span></div>
          <button aria-label="Profile menu">•••</button>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="mobile-brand"><Brand compact /><strong>Tara Barko</strong></div>
          <div className="global-search"><Icon name="search" /><input aria-label="Global search" placeholder="Search trainee, enrollment, or SRN..." /></div>
          <div className="top-actions">
            <button className="preview-link" onClick={() => setModal("public")}>Public registration</button>
            <button className="notification" aria-label="Notifications"><Icon name="bell" /><span>3</span></button>
            <div className="today"><span>Today</span><strong>Wed, July 22</strong></div>
          </div>
        </header>

        {active === "Dashboard" && <Dashboard enrollments={enrollments} openEnrollment={openEnrollment} setActive={setActive} setModal={setModal} />}
        {active === "Enrollments" && !selected && <EnrollmentList enrollments={filtered} filter={filter} setFilter={setFilter} query={query} setQuery={setQuery} openEnrollment={openEnrollment} setModal={setModal} />}
        {active === "Enrollments" && selected && <EnrollmentDetail enrollment={selected} goBack={() => setSelectedRef(null)} updateStatus={updateStatus} setModal={setModal} notify={notify} />}
        {active === "Payments & Accounting" && <Accounting enrollments={enrollments} openEnrollment={openEnrollment} />}
        {active === "Training Instructions" && <Instructions enrollments={enrollments} openEnrollment={openEnrollment} notify={notify} />}
        {!["Dashboard", "Enrollments", "Payments & Accounting", "Training Instructions"].includes(active) && <ComingSoon active={active} />}
      </section>

      {modal === "payment" && selected && <PaymentModal enrollment={selected} close={() => setModal(null)} save={(payment) => {
        setEnrollments((items) => items.map((item) => item.ref === selected.ref ? { ...item, payments: [...item.payments, payment] } : item));
        setModal(null);
        notify(`${money(payment.amount)} payment recorded. Invoice ${payment.invoice} generated.`);
      }} />}
      {modal === "enrollment" && <EnrollmentModal close={() => setModal(null)} save={(newEnrollment) => {
        setEnrollments((items) => [newEnrollment, ...items]);
        setModal(null);
        openEnrollment(newEnrollment.ref);
        notify("Enrollment ENR-2026-000107 created with a locked rate snapshot.");
      }} />}
      {modal === "public" && <PublicRegistration close={() => setModal(null)} notify={notify} />}
      {toast && <div className="toast"><span>✓</span>{toast}</div>}
    </main>
  );
}

function Dashboard({ enrollments, openEnrollment, setActive, setModal }: { enrollments: Enrollment[]; openEnrollment: (ref: string) => void; setActive: (tab: string) => void; setModal: (modal: "enrollment") => void }) {
  const outstanding = enrollments.reduce((sum, item) => sum + Math.max(0, item.fee - item.discount - totalPaid(item)), 0);
  const today = enrollments.flatMap((item) => item.payments).filter((item) => item.date === "Jul 22, 2026").reduce((sum, item) => sum + item.amount, 0);
  const tasks = [
    { tone: "orange", icon: "clock", count: enrollments.filter((item) => item.status === "On-Process").length, title: "Confirm pending enrollments", text: "Partner slots need confirmation", action: "Review enrollments", go: () => setActive("Enrollments") },
    { tone: "red", icon: "wallet", count: enrollments.filter((item) => paymentStatus(item) !== "Paid").length, title: "Follow up balances", text: `${money(outstanding)} outstanding`, action: "View balances", go: () => setActive("Payments & Accounting") },
    { tone: "blue", icon: "mail", count: enrollments.filter((item) => item.status === "Enrolled" && paymentStatus(item) === "Paid" && !item.instructionsSent).length, title: "Send training instructions", text: "Ready to send today", action: "Prepare emails", go: () => setActive("Training Instructions") },
  ];
  return (
    <div className="page dashboard-page">
      <div className="page-heading dashboard-heading">
        <div><p className="eyebrow">WEDNESDAY · JULY 22, 2026</p><h1>Good morning, Jocelyn <span>👋</span></h1><p>Here’s what needs your attention today.</p></div>
        <button className="primary-btn" onClick={() => setModal("enrollment")}><Icon name="plus" /> Register enrollment</button>
      </div>

      <div className="announcement"><div className="announcement-icon">✦</div><div><span>ANNOUNCEMENT FROM KYLA</span><strong>July rate cards are now updated</strong><p>Please use the new partner rates for enrollments created from July 20 onward. Existing enrollment rates remain locked.</p></div><button aria-label="Dismiss announcement">×</button></div>

      <section>
        <div className="section-title"><h2>Today’s overview</h2><span>Live as of 9:41 AM</span></div>
        <div className="stat-grid">
          <Stat label="New registrations" value="8" detail="3 need review" icon="file" tone="blue" />
          <Stat label="Need action" value="6" detail="2 urgent" icon="clock" tone="orange" />
          <Stat label="Upcoming training" value="12" detail="Next 7 days" icon="calendar" tone="violet" />
          <Stat label="Today’s collections" value={money(today)} detail="2 payments" icon="wallet" tone="green" />
          <Stat label="Outstanding balance" value={money(outstanding)} detail="Across 3 trainees" icon="chart" tone="red" />
          <Stat label="Pending requests" value="2" detail="Awaiting admin" icon="request" tone="gray" />
        </div>
      </section>

      <div className="dashboard-grid">
        <section className="tasks-panel card">
          <div className="panel-title"><div><h2>Today’s tasks</h2><p>Prioritized actions for your shift</p></div><span className="task-total">{tasks.reduce((sum, item) => sum + item.count, 0)} tasks</span></div>
          {tasks.map((task) => <button className="task-row" key={task.title} onClick={task.go}><div className={`task-icon ${task.tone}`}><Icon name={task.icon} /><b>{task.count}</b></div><div><strong>{task.title}</strong><span>{task.text}</span></div><div className="task-action">{task.action} <Icon name="arrow" /></div></button>)}
        </section>
        <section className="activity-panel card">
          <div className="panel-title"><div><h2>Recent activity</h2><p>Latest updates across enrollments</p></div><button onClick={() => setActive("Enrollments")}>View all</button></div>
          {enrollments.slice(0, 4).map((item, index) => <button className="activity-row" key={item.ref} onClick={() => openEnrollment(item.ref)}><div className={`activity-dot dot-${index}`}><Icon name={index === 0 ? "wallet" : index === 1 ? "check" : "file"} /></div><div><strong>{index === 0 ? "Payment recorded" : index === 1 ? "Enrollment confirmed" : "New enrollment created"}</strong><span>{item.trainee} · {item.courseCode}</span><small>{index < 2 ? "12 min ago" : `${index + 1}h ago`}</small></div><span className="activity-amount">{index === 0 ? money(2000) : ""}</span></button>)}
        </section>
      </div>
      <div className="compliance-note"><Icon name="check" /><span><strong>Audit trail active</strong> · All changes in this prototype are recorded for your current session.</span></div>
    </div>
  );
}

function Stat({ label, value, detail, icon, tone }: { label: string; value: string; detail: string; icon: string; tone: string }) {
  return <div className="stat-card"><div className={`stat-icon ${tone}`}><Icon name={icon} /></div><div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div><Icon name="arrow" /></div>;
}

function EnrollmentList({ enrollments, filter, setFilter, query, setQuery, openEnrollment, setModal }: { enrollments: Enrollment[]; filter: string; setFilter: (v: string) => void; query: string; setQuery: (v: string) => void; openEnrollment: (ref: string) => void; setModal: (modal: "enrollment") => void }) {
  return <div className="page"><div className="page-heading"><div><p className="eyebrow">OPERATIONS</p><h1>Enrollments</h1><p>Track registration, accounting status, and training readiness.</p></div><button className="primary-btn" onClick={() => setModal("enrollment")}><Icon name="plus" /> Register enrollment</button></div>
    <div className="list-toolbar card"><div className="table-search"><Icon name="search" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search trainee, SRN, reference, or course" /></div><div className="filters">{["All", "Paid", "Partial", "Unpaid"].map((item) => <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item}</button>)}</div></div>
    <div className="table-card card"><table><thead><tr><th>Trainee</th><th>Enrollment</th><th>Course & center</th><th>Schedule</th><th>Payment</th><th>Balance</th><th /></tr></thead><tbody>{enrollments.map((item) => { const paid = totalPaid(item); const balance = item.fee - item.discount - paid; return <tr key={item.ref} onClick={() => openEnrollment(item.ref)}><td><div className="person"><span>{item.initials}</span><div><strong>{item.trainee}</strong><small>{item.code}</small></div></div></td><td><strong className="mono">{item.ref}</strong><StatusBadge status={item.status} /></td><td><strong>{item.course}</strong><small>{item.center}</small></td><td><strong>{item.schedule}</strong><small>{item.time}</small></td><td><StatusBadge status={paymentStatus(item)} /><small>{money(paid)} of {money(item.fee - item.discount)}</small></td><td><strong>{money(Math.max(0, balance))}</strong></td><td>›</td></tr>; })}</tbody></table>{enrollments.length === 0 && <div className="empty">No enrollments match your search.</div>}</div>
  </div>;
}

function EnrollmentDetail({ enrollment, goBack, updateStatus, setModal, notify }: { enrollment: Enrollment; goBack: () => void; updateStatus: (s: EnrollmentStatus) => void; setModal: (m: "payment") => void; notify: (m: string) => void }) {
  const paid = totalPaid(enrollment); const net = enrollment.fee - enrollment.discount; const balance = Math.max(0, net - paid); const eligible = enrollment.status === "Enrolled" && paymentStatus(enrollment) === "Paid";
  return <div className="page detail-page"><button className="back-btn" onClick={goBack}>← Back to enrollments</button><div className="page-heading"><div><div className="heading-line"><h1>{enrollment.ref}</h1><StatusBadge status={enrollment.status} /><StatusBadge status={paymentStatus(enrollment)} /></div><p>Created July 20, 2026 · {enrollment.source}</p></div><div className="detail-actions"><select aria-label="Enrollment status" value={enrollment.status} onChange={(e) => updateStatus(e.target.value as EnrollmentStatus)}><option>On-Process</option><option>Enrolled</option><option>Cancelled</option></select><button className="primary-btn" onClick={() => setModal("payment")}><Icon name="plus" /> Add payment</button></div></div>
    <div className="detail-grid"><div className="detail-main"><section className="card detail-section"><div className="section-heading"><h2>Trainee & course</h2><button>Edit</button></div><div className="trainee-hero"><div className="large-avatar">{enrollment.initials}</div><div><h3>{enrollment.trainee}</h3><span>{enrollment.code} · Able Seaman</span><p>juan.delacruz@email.com · +63 917 555 0142</p></div></div><div className="info-grid"><Info label="Course" value={enrollment.course} /><Info label="Partner center" value={enrollment.center} /><Info label="Training schedule" value={enrollment.schedule} /><Info label="Time & venue" value={`${enrollment.time} · ${enrollment.venue}`} /></div></section>
      <section className="card detail-section"><div className="section-heading"><h2>Payment history</h2><span>{enrollment.payments.length} transaction{enrollment.payments.length === 1 ? "" : "s"}</span></div>{enrollment.payments.length ? enrollment.payments.map((payment) => <div className="payment-row" key={payment.ref}><div className="payment-method"><Icon name="wallet" /></div><div><strong>{payment.method}{payment.reference ? ` · ${payment.reference}` : ""}</strong><span>{payment.date} · {payment.ref}</span></div><div><strong>{money(payment.amount)}</strong><button onClick={() => notify(`Invoice ${payment.invoice} is ready to preview.`)}>{payment.invoice}</button></div></div>) : <div className="empty-payment"><Icon name="wallet" /><strong>No payments recorded</strong><span>Add the first payment to generate an invoice.</span></div>}</section>
      <section className={`instruction-card ${eligible ? "ready" : "locked"}`}><div><Icon name={eligible ? "mail" : "clock"} /></div><div><strong>{eligible ? "Training instructions are ready" : "Training instructions are locked"}</strong><span>{eligible ? "This enrollment is confirmed and fully paid." : `Requires Enrolled + Paid. Current status: ${enrollment.status} + ${paymentStatus(enrollment)}.`}</span></div><button disabled={!eligible} onClick={() => notify("Training instructions sent to the trainee’s email.")}>Send instructions</button></section>
    </div><aside className="detail-side"><section className="card accounting-card"><div className="section-heading"><h2>Accounting</h2><span>Locked snapshot</span></div><div className="account-line"><span>Course fee</span><strong>{money(enrollment.fee)}</strong></div><div className="account-line"><span>Discount</span><strong>− {money(enrollment.discount)}</strong></div><div className="account-line total"><span>Net fee</span><strong>{money(net)}</strong></div><div className="progress"><span style={{ width: `${Math.min(100, (paid / net) * 100)}%` }} /></div><div className="account-line paid"><span>Total paid</span><strong>{money(paid)}</strong></div><div className="balance-box"><span>Remaining balance</span><strong>{money(balance)}</strong></div><small className="snapshot-note">Partner rate snapshot: {money(enrollment.partnerRate)} · Restricted to accounting roles</small></section><section className="card timeline"><h2>Activity</h2><div><span className="done">✓</span><p><strong>Enrollment created</strong><small>Jul 20 · 10:14 AM</small></p></div><div><span className={enrollment.status === "Enrolled" ? "done" : ""}>2</span><p><strong>Slot confirmation</strong><small>{enrollment.status === "Enrolled" ? "Confirmed by Jocelyn" : "Awaiting partner center"}</small></p></div><div><span className={paymentStatus(enrollment) === "Paid" ? "done" : ""}>3</span><p><strong>Payment completed</strong><small>{paymentStatus(enrollment) === "Paid" ? "Balance settled" : `${money(balance)} remaining`}</small></p></div><div><span className={enrollment.instructionsSent ? "done" : ""}>4</span><p><strong>Instructions sent</strong><small>{enrollment.instructionsSent ?? "Not yet sent"}</small></p></div></section></aside></div>
  </div>;
}

function Info({ label, value }: { label: string; value: string }) { return <div className="info"><span>{label}</span><strong>{value}</strong></div>; }

function Accounting({ enrollments, openEnrollment }: { enrollments: Enrollment[]; openEnrollment: (ref: string) => void }) {
  const payments = enrollments.flatMap((enrollment) => enrollment.payments.map((payment) => ({ ...payment, trainee: enrollment.trainee, ref2: enrollment.ref })));
  const total = payments.filter((payment) => payment.date === "Jul 22, 2026").reduce((sum, payment) => sum + payment.amount, 0);
  return <div className="page"><div className="page-heading"><div><p className="eyebrow">CASHIER</p><h1>Payments & Accounting</h1><p>Daily collections, balances, and partner collectibles.</p></div><button className="secondary-btn">Export daily summary</button></div><div className="accounting-summary"><div className="collection-hero"><span>TODAY’S COLLECTIONS</span><strong>{money(total)}</strong><small>Wednesday, July 22 · 2 transactions</small></div>{["Cash", "GCash", "Maribank", "PSBank", "Chinabank"].map((method) => <div className="method-card" key={method}><span>{method}</span><strong>{money(payments.filter((p) => p.date === "Jul 22, 2026" && p.method === method).reduce((s, p) => s + p.amount, 0))}</strong></div>)}</div><div className="tabs"><button className="active">Transactions</button><button>Outstanding balances</button><button>Partner collectibles <span>Restricted</span></button></div><div className="table-card card"><table><thead><tr><th>Payment reference</th><th>Trainee</th><th>Method</th><th>Invoice</th><th>Date received</th><th>Amount</th></tr></thead><tbody>{payments.map((payment) => <tr key={payment.ref} onClick={() => openEnrollment(payment.ref2)}><td><strong className="mono">{payment.ref}</strong><small>{payment.ref2}</small></td><td><strong>{payment.trainee}</strong></td><td><StatusBadge status={payment.method} /><small>{payment.reference ?? "Cash payment"}</small></td><td><button className="invoice-link">{payment.invoice}</button></td><td>{payment.date}</td><td><strong>{money(payment.amount)}</strong></td></tr>)}</tbody></table></div></div>;
}

function Instructions({ enrollments, openEnrollment, notify }: { enrollments: Enrollment[]; openEnrollment: (ref: string) => void; notify: (m: string) => void }) {
  const ready = enrollments.filter((item) => item.status === "Enrolled" && paymentStatus(item) === "Paid");
  return <div className="page"><div className="page-heading"><div><p className="eyebrow">COMMUNICATIONS</p><h1>Training Instructions</h1><p>Send the right reporting details once an enrollment is confirmed and paid.</p></div><button className="secondary-btn">Manage templates</button></div><div className="instructions-layout"><section className="card instruction-list"><div className="panel-title"><div><h2>Ready to send</h2><p>{ready.filter((i) => !i.instructionsSent).length} enrollment needs attention</p></div></div>{ready.map((item) => <div className="instruction-person" key={item.ref}><div className="person"><span>{item.initials}</span><div><strong>{item.trainee}</strong><small>{item.course} · {item.schedule}</small></div></div><div><StatusBadge status={item.instructionsSent ? "Sent" : "Ready"} /><button onClick={() => openEnrollment(item.ref)}>Review</button></div></div>)}</section><section className="card template-preview"><span className="template-label">COURSE TEMPLATE · BASIC TRAINING</span><h2>Your Training Schedule — Basic Training</h2><p>Hi Juan,</p><p>You’re confirmed and fully paid for <strong>Basic Training — Full Course</strong> with Nautical Options Training Institute.</p><div className="email-details"><p><span>Report on</span><strong>August 4, 2026 · 8:00 AM</strong></p><p><span>Venue</span><strong>Intramuros, Manila</strong></p><p><span>Please bring</span><strong>Valid ID, 2×2 photo, notebook</strong></p><p><span>Enrollment ref</span><strong>ENR-2026-000106</strong></p></div><p>Questions? Chat with us through our Tara Barko business inbox.</p><div className="template-actions"><button className="secondary-btn">Edit template</button><button className="primary-btn" onClick={() => notify("Training instructions sent and logged in the audit trail.")}>Send email</button></div></section></div></div>;
}

function ComingSoon({ active }: { active: string }) { return <div className="page coming"><div className="coming-mark"><Brand compact /></div><p className="eyebrow">PROTOTYPE MODULE</p><h1>{active}</h1><p>This workspace is reserved in the masterplan. Its detailed workflow will be connected in the next build phase.</p><button className="primary-btn">Return to dashboard</button></div>; }

function PaymentModal({ enrollment, close, save }: { enrollment: Enrollment; close: () => void; save: (payment: Payment) => void }) {
  const balance = Math.max(0, enrollment.fee - enrollment.discount - totalPaid(enrollment)); const [amount, setAmount] = useState(String(balance)); const [method, setMethod] = useState("GCash"); const [reference, setReference] = useState(""); const valid = Number(amount) > 0 && Number(amount) <= balance && (method === "Cash" || reference.trim().length > 0);
  return <div className="modal-backdrop"><div className="modal"><div className="modal-header"><div><p className="eyebrow">RECORD TRANSACTION</p><h2>Add payment</h2><span>{enrollment.trainee} · {enrollment.ref}</span></div><button onClick={close}>×</button></div><div className="balance-banner"><span>Remaining balance</span><strong>{money(balance)}</strong></div><label>Amount received<input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></label><label>Payment method<select value={method} onChange={(e) => setMethod(e.target.value)}>{["Cash", "GCash", "Maribank", "PSBank", "Chinabank"].map((item) => <option key={item}>{item}</option>)}</select></label>{method !== "Cash" && <label>Transaction reference <span>Required</span><input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Enter bank or wallet reference" /></label>}<label>Date received<input type="date" defaultValue="2026-07-22" /></label><div className="modal-note"><Icon name="file" /><span>An acknowledgement invoice will be generated automatically for this payment.</span></div><div className="modal-actions"><button className="secondary-btn" onClick={close}>Cancel</button><button className="primary-btn" disabled={!valid} onClick={() => save({ ref: "PAY-2026-000232", invoice: "TB-INV-2026-000232", amount: Number(amount), method, reference: reference || undefined, date: "Jul 22, 2026" })}>Record payment</button></div></div></div>;
}

function EnrollmentModal({ close, save }: { close: () => void; save: (e: Enrollment) => void }) {
  const [step, setStep] = useState(1); const [course, setCourse] = useState("Basic Training — Full Course");
  return <div className="modal-backdrop"><div className="modal wide-modal"><div className="modal-header"><div><p className="eyebrow">NEW ENROLLMENT</p><h2>{step === 1 ? "Resolve the trainee" : "Build the enrollment"}</h2><span>Step {step} of 2 · Financial rates lock on confirmation</span></div><button onClick={close}>×</button></div><div className="stepper"><span className="done">1 <b>Trainee</b></span><i /><span className={step === 2 ? "done" : ""}>2 <b>Course & schedule</b></span></div>{step === 1 ? <><div className="tabs compact-tabs"><button className="active">Search existing</button><button>Register new trainee</button></div><label>Find a trainee<div className="field-with-icon"><Icon name="search" /><input defaultValue="Ana Mendoza" placeholder="Name, SRN, or TBMS code" /></div></label><button className="trainee-result" onClick={() => setStep(2)}><div className="person"><span>AM</span><div><strong>ANA MENDOZA</strong><small>TBMS-0000044 · SRN 1029384756</small></div></div><div><StatusBadge status="Active" /><span>Select →</span></div></button><div className="history-note"><Icon name="file" /><span><strong>1 previous enrollment</strong> · Basic Training completed March 2026. No outstanding balance.</span></div></> : <><div className="form-grid"><label>Course<select value={course} onChange={(e) => setCourse(e.target.value)}><option>Basic Training — Full Course</option><option>Advanced Fire Fighting</option><option>Medical First Aid</option></select></label><label>Partner center<select><option>Nautical Options Training Institute</option><option>Great Seas Maritime Training</option></select></label><label>Available schedule<select><option>Aug 18–22, 2026 · Open</option><option>Aug 25–29, 2026 · Open</option></select></label><label>Enrollment source<select><option>Walk-in</option><option>Online</option><option>Referral</option></select></label></div><div className="rate-card"><div><span>SELLING PRICE</span><strong>{money(6500)}</strong></div><div><span>DURATION</span><strong>5 days</strong></div><div><span>MODE</span><strong>Face-to-face</strong></div><div><span>REQUIREMENTS</span><strong>Valid ID · 2×2 photo</strong></div></div><label>Remarks<textarea placeholder="Optional notes for this enrollment" /></label><div className="snapshot-warning"><Icon name="check" /><span><strong>Rate snapshot ready.</strong> Fee and partner rate will be locked to this enrollment after creation.</span></div></>}<div className="modal-actions"><button className="secondary-btn" onClick={step === 1 ? close : () => setStep(1)}>{step === 1 ? "Cancel" : "Back"}</button>{step === 1 ? <button className="primary-btn" onClick={() => setStep(2)}>Continue</button> : <button className="primary-btn" onClick={() => save({ ref: "ENR-2026-000107", trainee: "ANA MENDOZA", code: "TBMS-0000044", initials: "AM", course, courseCode: "BT-FULL", center: "Nautical Options Training Institute", schedule: "Aug 18–22, 2026", time: "8:00 AM–5:00 PM", venue: "Intramuros, Manila", fee: 6500, discount: 0, partnerRate: 5200, status: "On-Process", source: "Walk-in", payments: [] })}>Create enrollment</button>}</div></div></div>;
}

function PublicRegistration({ close, notify }: { close: () => void; notify: (m: string) => void }) {
  const [step, setStep] = useState(1); const [accepted, setAccepted] = useState(false);
  return <div className="public-overlay"><div className="public-top"><Brand /><button onClick={close}>Return to officer portal ×</button></div><div className="public-form"><div className="public-copy"><p className="eyebrow">ONLINE REGISTRATION</p><h1>Start your maritime training journey.</h1><p>Register your details with Tara Barko. We’ll help you enroll with an accredited partner training center.</p><div className="public-trust"><span>✓ Secure registration</span><span>✓ Accredited partners</span><span>✓ Dedicated assistance</span></div></div><div className="registration-card"><div className="registration-steps">{["Identity", "Contact", "Consent"].map((item, index) => <span className={step >= index + 1 ? "active" : ""} key={item}><b>{index + 1}</b>{item}</span>)}</div><h2>{step === 1 ? "Tell us about yourself" : step === 2 ? "How can we reach you?" : "Review and consent"}</h2>{step === 1 && <div className="form-grid"><label>First name<input defaultValue="ANA" /></label><label>Last name<input defaultValue="MENDOZA" /></label><label>Birth date<input type="date" defaultValue="1994-08-16" /></label><label>Seafarer rank<select><option>Able Seaman</option><option>Ordinary Seaman</option></select></label><label className="full">Seafarer Registration Number <span>Optional</span><input placeholder="10 digits" /></label></div>}{step === 2 && <div className="form-grid one-col"><label>Email address<input defaultValue="ana.mendoza@email.com" /></label><label>Confirm email<input defaultValue="ana.mendoza@email.com" /></label><label>Mobile number<input defaultValue="0917 555 0188" /></label><label>Address <span>Optional</span><textarea /></label></div>}{step === 3 && <><div className="consent-box"><strong>Terms & Conditions · Version 2026.07</strong><p>Tara Barko Maritime Services facilitates your enrollment with accredited partner training centers. Training and certification are provided by the selected partner center. Your information will be used to process and coordinate your enrollment.</p></div><label className="checkbox"><input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} /><span>I have read and accept the Terms & Conditions and consent to the processing of my registration details.</span></label></>}<div className="modal-actions"><button className="secondary-btn" onClick={step === 1 ? close : () => setStep(step - 1)}>{step === 1 ? "Cancel" : "Back"}</button>{step < 3 ? <button className="primary-btn" onClick={() => setStep(step + 1)}>Continue</button> : <button className="primary-btn" disabled={!accepted} onClick={() => { close(); notify("Registration submitted. Reference: REG-2026-000419"); }}>Submit registration</button>}</div></div></div><div className="public-footer">Tara Barko Maritime Services · 901-B GLC Building, Ermita, Manila · 0985 804 4310</div></div>;
}
