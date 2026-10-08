import { PrintControls } from "../../admission-record/[id]/print-controls";

/** The acknowledgement receipt sheets (TAR layout): original and duplicate on one legal page. */

const peso = (c: number) => "₱" + (c / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ORG = "NEW WAVE MARITIME TRAINING AND ASSESSMENT CENTER, INC.";
const ADDRESS = "Room 103, Bel-Air Apartment, 1020 Roxas Boulevard, Ermita, Manila 1000 · +63 948 847 6530 · (02) 8553 0310 · newwavemaritime@gmail.com · facebook.com/newwavemtc";

/** Peso amount in words, e.g. "One thousand six hundred pesos only". */
export function inWords(centavos: number) {
  const ones = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
  const tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
  const under1000 = (n: number): string => [n >= 100 ? `${ones[Math.floor(n / 100)]} hundred` : "", n % 100 < 20 ? ones[n % 100] : `${tens[Math.floor((n % 100) / 10)]}${n % 10 ? `-${ones[n % 10]}` : ""}`].filter(Boolean).join(" ");
  const whole = Math.floor(centavos / 100), cents = centavos % 100;
  const parts: string[] = [];
  const millions = Math.floor(whole / 1_000_000), thousands = Math.floor((whole % 1_000_000) / 1000), rest = whole % 1000;
  if (millions) parts.push(`${under1000(millions)} million`);
  if (thousands) parts.push(`${under1000(thousands)} thousand`);
  if (rest || !parts.length) parts.push(under1000(rest) || "zero");
  const text = `${parts.join(" ")} pesos${cents ? ` and ${cents}/100` : ""} only`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export type ReceiptProps = {
  receiptNo: string; name: string; received: string; cashier: string; status: string;
  payment: { number: string; method: string; reference: string | null; amount: number; remarks: string | null };
  trainee: { appNo: string; srn: string | null; rank: string | null; mobile: string | null; company: string | null };
  appliedTo: { id: string; number: string; code: string; name: string; dates: string; applied: number }[];
  totalDue: number; totalPaid: number; balance: number;
};

export function ReceiptSheets({ receiptNo, name, received, cashier, status, payment, trainee: t, appliedTo, totalDue, totalPaid, balance }: ReceiptProps) {
  const content = <>
    <div className="tar-letter"><img src="/brand/new-wave-emblem.png" alt="" width={34} height={34} /><div><b>{ORG}</b><span>{ADDRESS}</span></div><i /></div>
    <div className="tar-title"><div><b>ACKNOWLEDGEMENT RECEIPT</b> <span>· payment received · {received}</span></div><div><span>RECEIPT NO. </span><strong>{receiptNo}</strong></div></div>
    <table className="tar-grid"><tbody>
      <tr><th>Received From</th><td><b>{name}</b></td><th>Enrollment no.</th><td className="mono accent">{t.appNo}</td><th>SRN</th><td><b>{t.srn ?? "—"}</b></td></tr>
      <tr><th>Rank</th><td><b>{t.rank ?? "—"}</b></td><th>Mobile</th><td><b>{t.mobile ?? "—"}</b></td><th>Company</th><td><b>{t.company || "—"}</b></td></tr>
    </tbody></table>
    <table className="tar-table"><thead><tr><th>Payment no.</th><th>Date Received</th><th>Mode of Payment</th><th>Reference no.</th><th className="r">Amount Received</th></tr></thead><tbody>
      <tr><td className="mono">{payment.number}</td><td className="nw">{received}</td><td><b>{payment.method}</b></td><td className="mono">{payment.reference || "—"}</td><td className="r b">{peso(payment.amount)}</td></tr>
      <tr><td colSpan={5}><span className="dim">Amount in words:</span> <b>{inWords(payment.amount)}</b>{payment.remarks ? <span className="dim"> · {payment.remarks}</span> : null}</td></tr>
    </tbody></table>
    <div className="tar-money">
      <div><div className="tar-h">APPLIED TO</div><table className="tar-table"><thead><tr><th>Course</th><th>Training Dates</th><th className="r">Applied</th></tr></thead><tbody>
        {appliedTo.map((r) => <tr key={r.id}><td><b>{r.name}</b> <span className="dim">({r.code} · {r.number})</span></td><td className="nw">{r.dates}</td><td className="r b">{peso(r.applied)}</td></tr>)}
        {!appliedTo.length && <tr><td colSpan={3} className="dim">Not applied to an enrollment.</td></tr>}
      </tbody></table></div>
      <div><div className="tar-pay-head"><div className="tar-h">ACCOUNT AFTER THIS PAYMENT</div><span className={`tar-stamp ${status === "FULLY PAID" ? "ok" : status === "VOID" ? "none" : "part"}`}>{status}</span></div>
        <table className="tar-table"><tbody>
          <tr><td>Total amount due</td><td className="r">{peso(totalDue)}</td></tr>
          <tr><td>Total received to date</td><td className="r">{peso(totalPaid)}</td></tr>
          <tr className="b"><td>Balance</td><td className={`r${balance > 0 ? " due" : ""}`}>{peso(balance)}</td></tr>
        </tbody></table>
        <div className="tar-sigs">{[["Cashier", cashier], ["Received by (trainee)", ""]].map(([label, n]) => <div key={label}><span>{n}</span><small>{label}</small></div>)}</div>
      </div>
    </div>
    <div className="tar-terms"><div className="tar-terms-head"><b>NOTE</b><span>This acknowledges payment received by New Wave Maritime Training and Assessment Center, Inc. Keep this receipt with your Training Admission Record. Full payment is required before the end of training.</span></div></div>
  </>;
  const copies = [["ORIGINAL COPY", "Trainee"], ["DUPLICATE COPY", "Office file"]];

  return <main className="tar-screen">
    <PrintControls arNumber={receiptNo} title="Acknowledgement Receipt" />
    <section className="tar-legal">
      {copies.map(([label, holder]) => <div className="tar-copy" key={label}><div className="tar-sheet"><span className="tar-copy-tag"><b>{label}</b> · {holder}</span>{content}</div></div>)}
    </section>
  </main>;
}
