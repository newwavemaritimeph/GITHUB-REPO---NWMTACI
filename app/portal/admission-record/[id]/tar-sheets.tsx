import type { ReactNode } from "react";
import { TERMS, TERMS_AMEND_NOTICE } from "@/lib/terms";
import { PrintControls } from "./print-controls";

/**
 * The Training Admission Record sheets (Design 01 · classic official): two
 * copies (original and duplicate) per legal page. Pure layout — the page loads
 * the data; the print-sample script renders the same component with sample data.
 */

const peso = (c: number) => "₱" + (c / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// The trainee's signature on the front of the TAR accepts these terms (owner, 5 Nov 2026).
const ACKNOWLEDGEMENT = "By signing below, I hereby acknowledge that I have read, understood, and agreed to comply with the Terms and Conditions of New Wave MTACI, including the policies, guidelines, and instructions discussed during the course orientation.";
const ORG = "NEW WAVE MARITIME TRAINING AND ASSESSMENT CENTER, INC.";
const STREET = "Room 103, Bel-Air Apartment, 1020 Roxas Boulevard, Ermita, Manila 1000";
const CONTACTS = "+63 948 847 6530 · (02) 8553 0310 · newwavemaritime@gmail.com · facebook.com/newwavemtc";
const ADDRESS = `${STREET} · ${CONTACTS}`;
const PRINT_HINT = "Print on legal paper (8.5 × 14 in), portrait, on both sides, flip on long edge, at 100% scale with no margins. Cut along the dashed line: original for the trainee, duplicate for the file.";
export const COURSES_ON_FRONT = 6;

export type TarCourse = { id: string; code: string; name: string; dates: string; time: string; room: string; fee: number };
export type TarPayment = { id: string; number: string; dateLabel: string; method: string; ref: string; label?: string; amount: number };
export type TarProps = {
  arNumber: string; issued: string; name: string; reprintCopy?: number | null;
  trainee: { appNo: string; srn: string | null; rank: string | null; mobile: string | null; company: string | null };
  courses: TarCourse[]; misc: { label: string; amount: number }[]; discounts: { label: string; amount: number }[]; payments: TarPayment[];
  feesTotal: number; due: number; paid: number; balance: number; status: string; billedTo?: string | null; officer: string; cashier: string;
  /** Logo URL; the portal serves it from /brand, the sample script passes a file URL. */
  logoSrc?: string;
};

export function TarSheets(p: TarProps) {
  const front = p.courses.slice(0, COURSES_ON_FRONT), more = p.courses.slice(COURSES_ON_FRONT);
  const pages = more.length ? 2 : 1;
  const courseRows = (list: TarCourse[], offset: number) => list.map((c, i) => <tr key={c.id}><td className="c">{offset + i + 1}</td><td><b>{c.name}</b> <span className="dim">({c.code})</span></td><td className="nw">{c.dates}</td><td className="nw">{c.time}</td><td className="nw">{c.room}</td><td className="r nw">{peso(c.fee)}</td></tr>);
  const header = (page: number) => <>
    <div className="tar-letter"><img src={p.logoSrc ?? "/brand/new-wave-emblem.png"} alt="" width={34} height={34} /><div><b>{ORG}</b><span>{ADDRESS}</span></div><i /></div>
    <div className="tar-title"><div><b>TRAINING ADMISSION RECORD</b> <span>· admission slip · issued {p.issued}{pages > 1 ? ` · page ${page} of ${pages}` : ""}</span></div><div>{p.reprintCopy ? <span className="tar-reprint">REPRINT – COPY {p.reprintCopy}</span> : null}<span>{p.arNumber.startsWith("TAR-") ? "TAR NO. " : "AR NO. "}</span><strong>{p.arNumber}</strong></div></div>
  </>;
  // Page 1 (and page 2 when there are more than six courses). Each page is
  // printed twice on one legal sheet: an original for the trainee and a
  // duplicate for the file.
  const page1 = <>
      {header(1)}
      <table className="tar-grid"><tbody>
        <tr><th>Name</th><td><b>{p.name}</b></td><th>Enrollment no.</th><td className="mono accent">{p.trainee.appNo}</td><th>SRN</th><td><b>{p.trainee.srn ?? "—"}</b></td></tr>
        <tr><th>Rank</th><td><b>{p.trainee.rank ?? "—"}</b></td><th>Mobile</th><td><b>{p.trainee.mobile ?? "—"}</b></td><th>Company</th><td><b>{p.trainee.company || "—"}</b></td></tr>
      </tbody></table>
      <table className="tar-table"><thead><tr><th className="c">#</th><th>Course</th><th>Training Dates</th><th>Time</th><th>Room</th><th className="r">Fee</th></tr></thead><tbody>{courseRows(front, 0)}{more.length > 0 && <tr><td colSpan={6} className="dim">+ {more.length} more course{more.length === 1 ? "" : "s"} on page 2</td></tr>}</tbody></table>
      <div className="tar-money">
        <div><div className="tar-h">FEES</div><table className="tar-table"><tbody>
          <tr><td>Training fees ({p.courses.length} course{p.courses.length === 1 ? "" : "s"})</td><td className="r">{peso(p.feesTotal)}</td></tr>
          {p.misc.map((m, i) => <tr key={`m${i}`}><td>Miscellaneous · {m.label}</td><td className="r">{peso(m.amount)}</td></tr>)}
          {p.discounts.length ? p.discounts.map((d, i) => <tr key={`d${i}`}><td>Less · {d.label}</td><td className="r">−{peso(d.amount)}</td></tr>) : <tr><td>Discounts</td><td className="r">{peso(0)}</td></tr>}
          <tr className="b"><td>Total amount due</td><td className="r">{peso(p.due)}</td></tr>
          <tr className="b"><td>Total received</td><td className="r">{peso(p.paid)}</td></tr>
          <tr className="b"><td>Balance{p.billedTo && p.balance > 0 ? ` · billed to ${p.billedTo}` : ""}</td><td className={`r${p.balance > 0 ? " due" : ""}`}>{peso(p.balance)}</td></tr>
        </tbody></table></div>
        <div><div className="tar-pay-head"><div className="tar-h">RECEIPTS ISSUED ({p.payments.length})</div>{p.billedTo && <span className="tar-billed">Billed to {p.billedTo}</span>}<span className={`tar-stamp ${p.billedTo ? "cc" : p.status === "FULLY PAID" ? "ok" : p.status === "UNPAID" ? "none" : "part"}`}>{p.status}</span></div>
          <table className="tar-table"><thead><tr><th>Receipt No.</th><th>Date</th><th>For</th><th className="r">Amount</th></tr></thead><tbody>
            {p.payments.map((x) => <tr key={x.id}><td className="mono">{x.number}</td><td className="nw">{x.dateLabel}</td><td>{x.label ?? "Training Fee"}</td><td className="r b">{peso(x.amount)}</td></tr>)}
            {!p.payments.length && <tr><td colSpan={4} className="dim">{p.billedTo ? `Billed to ${p.billedTo} on the Billing Statement.` : "No receipt issued yet."}</td></tr>}
          </tbody></table>
          <div className="tar-ack">{ACKNOWLEDGEMENT}</div>
          <div className="tar-sigs">{[["Registration officer", p.officer], ["Trainee", ""]].map(([label, n]) => <div key={label}><span>{n}</span><small>{label}</small></div>)}</div>
        </div>
      </div>
      <div className="tar-terms"><div className="tar-terms-head"><b>TERMS AND CONDITIONS AT THE BACK</b><span className="tar-terms-note">Present this record with a valid ID on the first training day; report by 7:30 AM. Miscellaneous fees are part of the total due. This record is your admission slip.</span></div></div>
  </>;
  const page2 = more.length > 0 ? <>
      {header(2)}
      <table className="tar-table"><thead><tr><th className="c">#</th><th>Course</th><th>Training Dates</th><th>Time</th><th>Room</th><th className="r">Fee</th></tr></thead><tbody>{courseRows(more, COURSES_ON_FRONT)}</tbody></table>
      <p className="dim tar-cont">Continuation of {p.arNumber} for {p.name}. Fees and payments are on page 1; the Terms and Conditions are at the back of page 1.</p>
  </> : null;
  const copies = [["ORIGINAL COPY", "Trainee"], ["DUPLICATE COPY", "Office File"]];
  const frontSheet = (content: ReactNode) => <section className="tar-legal">
    {copies.map(([label, holder]) => <div className="tar-copy" key={label}>
      <div className="tar-sheet"><span className="tar-copy-tag"><b>{label}</b> · {holder}</span>{content}</div>
    </div>)}
  </section>;
  // The back of page 1, so it prints right after it: two copies, one behind each cut front when flipped on the long edge.
  const backSheet = <section className="tar-legal">
    {copies.map(([label, holder]) => <div className="tar-copy" key={label}>
      <div className="tar-back"><span className="tar-back-tag"><b>{label}</b> · {holder}</span>
        <div className="tar-back-letter"><img src={p.logoSrc ?? "/brand/new-wave-emblem.png"} alt="" width={50} height={50} /><div><b>{ORG}</b><i>Ride the New Wave of Maritime Excellence</i><span>{STREET}</span><span>{CONTACTS}</span></div></div>
        <div className="tar-back-title"><b>TERMS AND CONDITIONS</b><span>Please read carefully.</span></div>
        <div className="tar-back-cols">{[TERMS.slice(0, 3), TERMS.slice(3)].map((column) => <div key={column[0].n}>{column.map((s) => <div className="tar-back-sec" key={s.n}><h4><i>{s.n}</i>{s.title}</h4><ul>{s.lines.map((line, i) => <li key={i}>{line}</li>)}</ul></div>)}</div>)}</div>
        <div className="tar-back-foot"><em>{TERMS_AMEND_NOTICE}</em><small>Revision No. 03<br />Revision Date: 11/05/2026<br />Issued Date: 11/05/2026</small></div>
      </div>
    </div>)}
  </section>;
  return <main className="tar-screen">
    <PrintControls arNumber={p.arNumber} hint={PRINT_HINT} />
    {frontSheet(page1)}
    {backSheet}
    {page2 && frontSheet(page2)}
  </main>;
}
