import Link from "next/link";
import { AuthForm } from "./auth-form";
import { NewWaveLogo } from "./new-wave-logo";
import { PublicNav } from "./public-nav";
import { PublicCourseCatalog } from "./public-course-catalog";
import { RegistrationForm } from "./registration-form";
import { RegistrationStatus } from "./registration-status";
import { isDemoMode } from "@/lib/system/mode";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export type PublicPage =
  | "home"
  | "about"
  | "courses"
  | "register"
  | "registration-search"
  | "contact"
  | "staff-login";

/* Mockup navigation. "Gallery" is omitted deliberately: there is no gallery
 * page or imagery yet, and a nav item that 404s is worse than one absent.
 * Schedules and Accreditation point at the sections that already hold that
 * content rather than at new empty pages. */
const nav = [
  ["Home", "/"],
  ["About", "/about"],
  ["Courses", "/courses"],
  ["Schedules", "/courses#schedules"],
  ["Accreditation", "/about#accreditations"],
  ["Gallery", "/about#facilities"],
  ["Enrollment status", "/registration-search"],
  ["Contact", "/contact"],
] as const;

/* Route each public page renders at, so the header can underline the current
   item. Section links (anything with a #hash) are never marked active. */
const PAGE_PATH: Record<PublicPage, string> = {
  home: "/", about: "/about", courses: "/courses", register: "/register",
  "registration-search": "/registration-search", contact: "/contact", "staff-login": "/staff-login",
};

/* MARINA Certificates of Course Approval held by New Wave, transcribed from the
 * issued documents. All five were issued 12 May 2026 under MARINA Circular
 * No. SC-2021-09 and run to 12 May 2036. Order matches the approved layout.
 *
 * The thumbnails under public/certificates/ are unmodified web derivatives;
 * the originals under public/certificates/originals/ are the files the user
 * supplied, byte for byte, and are what every link opens. */
const HERO_CERTIFICATES = [
  { no: "ACC 2026-036", title: "Safety Training for Personnel Providing Direct Service to Passengers in Passengers Spaces", file: "acc-2026-036" },
  { no: "ACC 2026-034", title: "Security Awareness Training and Seafarers with Designated Security Duties", file: "acc-2026-034" },
  { no: "ACC 2026-035", title: "Ship Security Officers", file: "acc-2026-035" },
  { no: "ACC 2026-037", title: "Passenger Ship Crowd Management Training", file: "acc-2026-037" },
  { no: "ACC 2026-038", title: "Passenger Ship Crisis Management and Human Behaviour Training", file: "acc-2026-038" },
] as const;

const CERTIFICATE_VALIDITY = { issued: "12 May 2026", expires: "12 May 2036" } as const;

const TRUST_STRIP = [
  ["wheel", "MARINA", "Course approvals"],
  ["iso", "ISO 9001:2015", "Certified"],
  ["people", "Experienced", "Instructors"],
  ["calendar", "Flexible", "Schedules"],
] as const;

/* Inline icons for the trust strip — drawn, so they take the brand colour and
   stay crisp at any size. */
function TrustIcon({ kind }: { kind: (typeof TRUST_STRIP)[number][0] }) {
  const common = { width: 34, height: 34, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (kind === "wheel") return (
    <svg {...common}><circle cx="12" cy="12" r="3.2" /><circle cx="12" cy="12" r="8" />
      <path d="M12 1.5v2.7M12 19.8v2.7M1.5 12h2.7M19.8 12h2.7M4.6 4.6l1.9 1.9M17.5 17.5l1.9 1.9M4.6 19.4l1.9-1.9M17.5 6.5l1.9-1.9M12 8.8V4.2M12 15.2v4.6M8.8 12H4.2M15.2 12h4.6" /></svg>);
  if (kind === "iso") return (
    <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18M5 7.5h14M5 16.5h14" /></svg>);
  if (kind === "people") return (
    <svg {...common}><circle cx="8.5" cy="8" r="3" /><circle cx="16" cy="9" r="2.5" /><path d="M2.5 19c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5M13.5 18.5c.4-2.5 2.3-4 4.5-4 2.1 0 3.6 1.3 3.5 3.5" /></svg>);
  return (
    <svg {...common}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4M7 14h2M11 14h2M15 14h2M7 17.5h2M11 17.5h2" /></svg>);
}

/* New Wave's official details and public channels. Update the two social URLs
 * here if the Facebook page handle differs. */
const CONTACT = {
  address: "Room 103, Bel-Air Apartment, 1020 Roxas Boulevard, Ermita, Manila 1000",
  mobile: "+63 948 847 6530",
  telephone: "8553 0310",
  email: "newwavemaritime@gmail.com",
  facebook: "https://www.facebook.com/newwavemtc",
  messenger: "https://m.me/newwavemtc",
};

const ACCREDITATIONS = [
  ["MARINA", "Maritime Industry Authority — accredited training center"],
  ["TESDA", "Technical Education and Skills Development Authority"],
  ["STCW 1978", "As amended — international standards of training & certification"],
  ["ISO 9001:2015", "Certified quality management system"],
] as const;

const VISION =
  "To be a leading Maritime and TESDA Training and Assessment center where individuals gain valuable maritime and technical skills that open doors to rewarding careers through high-quality education and certification, helping our seafarers build competence and confidence, and setting them up for success in the maritime industry.";

const MISSION =
  "To provide high-quality, practical training that empowers seafarers with essential skills, knowledge, and confidence for a safe and rewarding career at sea — committed to fostering a supportive learning environment, upholding rigorous safety standards, and embracing innovation so our seafarers are well-prepared to meet the evolving demands of the maritime industry.";

const CORE_VALUES = [
  ["N", "Nurturing growth", "An environment that encourages personal and professional development."],
  ["E", "Excellence", "The highest quality in every training program."],
  ["W", "Wisdom", "The value of knowledge and experience at sea."],
  ["W", "Workmanship", "A culture of skill and craftsmanship."],
  ["A", "Adaptability", "Flexibility and resilience in changing maritime environments."],
  ["V", "Values of safety", "Safety prioritized in all practices and training."],
  ["E", "Empowerment", "Trainees equipped with the skills and confidence to succeed."],
] as const;

const BUSINESS_FOCUS = [
  ["STCW-compliant courses", "Basic safety and STCW training aligned with international standards."],
  ["Advanced shipboard courses", "Specialized and upgrading programs for seafarers and officers."],
  ["In-house maritime programs", "New Wave's own catalog across deck, engine, and catering tracks."],
  ["Competency assessments", "Assessment and certification for maritime and technical skills."],
  ["Simulator-based instruction", "Practical, hands-on training on quality-standard equipment."],
  ["Documentation assistance", "Support for seafarers' certificates and requirements."],
] as const;

const TESTIMONIALS = [
  ["John Santos", "The training at New Wave Maritime was excellent. The practical skills and knowledge I gained prepared me well for my career."],
  ["Daniel Reyes", "A transformative experience — the instructors were supportive and highly experienced."],
  ["Ellaine Batangas", "I highly recommend New Wave for anyone building a career in the maritime industry."],
] as const;

function FacebookIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor">
      <path d="M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06c0 5 3.66 9.14 8.44 9.94v-7.03H7.9v-2.9h2.54V9.85c0-2.51 1.49-3.9 3.78-3.9 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56v1.89h2.78l-.44 2.9h-2.34V22c4.78-.8 8.44-4.94 8.44-9.94Z" />
    </svg>
  );
}

function MessengerIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor">
      <path d="M12 2C6.36 2 2 6.13 2 11.7c0 2.91 1.19 5.42 3.14 7.16.16.14.26.35.27.57l.05 1.78c.02.57.6.94 1.12.71l1.98-.87c.17-.08.36-.09.54-.04 1.83.5 3.79.6 5.72.24C19.8 20.29 22 16.42 22 11.7 22 6.13 17.64 2 12 2Zm6 7.46-2.93 4.65c-.47.74-1.47.93-2.18.4l-2.33-1.75a.6.6 0 0 0-.72 0l-3.15 2.39c-.42.32-.97-.18-.69-.63l2.93-4.65c.47-.74 1.47-.93 2.18-.4l2.33 1.75c.21.16.51.16.72 0l3.15-2.39c.42-.32.97.18.69.63Z" />
    </svg>
  );
}

function SocialLinks({ className = "" }: { className?: string }) {
  return (
    <div className={`social-links ${className}`}>
      <a href={CONTACT.facebook} target="_blank" rel="noopener noreferrer" className="social-btn facebook" aria-label="New Wave Maritime on Facebook">
        <FacebookIcon />
        <span>Facebook</span>
      </a>
      <a href={CONTACT.messenger} target="_blank" rel="noopener noreferrer" className="social-btn messenger" aria-label="Message New Wave Maritime">
        <MessengerIcon />
        <span>Messenger</span>
      </a>
    </div>
  );
}

function Header({ page }: { page: PublicPage }) {
  const current = PAGE_PATH[page];
  return (
    <header className="public-header">
      <div className="public-nav">
        <Link href="/" aria-label="New Wave Maritime home" className="brand-link">
          <NewWaveLogo />
        </Link>
        <PublicNav items={nav} current={current} />
        <div className="public-nav-actions">
          {/* The only lookup on the site is the enrollment-status search. */}
          <Link href="/registration-search" className="nav-search" aria-label="Check enrollment status">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.8-3.8" /></svg>
          </Link>
          <Link className="button button-primary nav-enroll" href="/register">
            Enroll Now <span aria-hidden="true">→</span>
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
        <Link href="/about">About New Wave</Link>
        <Link href="/courses">Courses</Link>
        <Link href="/register">Enrollment form</Link>
        <Link href="/registration-search">Status &amp; certificate check</Link>
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
          {CONTACT.address}
          <br />
          {CONTACT.mobile} · {CONTACT.telephone}
          <br />
          {CONTACT.email}
        </p>
        <SocialLinks className="footer-social" />
      </div>
    </footer>
  );
}

const highlights = [
  ["⚓", "Professional maritime instructors", "Learn from supportive, highly experienced maritime professionals."],
  ["🛠️", "Quality-Standard Equipment", "Practical, simulator-based training on modern, standard equipment."],
  ["🎓", "Recognized certification", "MARINA- and TESDA-aligned training that opens doors to a career at sea."],
] as const;

function Home() {
  return (
    <>
      <section className="nw-hero">
        <div className="nw-hero-art" aria-hidden="true" />
        <div className="nw-hero-grid">
          <div className="nw-hero-copy">
            <span className="nw-eyebrow">MARINA-accredited courses</span>
            {/* Written in sentence case; the all-caps look is a display
                transform, so screen readers and search engines get real text. */}
            <h1 className="nw-headline">
              Quality<br />maritime training<br />for a <em>brighter<br />tomorrow</em>
            </h1>
            <p className="nw-lede">
              Build your skills. Get certified. Be future-ready. Train with New Wave Maritime Training and
              Assessment Center, Inc. through approved maritime training programs.
            </p>
            <div className="nw-hero-actions">
              <Link className="nw-btn nw-btn-primary" href="/courses">
                View Courses <span aria-hidden="true">→</span>
              </Link>
              <Link className="nw-btn nw-btn-ghost" href="/contact">
                Inquire Now
              </Link>
            </div>
          </div>

          <div className="nw-hero-visual">
            {/* Drop a photograph at public/hero-reception.jpg and it appears here.
                Until then the solid brand panel shows — never a broken image. */}
            {/* The real reception, unaltered. No accreditation seals are composited
                onto it: the MARINA course approvals are shown as the documents
                themselves below, and ISO branding is not asserted by imagery. */}
            <div className="nw-photo" role="img" aria-label="The New Wave Maritime Training and Assessment Center reception" />
            <div className="nw-modality">
              <i aria-hidden="true">🎓</i>
              <div>
                <span>Modality</span>
                <strong>Online &amp; Face-to-face</strong>
              </div>
            </div>
          </div>
        </div>

        <ul className="nw-certs" aria-label="MARINA certificates of course approval">
          {HERO_CERTIFICATES.map((cert) => (
            <li key={cert.no} className="nw-cert">
              <a
                href={`/certificates/originals/${cert.file}.png`}
                target="_blank"
                rel="noopener"
                aria-label={`View approval certificate ${cert.no}: ${cert.title} (opens the full image in a new tab)`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/certificates/${cert.file}.webp`}
                  alt={`MARINA Certificate of Course Approval ${cert.no} for ${cert.title}`}
                  loading="lazy"
                  width={900}
                  height={1108}
                />
                <span className="nw-cert-no">{cert.no}</span>
                <strong>{cert.title}</strong>
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section className="nw-trust">
        {TRUST_STRIP.map(([icon, title, note]) => (
          <div key={title}>
            <i><TrustIcon kind={icon} /></i>
            <div>
              <strong>{title}</strong>
              <span>{note}</span>
            </div>
          </div>
        ))}
      </section>

      <section className="section feature-section">
        <div className="section-heading">
          <span className="eyebrow">Why train with New Wave</span>
          <h2>Quality training, professional instructors.</h2>
          <p>Everything we do is focused on preparing competent, confident seafarers for a rewarding career at sea.</p>
        </div>
        <div className="feature-grid">
          {highlights.map(([icon, title, text]) => (
            <article key={title}>
              <span aria-hidden="true">{icon}</span>
              <h3>{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section vision-mission">
        <article>
          <span className="eyebrow">Our vision</span>
          <p>{VISION}</p>
        </article>
        <article>
          <span className="eyebrow">Our mission</span>
          <p>{MISSION}</p>
        </article>
      </section>

      <section className="section focus-section">
        <div className="section-heading">
          <span className="eyebrow">Business focus</span>
          <h2>What we offer.</h2>
          <p>A complete range of maritime training and assessment services under MARINA and TESDA approval.</p>
        </div>
        <div className="focus-grid">
          {BUSINESS_FOCUS.map(([title, text]) => (
            <article key={title}>
              <h3>{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section testimonial-section">
        <div className="section-heading">
          <span className="eyebrow">Testimonials</span>
          <h2>What our trainees say.</h2>
        </div>
        <div className="testimonial-grid">
          {TESTIMONIALS.map(([name, quote]) => (
            <figure key={name}>
              <blockquote>“{quote}”</blockquote>
              <figcaption>{name}</figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section className="section location-section">
        <div>
          <span className="eyebrow">Visit us</span>
          <h2>Find New Wave Maritime.</h2>
          <p className="location-address">{CONTACT.address}</p>
          <div className="location-contacts">
            <span>Mobile <strong>{CONTACT.mobile}</strong></span>
            <span>Tel <strong>{CONTACT.telephone}</strong></span>
            <span>Email <strong>{CONTACT.email}</strong></span>
          </div>
          <SocialLinks />
        </div>
        <Link className="button button-primary" href="/register">
          Enroll Now <span aria-hidden="true">→</span>
        </Link>
      </section>
    </>
  );
}

function About() {
  return (
    <section className="inside-page about-page">
      <div className="inside-hero">
        <span className="eyebrow">About New Wave</span>
        <h1>Empowering Filipino seafarers for safer work at sea.</h1>
        <p>
          New Wave Maritime Training and Assessment Center, Inc. opened its doors to Filipino seafarers on December 3, 2024.
          Founded and led by <strong>Dr. Mark Anthony A. Vera</strong> — a dynamic leader from Negros with a solid background
          in the maritime industry — together with a small, dedicated team, New Wave was built on a shared passion for
          supporting seafarers through high-quality training and certification.
        </p>
      </div>

      <div className="about-vm">
        <article>
          <span className="eyebrow">Vision</span>
          <p>{VISION}</p>
        </article>
        <article>
          <span className="eyebrow">Mission</span>
          <p>{MISSION}</p>
        </article>
      </div>

      <div className="about-block">
        <div className="section-heading left">
          <span className="eyebrow">Core values</span>
          <h2>The NEWWAVE that guides us.</h2>
        </div>
        <div className="values-grid">
          {CORE_VALUES.map(([letter, title, text], index) => (
            <article key={`${title}-${index}`}>
              <span className="value-letter" aria-hidden="true">{letter}</span>
              <div>
                <h3>{title}</h3>
                <p>{text}</p>
              </div>
            </article>
          ))}
        </div>
      </div>

      <div className="about-block">
        <div className="section-heading left">
          <span className="eyebrow">Business focus</span>
          <h2>Maritime and TESDA training &amp; assessment.</h2>
        </div>
        <div className="focus-grid">
          {BUSINESS_FOCUS.map(([title, text]) => (
            <article key={title}>
              <h3>{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </div>

      <div className="about-block" id="accreditations">
        <div className="section-heading left">
          <span className="eyebrow">Accreditations</span>
          <h2>Recognized and certified.</h2>
        </div>
        <div className="accred-grid">
          {ACCREDITATIONS.map(([name, note]) => (
            <article key={name}>
              <strong>{name}</strong>
              <p>{note}</p>
            </article>
          ))}
        </div>
        <p className="about-note">
          Backed by our Certificate of Incorporation and Business Permit for the provision of maritime training and
          assessment services.
        </p>
        <div className="cert-gallery-head">
          <h3>MARINA course approval certificates</h3>
          <p>
            Five Certificates of Course Approval issued by the Maritime Industry Authority on {CERTIFICATE_VALIDITY.issued},
            valid to {CERTIFICATE_VALIDITY.expires}. Each opens the full document.
          </p>
        </div>
        <ul className="cert-gallery" aria-label="View course approval certificates">
          {HERO_CERTIFICATES.map((cert) => (
            <li key={cert.no}>
              <figure>
                <a
                  href={`/certificates/originals/${cert.file}.png`}
                  target="_blank"
                  rel="noopener"
                  aria-label={`View approval certificate ${cert.no}: ${cert.title} (opens the full image in a new tab)`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/certificates/${cert.file}.webp`}
                    alt={`MARINA Certificate of Course Approval ${cert.no} for ${cert.title}`}
                    loading="lazy"
                    width={900}
                    height={1108}
                  />
                </a>
                <figcaption>
                  <span>{cert.no}</span>
                  <strong>{cert.title}</strong>
                </figcaption>
              </figure>
            </li>
          ))}
        </ul>
      </div>

      <div className="about-block" id="team">
        <div className="section-heading left">
          <span className="eyebrow">Our people</span>
          <h2>Led by experienced maritime professionals.</h2>
        </div>
        <div className="team-grid">
          <article className="team-lead">
            <span className="team-avatar" aria-hidden="true">MV</span>
            <div>
              <strong>Dr. Mark Anthony A. Vera</strong>
              <span className="team-role">Founder &amp; Managing Head</span>
              <p>A maritime industry leader from Negros, driving New Wave&apos;s mission to train competent, confident seafarers.</p>
            </div>
          </article>
          <article className="team-note">
            <p>
              Dr. Vera is supported by a dedicated team of maritime instructors and staff committed to quality training and
              learner support.
            </p>
          </article>
        </div>
      </div>

      <div className="about-block" id="facilities">
        <div className="section-heading left">
          <span className="eyebrow">Facilities</span>
          <h2>Built for practical, hands-on learning.</h2>
        </div>
        <div className="focus-grid">
          <article>
            <h3>Training classrooms</h3>
            <p>Comfortable rooms for lectures and blended online / face-to-face sessions.</p>
          </article>
          <article>
            <h3>Simulator-based instruction</h3>
            <p>Practical training on quality-standard maritime equipment.</p>
          </article>
          <article>
            <h3>Assessment area</h3>
            <p>Dedicated space for competency assessment and certification.</p>
          </article>
        </div>
      </div>

      <div className="about-block about-visit">
        <div className="section-heading left">
          <span className="eyebrow">Visit us</span>
          <h2>Come see New Wave Maritime.</h2>
        </div>
        <p className="location-address">{CONTACT.address}</p>
        <div className="location-contacts">
          <span>Mobile <strong>{CONTACT.mobile}</strong></span>
          <span>Tel <strong>{CONTACT.telephone}</strong></span>
          <span>Email <strong>{CONTACT.email}</strong></span>
        </div>
        <SocialLinks />
      </div>
    </section>
  );
}

function Courses() {
  return (
    <section className="inside-page">
      <div className="inside-hero compact">
        <span className="eyebrow" id="schedules">New Wave course catalog</span>
        <h1>Find the training that fits your next step.</h1>
        <p>
          Browse all STCW and In-House courses in one list, filter by category, and see the available dates open for
          enrollment right now. Course fees are confirmed during enrollment.
        </p>
      </div>
      <PublicCourseCatalog />
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
        <span className="eyebrow">New Wave Maritime</span>
        <h1 className="caps-heading">Enrollment Status &amp; Certificate Verification</h1>
        <p>
          Track every course under one registration reference, or confirm a certificate&apos;s authenticity by its number. No
          trainee account is required.
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
      <Header page={page} />
      {content}
      <Footer />
    </main>
  );
}
