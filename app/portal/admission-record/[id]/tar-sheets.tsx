import { PrintControls } from "./print-controls";

/**
 * The Training Admission Record sheets (Design 01 · classic official): two
 * copies (original and duplicate) per legal page. Pure layout — the page loads
 * the data; the print-sample script renders the same component with sample data.
 */

const peso = (c: number) => "₱" + (c / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Short form of the terms the trainee accepted in full at registration.
const TERMS: [string, string][] = [
  ["1. Payment", "Full payment or at least 50% down payment on enrollment; settle in full before training ends. One-day courses are paid in full."],
  ["2. Cancellation", "Notify the Training Center before the training date. Deductions follow the Refund Policy."],
  ["3. Rescheduling", "One- to two-day courses may be rescheduled, subject to slots and approval. Charges follow the Refund Policy."],
  ["4. Refund", "Five or more days before training: Php 350.00 processing fee. Within five days: 50% of the course fee plus Php 250.00."],
  ["5. Make-up class", "For courses of three days or more, subject to schedule and approval. Php 350.00 per training day."],
  ["6. Certificate", "Issued only when all course requirements are completed and all balances are settled."],
  ["7. Miscellaneous", "Miscellaneous fees are part of the total due. This record is your admission slip and acknowledgement receipt. Terms may be updated without prior notice."],
];
const ORG = "NEW WAVE MARITIME TRAINING AND ASSESSMENT CENTER, INC.";
const ADDRESS = "Room 103, Bel-Air Apartment, 1020 Roxas Boulevard, Ermita, Manila 1000 · +63 948 847 6530 · (02) 8553 0310 · newwavemaritime@gmail.com · facebook.com/newwavemtc";
export const COURSES_ON_FRONT = 6;

export type TarCourse = { id: string; code: string; name: string; dates: string; time: string; room: string; fee: number };
export type TarPayment = { id: string; number: string; dateLabel: string; method: string; ref: string; amount: number };
export type TarProps = {
  arNumber: string; issued: string; name: string;
  trainee: { appNo: string; srn: string | null; rank: string | null; mobile: string | null; company: string | null };
  courses: TarCourse[]; misc: { label: string; amount: number }[]; discounts: { label: string; amount: number }[]; payments: TarPayment[];
  feesTotal: number; due: number; paid: number; balance: number; status: string; officer: string; cashier: string;
  /** Logo URL; the portal serves it from /brand, the sample script passes a file URL. */
  logoSrc?: string;
};

export function TarSheets(p: TarProps) {
  const front = p.courses.slice(0, COURSES_ON_FRONT), more = p.courses.slice(COURSES_ON_FRONT);
  const pages = more.length ? 2 : 1;
  const courseRows = (list: TarCourse[], offset: number) => list.map((c, i) => <tr key={c.id}><td className="c">{offset + i + 1}</td><td><b>{c.name}</b> <span className="dim">({c.code})</span></td><td className="nw">{c.dates}</td><td className="nw">{c.time}</td><td className="nw">{c.room}</td><td className="r nw">{peso(c.fee)}</td></tr>);
  const header = (page: number) => <>
    <div className="tar-letter"><img src={p.logoSrc ?? "/brand/new-wave-emblem.png"} alt="" width={34} height={34} /><div><b>{ORG}</b><span>{ADDRESS}</span></div><i /></div>
    <div className="tar-title"><div><b>TRAINING ADMISSION RECORD</b> <span>· admission slip and acknowledgement receipt · issued {p.issued}{pages > 1 ? ` · page ${page} of ${pages}` : ""}</span></div><div><span>AR NO. </span><strong>{p.arNumber}</strong></div></div>
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
          {p.misc.map((m, i) => <tr key={`m${i}`}><td>Misc · {m.label}</td><td className="r">{peso(m.amount)}</td></tr>)}
          {p.discounts.length ? p.discounts.map((d, i) => <tr key={`d${i}`}><td>Less · {d.label}</td><td className="r">−{peso(d.amount)}</td></tr>) : <tr><td>Discounts</td><td className="r">{peso(0)}</td></tr>}
          <tr className="b"><td>Total amount due</td><td className="r">{peso(p.due)}</td></tr>
          <tr className="b"><td>Total received</td><td className="r">{peso(p.paid)}</td></tr>
          <tr className="b"><td>Balance</td><td className={`r${p.balance > 0 ? " due" : ""}`}>{peso(p.balance)}</td></tr>
        </tbody></table></div>
        <div><div className="tar-pay-head"><div className="tar-h">PAYMENTS RECEIVED ({p.payments.length})</div><span className={`tar-stamp ${p.status === "FULLY PAID" ? "ok" : p.status === "UNPAID" ? "none" : "part"}`}>{p.status}</span></div>
          <table className="tar-table"><thead><tr><th>Payment</th><th>Date</th><th>Method</th><th>Reference</th><th className="r">Amount</th></tr></thead><tbody>
            {p.payments.map((x) => <tr key={x.id}><td className="mono">{x.number}</td><td className="nw">{x.dateLabel}</td><td>{x.method}</td><td className="mono">{x.ref}</td><td className="r b">{peso(x.amount)}</td></tr>)}
            {!p.payments.length && <tr><td colSpan={5} className="dim">No payment recorded yet.</td></tr>}
          </tbody></table>
          <div className="tar-sigs">{[["Registration officer", p.officer], ["Cashier", p.cashier], ["Trainee", ""]].map(([label, n]) => <div key={label}><span>{n}</span><small>{label}</small></div>)}</div>
        </div>
      </div>
      <div className="tar-terms"><div className="tar-terms-head"><b>TERMS AND CONDITIONS (SUMMARY)</b><span>Full terms accepted at registration. Present this record with a valid ID on the first training day; report by 7:30 AM.</span></div>
        <div className="tar-terms-cols">{TERMS.map(([h, body]) => <p key={h}><b>{h}</b> {body}</p>)}</div></div>
  </>;
  const page2 = more.length > 0 ? <>
      {header(2)}
      <table className="tar-table"><thead><tr><th className="c">#</th><th>Course</th><th>Training Dates</th><th>Time</th><th>Room</th><th className="r">Fee</th></tr></thead><tbody>{courseRows(more, COURSES_ON_FRONT)}</tbody></table>
      <p className="dim tar-cont">Continuation of {p.arNumber} for {p.name}. Fees, payments and terms are on page 1.</p>
  </> : null;
  const copies = [["ORIGINAL COPY", "Trainee"], ["DUPLICATE COPY", "Office file"]];
  return <main className="tar-screen">
    <PrintControls arNumber={p.arNumber} />
    {[page1, page2].filter(Boolean).map((content, i) => <section className="tar-legal" key={i}>
      {copies.map(([label, holder]) => <div className="tar-copy" key={label}>
        <div className="tar-sheet"><span className="tar-copy-tag"><b>{label}</b> · {holder}</span>{content}</div>
      </div>)}
    </section>)}
  </main>;
}
