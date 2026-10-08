/**
 * Data Privacy Notice (owner request, 8 Oct 2026). Public page at /privacy,
 * written for the Data Privacy Act of 2012 (Republic Act No. 10173). It also
 * states how the staff portal uses Google data (Classroom and Drive), which
 * Google asks for on the app's sign-in screen. Review with New Wave's Data
 * Protection Officer before relying on it as the final policy.
 */

const EFFECTIVE = "October 8, 2026";
const EMAIL = "newwavemaritime@gmail.com";
const ADDRESS = "Room 103, Bel-Air Apartment, 1020 Roxas Boulevard, Ermita, Manila 1000";

const sections: { id: string; title: string; body: React.ReactNode }[] = [
  {
    id: "who", title: "Who we are",
    body: <p>New Wave Maritime Training and Assessment Center, Inc. (&ldquo;New Wave&rdquo;, &ldquo;we&rdquo;) trains and assesses Filipino seafarers. This notice explains how we collect, use, store and share personal information through our website, online registration and staff portal, as required by the Data Privacy Act of 2012 (Republic Act No. 10173) and its implementing rules.</p>,
  },
  {
    id: "collect", title: "Information we collect",
    body: <ul>
      <li><strong>Identity and contact:</strong> full name, date and place of birth, sex, nationality, address, email address, mobile number, and an emergency contact person and number.</li>
      <li><strong>Seafarer details:</strong> Seafarer&apos;s Identification and Record Book or Seafarer Registration Number (SRN), rank, and company or agency.</li>
      <li><strong>Training records:</strong> chosen courses and schedules, requirement checks (valid ID, medical certificate, 2x2 photo, seaman&apos;s book), attendance, assessments and certificates.</li>
      <li><strong>Payment records:</strong> amounts, mode of payment, reference numbers and proofs of payment (such as GCash, PSBank or UnionBank screenshots), receipts and invoices.</li>
      <li><strong>Staff accounts:</strong> name, work email, role and activity logs for authorized New Wave employees.</li>
    </ul>,
  },
  {
    id: "use", title: "How we use it",
    body: <ul>
      <li>To process your registration, check your requirements and enroll you in the courses you choose.</li>
      <li>To schedule training, send training instructions and invite you to the course&apos;s Google Classroom class.</li>
      <li>To record payments, issue receipts, admission records and certificates, and keep accounting records.</li>
      <li>To contact you about your training, schedule changes and requests you make.</li>
      <li>To comply with legal and regulatory requirements, including those of the Maritime Industry Authority (MARINA) and tax authorities.</li>
    </ul>,
  },
  {
    id: "basis", title: "Why we may process it",
    body: <p>We process your information because it is needed to provide the training you apply for, because the law requires us to keep certain records, and, where applicable, because you have given your consent when you submit the registration form. You may withdraw consent at any time, but we may then be unable to complete your enrollment.</p>,
  },
  {
    id: "share", title: "Who we share it with",
    body: <>
      <p>We do not sell your personal information. We share it only when needed:</p>
      <ul>
        <li><strong>Government agencies</strong> such as MARINA, when required for certification or by law.</li>
        <li><strong>Your company or manning agency</strong>, when they enrolled or endorsed you.</li>
        <li><strong>Service providers</strong> that run our systems on our behalf: Supabase (database and secure storage), Vercel (website hosting), Google (Classroom and Drive), and our email delivery provider. They may use the information only to provide their service to New Wave.</li>
      </ul>
    </>,
  },
  {
    id: "google", title: "Google data used by the staff portal",
    body: <>
      <p>New Wave&apos;s staff portal connects to New Wave&apos;s own Google account. It does not ask trainees to sign in with Google.</p>
      <ul>
        <li><strong>Google Classroom:</strong> the portal reads the list of New Wave&apos;s classes and invites a trainee&apos;s registered email address to the class for the course they enrolled in.</li>
        <li><strong>Google Drive:</strong> the portal saves proofs of payment and expense vouchers into folders it creates in New Wave&apos;s Drive. It can see only the files and folders it created itself, and does not read or change any other file.</li>
        <li>Google data is used only for these purposes, is not sold, is not used for advertising, and is not shared with anyone else. New Wave&apos;s use of information received from Google APIs follows the Google API Services User Data Policy, including its Limited Use requirements.</li>
        <li>New Wave can disconnect the portal from Google at any time from the portal or from its Google Account settings.</li>
      </ul>
    </>,
  },
  {
    id: "security", title: "How we protect it",
    body: <p>Records are stored in access-controlled systems. Only authorized staff can see the information their role needs, every sensitive action is logged, files are kept in private storage, and connections are encrypted. Stored Google access is encrypted. No system is completely secure, so we review our safeguards regularly and will notify you and the National Privacy Commission of a personal data breach when the law requires it.</p>,
  },
  {
    id: "retention", title: "How long we keep it",
    body: <p>We keep training, certificate and payment records for as long as needed for the purposes above and for the periods required by law and regulators. When records are no longer needed, they are securely deleted or anonymized.</p>,
  },
  {
    id: "rights", title: "Your rights",
    body: <>
      <p>Under the Data Privacy Act you have the right to be informed, to access your information, to object to processing, to have inaccurate information corrected, to have information erased or blocked when allowed by law, to data portability, and to claim damages. You may also file a complaint with the National Privacy Commission (privacy.gov.ph).</p>
      <p>To use any of these rights, contact us using the details below. We may ask you to confirm your identity first.</p>
    </>,
  },
  {
    id: "contact", title: "Contact our Data Protection Officer",
    body: <p>Data Protection Officer, New Wave Maritime Training and Assessment Center, Inc.<br />{ADDRESS}<br />Email: <a href={`mailto:${EMAIL}`}>{EMAIL}</a></p>,
  },
  {
    id: "changes", title: "Changes to this notice",
    body: <p>We may update this notice. The current version is always on this page, with its effective date.</p>,
  },
];

export function PrivacyNotice() {
  return (
    <section className="inside-page privacy-page">
      <div className="inside-hero">
        <span className="eyebrow">Data privacy</span>
        <h1>Data privacy notice</h1>
        <p>Effective {EFFECTIVE}</p>
      </div>
      <div className="privacy-body">
        <nav className="privacy-toc" aria-label="On this page">
          {sections.map((s) => <a key={s.id} href={`#${s.id}`}>{s.title}</a>)}
        </nav>
        <div className="privacy-sections">
          {sections.map((s) => <article key={s.id} id={s.id}><h2>{s.title}</h2>{s.body}</article>)}
        </div>
      </div>
    </section>
  );
}
