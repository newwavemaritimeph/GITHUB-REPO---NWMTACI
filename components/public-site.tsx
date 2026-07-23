import Link from "next/link";
import { AuthForm } from "./auth-form";
import { NewWaveLogo } from "./new-wave-logo";
import { PublicCourseCatalog } from "./public-course-catalog";
import { PublicSchedules } from "./public-schedules";
import { RegistrationForm } from "./registration-form";
import { RegistrationStatus } from "./registration-status";
import { isDemoMode } from "@/lib/system/mode";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export type PublicPage =
  | "home"
  | "about"
  | "courses"
  | "schedules"
  | "register"
  | "registration-search"
  | "contact"
  | "staff-login";

const nav = [
  ["About", "/about"],
  ["Courses", "/courses"],
  ["Schedules", "/schedules"],
  ["Contact", "/contact"],
] as const;

function Header() {
  return (
    <header className="public-header">
      <div className="public-nav">
        <Link href="/" aria-label="New Wave Maritime home">
          <NewWaveLogo />
        </Link>
        <nav aria-label="Public navigation">
          {nav.map(([label, href]) => (
            <Link key={href} href={href}>
              {label}
            </Link>
          ))}
        </nav>
        <div className="public-nav-actions">
          <Link className="text-link" href="/registration-search">
            Check enrollment status
          </Link>
          <Link className="button button-primary button-small" href="/register">
            Enroll now
          </Link>
        </div>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="public-footer">
      <div>
        <NewWaveLogo />
        <p>Ride the New Wave of Maritime Excellence.</p>
      </div>
      <div>
        <strong>Explore</strong>
        <Link href="/courses">Courses</Link>
        <Link href="/schedules">Available schedules</Link>
        <Link href="/register">Register online</Link>
        <Link href="/registration-search">Check enrollment status</Link>
      </div>
      <div>
        <strong>Access</strong>
        <Link href="/staff-login">Authorized staff</Link>
        <Link href="/contact">Contact us</Link>
      </div>
      <div className="footer-status">
        <span className="status-dot" />
        Online registration is open
        <p>
          5F (505) GLC Building, T.M. Kalaw corner A. Mabini, Ermita, Manila 1000
          <br />
          +63 948 847 6530 · 8553 0310
        </p>
      </div>
    </footer>
  );
}

const journey = [
  ["01", "Register online", "One guided form creates your trainee record and reserves a published schedule."],
  ["02", "Pay and confirm", "Pay at the cashier or online. Every payment is verified and receipted."],
  ["03", "Train and complete", "Instructions, attendance, and certificate release all tracked in your portal."],
] as const;

function Home() {
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">Maritime training, made clear</span>
          <h1>Ride the New Wave of Maritime Excellence</h1>
          <p>
            From registration to certificate release, New Wave keeps every step of your maritime training organized, visible,
            and supported.
          </p>
          <div className="hero-actions">
            <Link className="button button-primary" href="/register">
              Start your registration <span aria-hidden="true">→</span>
            </Link>
            <Link className="button button-secondary" href="/schedules">
              See open schedules
            </Link>
          </div>
          <div className="trust-row">
            <span>✓ Secure registration</span>
            <span>✓ Verified payments</span>
            <span>✓ Certificate tracking</span>
          </div>
        </div>
        <div className="hero-visual" aria-label="New Wave training journey">
          <div className="wave-card main">
            <span className="card-kicker">Your training journey</span>
            <h2>One clear path from registration to completion.</h2>
            <div className="journey-steps">
              <div className="done">
                <b>1</b>
                <span>
                  <strong>Register</strong>
                  <small>Your central trainee record</small>
                </span>
              </div>
              <i />
              <div className="active">
                <b>2</b>
                <span>
                  <strong>Pay & train</strong>
                  <small>Receipts, instructions, attendance</small>
                </span>
              </div>
              <i />
              <div>
                <b>3</b>
                <span>
                  <strong>Complete</strong>
                  <small>Verified attendance and certificate</small>
                </span>
              </div>
            </div>
          </div>
          <div className="float-card float-a">
            <span>Next schedule</span>
            <strong>Published by the Scheduler</strong>
          </div>
          <div className="float-card float-b">
            <span className="round-check">✓</span>
            <div>
              <strong>Registration saved</strong>
              <small>Search by reference and email</small>
            </div>
          </div>
        </div>
      </section>

      <section className="proof-strip">
        <div>
          <strong>One trainee record</strong>
          <span>No repeated information</span>
        </div>
        <div>
          <strong>Live schedules</strong>
          <span>Only available batches</span>
        </div>
        <div>
          <strong>Verified payments</strong>
          <span>Receipts and balances</span>
        </div>
        <div>
          <strong>Clear updates</strong>
          <span>Portal and email notifications</span>
        </div>
      </section>

      <section className="section feature-section">
        <div className="section-heading">
          <span className="eyebrow">Built around your next step</span>
          <h2>Everything you need, without the guesswork.</h2>
          <p>New Wave connects your enrollment, payment, training instructions, attendance, requests, and documents.</p>
        </div>
        <div className="feature-grid">
          {journey.map(([number, title, text]) => (
            <article key={number}>
              <span>{number}</span>
              <h3>{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section callout">
        <div>
          <span className="eyebrow light">Ready when you are</span>
          <h2>Take the next step in your maritime career.</h2>
          <p>Register online and let the New Wave team guide your enrollment.</p>
        </div>
        <Link className="button button-white" href="/register">
          Begin registration
        </Link>
      </section>
    </>
  );
}

function About() {
  return (
    <section className="inside-page">
      <div className="inside-hero">
        <span className="eyebrow">About New Wave</span>
        <h1>Training people for safer work at sea.</h1>
        <p>
          New Wave Maritime Training and Assessment Center, Inc. brings enrollment, training operations, and learner support
          into one dependable experience.
        </p>
      </div>
      <div className="split-content">
        <article>
          <h2>Clear systems. Human support.</h2>
          <p>
            Our integrated approach gives trainees a single record, accurate schedules, secure documents, and clear status
            updates. Staff work from the same source of truth so every handoff is accountable.
          </p>
          <p>
            Official accreditations, company history, and leadership details are managed through the Admin launch settings
            before the public site goes live.
          </p>
        </article>
        <div className="principle-card">
          <span>Our operating principles</span>
          <ul>
            <li>Safety before speed</li>
            <li>Accurate, auditable records</li>
            <li>Respectful learner support</li>
            <li>Secure handling of personal data</li>
          </ul>
        </div>
      </div>
    </section>
  );
}

function Courses() {
  return (
    <section className="inside-page">
      <div className="inside-hero compact">
        <span className="eyebrow">New Wave course catalog</span>
        <h1>Find the training that fits your next step.</h1>
        <p>
          Browse STCW Courses, In-House Courses, and Endorsed Trainings in one simple list. Course fees are confirmed
          privately during enrollment.
        </p>
      </div>
      <PublicCourseCatalog />
    </section>
  );
}

function Schedules() {
  return (
    <section className="inside-page">
      <div className="inside-hero compact">
        <span className="eyebrow">Available schedules</span>
        <h1>Plan training around your voyage.</h1>
        <p>
          Published batches show only future schedules with available slots. Full, cancelled, ongoing, and past sessions are
          hidden automatically.
        </p>
      </div>
      <PublicSchedules />
    </section>
  );
}

function Register() {
  return (
    <section className="inside-page registration-page">
      <div className="registration-intro">
        <span className="eyebrow">Online registration</span>
        <h1>Three steps to reserve your training slot.</h1>
        <p>
          Tell us about yourself once, choose a published schedule, and confirm. You will receive a reference you can use to
          track payment, instructions, attendance, and your certificate.
        </p>
        <div className="privacy-note">
          <strong>Your privacy matters</strong>
          <span>
            Information is used only for registration, training coordination, records, and required communication.
          </span>
        </div>
      </div>
      <RegistrationForm />
    </section>
  );
}

function RegistrationSearch() {
  return (
    <section className="inside-page narrow-page">
      <div className="inside-hero compact">
        <span className="eyebrow">Enrollment status</span>
        <h1>Check your enrollment status.</h1>
        <p>
          See your schedule, payment balance, training instructions, and certificate progress. For your protection, use both
          the reference sent to you and the email address registered with New Wave.
        </p>
      </div>
      <RegistrationStatus />
    </section>
  );
}

function Contact() {
  return (
    <section className="inside-page">
      <div className="inside-hero compact">
        <span className="eyebrow">Contact New Wave</span>
        <h1>We are ready to help.</h1>
        <p>Send a question about registration, schedules, requirements, or your trainee record.</p>
      </div>
      <div className="contact-layout">
        <form className="contact-form" action="/api/public/contact" method="post">
          <label>
            Complete name
            <input name="name" required />
          </label>
          <label>
            Email address
            <input name="email" type="email" required />
          </label>
          <label>
            Mobile number
            <input name="mobile" />
          </label>
          <label>
            How can we help?
            <textarea name="message" rows={6} required />
          </label>
          <button className="button button-primary">Send message</button>
        </form>
        <aside>
          <span className="eyebrow">Official details</span>
          <h2>Visit or contact us</h2>
          <p>103 Bel Air Apartments, 1020 Roxas Boulevard, Ermita, Manila 1000</p>
          <div className="contact-point">
            <span>Mobile</span>
            <strong>+63 948 847 6530</strong>
          </div>
          <div className="contact-point">
            <span>Telephone</span>
            <strong>8553 0310</strong>
          </div>
          <div className="contact-point">
            <span>Email</span>
            <strong>newwavemaritime@gmail.com</strong>
          </div>
        </aside>
      </div>
    </section>
  );
}

function StaffLogin() {
  const configured = isSupabaseConfigured() && !isDemoMode();
  // A deployed site with no Supabase configuration cannot offer the local
  // workspace, and must not link to /portal, which would bounce straight back.
  const misconfiguredInProduction = process.env.NODE_ENV === "production" && !isSupabaseConfigured();
  if (misconfiguredInProduction) {
    return (
      <section className="login-page">
        <div className="login-copy">
          <span className="eyebrow">Secure staff access</span>
          <h1>Staff sign-in is unavailable.</h1>
          <p>
            This deployment has no database configuration, so staff accounts cannot be verified. Nothing is accessible until
            it is set.
          </p>
        </div>
        <div className="login-card">
          <h2>Configuration required</h2>
          <p>
            Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> in the hosting
            environment, then redeploy.
          </p>
          <Link className="button button-secondary button-block" href="/">
            Back to the public website
          </Link>
        </div>
      </section>
    );
  }
  return (
    <section className="login-page">
      <div className="login-copy">
        <span className="eyebrow">Secure staff access</span>
        <h1>Welcome back to New Wave.</h1>
        <p>Use your invited staff account. Permissions are checked for every record and action.</p>
        <ul>
          <li>Encrypted connection and secure sessions</li>
          <li>Role-based access to private records</li>
          <li>Every sensitive change is audited</li>
        </ul>
      </div>
      <div className="login-card">
        <h2>Authorized staff login</h2>
        {configured ? (
          <>
            <p>Enter the email associated with your account.</p>
            <AuthForm portal="staff" />
          </>
        ) : (
          <>
            <p>
              The workspace is running in demo mode, with records kept in your browser so the full workflow is explorable
              before staff accounts exist in the database.
            </p>
            <Link className="button button-primary button-block" href="/portal">
              Open the staff workspace
            </Link>
            <p className="signin-help">
              Set <code>NEXT_PUBLIC_DEMO_MODE=false</code> in <code>.env.local</code> to switch this page back to real
              Supabase authentication.
            </p>
          </>
        )}
      </div>
    </section>
  );
}

export function PublicSite({ page }: { page: PublicPage }) {
  const content =
    page === "home" ? (
      <Home />
    ) : page === "about" ? (
      <About />
    ) : page === "courses" ? (
      <Courses />
    ) : page === "schedules" ? (
      <Schedules />
    ) : page === "register" ? (
      <Register />
    ) : page === "registration-search" ? (
      <RegistrationSearch />
    ) : page === "contact" ? (
      <Contact />
    ) : (
      <StaffLogin />
    );
  return (
    <main className="public-site">
      <Header />
      {content}
      <Footer />
    </main>
  );
}
