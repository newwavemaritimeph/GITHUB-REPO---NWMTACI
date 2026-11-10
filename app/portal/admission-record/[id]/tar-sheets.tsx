import type { ReactNode } from "react";
import { startControl, type DocumentControl } from "@/lib/document-controls";
import { TERMS, TERMS_AMEND_NOTICE } from "@/lib/terms";
import { ControlBlock } from "./control-block";
import { PrintControls } from "./print-controls";

/**
 * The Training Admission Record sheets (Design 01 · classic official): two
 * copies (original and duplicate) per legal page, printed on one side. Pure layout — the page loads
 * the data; the print-sample script renders the same component with sample data.
 */

// The trainee's signature on the TAR accepts the terms printed beside it (owner, 5 Nov 2026).
const ACKNOWLEDGEMENT = "By signing below, I hereby acknowledge that I have read, understood, and agreed to comply with the Terms and Conditions of New Wave MTACI, including the policies, guidelines, and instructions discussed during the course orientation.";
const ORG = "NEW WAVE MARITIME TRAINING AND ASSESSMENT CENTER, INC.";
const STREET = "Room 103, Bel-Air Apartment, 1020 Roxas Boulevard, Ermita, Manila 1000";
const CONTACTS = "+63 948 847 6530 · (02) 8553 0310 · newwavemaritime@gmail.com · facebook.com/newwavemtc";
const ADDRESS = `${STREET} · ${CONTACTS}`;
const PRINT_HINT = "Print on legal paper (8.5 × 14 in), portrait, one side only, at 100% scale with no margins. Cut along the dashed line: original for the trainee, duplicate for the file.";
export const COURSES_ON_FRONT = 6;

export type TarCourse = { id: string; code: string; name: string; dates: string; time: string; room: string };
// No fees, totals or receipts on the TAR (owner, 10 Nov 2026): those stay on the Acknowledgement Receipt.
export type TarProps = {
  arNumber: string; issued: string; name: string; reprintCopy?: number | null;
  trainee: { appNo: string; srn: string | null; rank: string | null; mobile: string | null; company: string | null };
  courses: TarCourse[]; officer: string;
  /** Form Numbers: the TAR and its Terms and Conditions. */
  control?: DocumentControl | null; termsControl?: DocumentControl | null;
  /** Logo URL; the portal serves it from /brand, the sample script passes a file URL. */
  logoSrc?: string;
};

export function TarSheets(p: TarProps) {
  const front = p.courses.slice(0, COURSES_ON_FRONT), more = p.courses.slice(COURSES_ON_FRONT);
  const pages = more.length ? 2 : 1;
  const courseRows = (list: TarCourse[], offset: number) => list.map((c, i) => <tr key={c.id}><td className="c">{offset + i + 1}</td><td><b>{c.name}</b> <span className="dim">({c.code})</span></td><td className="nw">{c.dates}<br /><span className="dim">{c.time} · {c.room}</span></td></tr>);
  const courseTable = (list: TarCourse[], offset: number, tail?: ReactNode) => <table className="tar-table"><thead><tr><th className="c">#</th><th>Course</th><th>Schedule</th></tr></thead><tbody>{courseRows(list, offset)}{tail}</tbody></table>;
  const header = (page: number) => <>
    <div className="tar-letter"><img src={p.logoSrc ?? "/brand/new-wave-emblem.png"} alt="" width={34} height={34} /><div><b>{ORG}</b><span>{ADDRESS}</span></div><ControlBlock control={p.control} /></div>
    <div className="tar-title"><div><b>TRAINING ADMISSION RECORD</b> <span>· admission slip · issued {p.issued}{pages > 1 ? ` · page ${page} of ${pages}` : ""}</span></div><div>{p.reprintCopy ? <span className="tar-reprint">REPRINT – COPY {p.reprintCopy}</span> : null}<span>{p.arNumber.startsWith("TAR-") ? "TAR NO. " : "AR NO. "}</span><strong>{p.arNumber}</strong></div></div>
  </>;
  const terms = p.termsControl ?? startControl("terms");
  const termsLines = [terms.formNo && `Form No. ${terms.formNo}`, terms.revisionNo && `Revision No. ${terms.revisionNo}`, terms.revisionDate && `Revision Date: ${terms.revisionDate}`, terms.issuedDate && `Issued Date: ${terms.issuedDate}`].filter(Boolean);
  // Design 1 · Side by Side (owner, 10 Nov 2026): Training Information on the left, the Terms in a column on the right.
  // Page 2 (more than six courses) carries only the extra courses. Each page prints twice on one legal sheet.
  const page1 = <>
      {header(1)}
      <div className="tar-body">
        <div className="tar-left">
          <table className="tar-grid"><tbody>
            <tr><th>Name</th><td colSpan={3}><b>{p.name}</b></td></tr>
            <tr><th>Enrollment No.</th><td className="mono accent">{p.trainee.appNo}</td><th>SRN</th><td>{p.trainee.srn ?? "—"}</td></tr>
            <tr><th>Rank</th><td>{p.trainee.rank ?? "—"}</td><th>Mobile</th><td>{p.trainee.mobile ?? "—"}</td></tr>
            <tr><th>Company</th><td colSpan={3}>{p.trainee.company || "—"}</td></tr>
          </tbody></table>
          <div className="tar-h">TRAINING INFORMATION</div>
          {courseTable(front, 0, more.length > 0 && <tr><td colSpan={3} className="dim">+ {more.length} more course{more.length === 1 ? "" : "s"} on page 2</td></tr>)}
          <p className="tar-note">Present this record with a valid ID on the first training day; report by 7:30 AM. This record is your admission slip.</p>
          <div className="tar-ack">{ACKNOWLEDGEMENT}</div>
          <div className="tar-sigs">{[["Registration Officer", p.officer], ["Trainee", ""]].map(([label, n]) => <div key={label}><span>{n}</span><small>{label}</small></div>)}</div>
        </div>
        <div className="tar-terms">
          <div className="tar-h">TERMS AND CONDITIONS</div>
          {TERMS.map((s) => <div className="tar-terms-sec" key={s.n}><h4>{s.n}. {s.title}</h4><ul>{s.lines.map((line, i) => <li key={i}>{line}</li>)}</ul></div>)}
          <em>{TERMS_AMEND_NOTICE}</em>
          {termsLines.length > 0 && <small>{termsLines.join(" · ")}</small>}
        </div>
      </div>
  </>;
  const page2 = more.length > 0 ? <>
      {header(2)}
      {courseTable(more, COURSES_ON_FRONT)}
      <p className="dim tar-cont">Continuation of {p.arNumber} for {p.name}. The Terms and Conditions are on page 1.</p>
  </> : null;
  const copies = [["ORIGINAL COPY", "Trainee"], ["DUPLICATE COPY", "Office File"]];
  const frontSheet = (content: ReactNode) => <section className="tar-legal">
    {copies.map(([label, holder]) => <div className="tar-copy" key={label}>
      <div className="tar-sheet"><span className="tar-copy-tag"><b>{label}</b> · {holder}</span>{content}</div>
    </div>)}
  </section>;
  return <main className="tar-screen">
    <PrintControls arNumber={p.arNumber} hint={PRINT_HINT} />
    {frontSheet(page1)}
    {page2 && frontSheet(page2)}
  </main>;
}
