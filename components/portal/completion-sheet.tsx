import { durationText, formDate, practicalOk, remarkOf, resultOf, SHEET_LINES, type AssessmentTask, type CompletionFields, type CompletionTrainee, type TraineeResult } from "@/lib/completion-record";

/**
 * The Training Completion and Record of Assessment Report (AD NO. 05-00), drawn
 * cell for cell like New Wave's form: A4 landscape, 24 numbered lines,
 * "Nothing follows" after the last trainee, signatures and grading legend.
 * Pure markup, shared by the print page and the on-screen preview.
 */
export function CompletionSheet({ courseName, startsOn, endsOn, tasks, trainees, results, fields }: {
  courseName: string; startsOn: string; endsOn: string; tasks: AssessmentTask[]; trainees: CompletionTrainee[]; results: Record<string, TraineeResult>; fields: CompletionFields;
}) {
  const n = tasks.length, all = 11 + n;
  const lines = Array.from({ length: Math.max(SHEET_LINES, trainees.length + 1) }, (_, i) => i);
  return <div className="tcr-sheet">
    <div className="tcr-top">
      <div className="tcr-doc">AD NO.: 05-00<br />Initial Issue Date: 09-14-2023<br />Revision Date: 00</div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="tcr-logo" src="/new-wave-emblem.png" alt="New Wave" />
      <h3>TRAINING COMPLETION AND RECORD OF ASSESSMENT REPORT</h3>
    </div>
    <table className="tcr">
      <colgroup><col style={{ width: 22 }} /><col style={{ width: 178 }} /><col style={{ width: 62 }} /><col style={{ width: 92 }} /><col style={{ width: 96 }} /><col style={{ width: 26 }} /><col style={{ width: 22 }} />{tasks.map((_, i) => <col key={i} />)}<col style={{ width: 24 }} /><col style={{ width: 22 }} /><col style={{ width: 26 }} /><col style={{ width: 150 }} /></colgroup>
      <tbody>
        <tr><td colSpan={all} className="org">New Wave Maritime Training and Assessment Center, Inc.</td></tr>
        <tr className="h1">
          <td colSpan={2} className="course">Training Course: {courseName}</td>
          <td colSpan={3} className="c b">Personal Data</td>
          <td colSpan={2} rowSpan={2}><div className="v vi">Written Assessment Result (refer to *Grading Scheme)</div></td>
          {tasks.map((t, i) => <td key={i} className="task">{t.title}</td>)}
          <td rowSpan={3}><div className="v vi">Practical Assessment Result (Refer **Grading Scheme)</div></td>
          <td colSpan={2} rowSpan={2}><div className="v vi">Result of the Assessment</div></td>
          <td rowSpan={3} className="c b">Training Certificate Number</td>
        </tr>
        <tr className="h2">
          <td colSpan={2} className="cls">Class No.: {fields.classNo}<br />Training Duration: {durationText(startsOn, endsOn)}<br />Class No.: <span className="sm">(For re-sit)</span> {fields.resitClassNo} &nbsp; Training Duration: {fields.resitDuration}</td>
          <td rowSpan={2}><div className="v">Date of Birth<br />(mm/dd/yyyy)</div></td>
          <td rowSpan={2}><div className="v">Place of Birth</div></td>
          <td rowSpan={2}><div className="v">Rank</div></td>
          {tasks.map((t, i) => <td key={i} rowSpan={2}><div className="v crit">{t.criteria}</div></td>)}
        </tr>
        <tr className="h3">
          <td colSpan={2} className="cls"><div className="dp"><span>Date and Place<br />of Assessment</span><span>Written: {fields.writtenPlace}<br />Practical: {fields.practicalPlace}</span></div><div className="nt">Name of Trainee <span className="xs">(Last Name, First Name, Middle Name)</span>:</div></td>
          <td><div className="v">Percentage</div></td><td><div className="v">Remarks</div></td>
          <td><div className="v vi">Competent<br />[C]</div></td><td><div className="v vi">Not yet<br />competent<br />[NYC]</div></td>
        </tr>
        {lines.map((i) => {
          const t = trainees[i];
          if (!t) return <tr key={i} className="ln"><td className="no">{i + 1} .</td><td className="nm">{i === trainees.length && trainees.length > 0 ? <span className="nf">***Nothing follows***</span> : null}</td><td /><td /><td /><td /><td />{tasks.map((_, j) => <td key={j} />)}<td /><td /><td /><td /></tr>;
          const r = results[t.enrollmentId] ?? { pct: null, ticks: [], cert: "" };
          const res = resultOf(r, n);
          return <tr key={i} className="ln">
            <td className="no">{i + 1} .</td><td className="nm">{t.name}</td><td className="c">{formDate(t.birthdate)}</td><td className="c sm">{t.placeOfBirth ?? ""}</td><td className="c sm">{t.rank || "N/A"}</td>
            <td className="c">{r.pct ?? ""}</td><td className="c">{remarkOf(r.pct)}</td>
            {tasks.map((_, j) => <td key={j} className="c">{r.ticks[j] === true ? "✓" : r.ticks[j] === false ? "X" : ""}</td>)}
            <td className="c">{res ? (practicalOk(r, n) ? "✓" : "X") : ""}</td><td className="c">{res === "C" ? "C" : ""}</td><td className="c">{res === "NYC" ? "NYC" : ""}</td><td className="c">{res === "C" ? r.cert : ""}</td>
          </tr>;
        })}
      </tbody>
    </table>
    <div className="tcr-foot">
      <div className="sg"><b className="cc">Certified Correct:</b><div className="sl"><b>{fields.assessor}</b></div><b>ASSESSOR</b>Signature over Printed Name<b>COA Validity: {fields.coaValidity}</b></div>
      <div className="sg dt"><div className="sl">{formDate(fields.assessedOn)}</div>Date</div>
      <div className="sg"><div className="sl"><b>{fields.director}</b></div><b>TRAINING DIRECTOR</b>Signature over Printed Name</div>
      <div className="sg dt"><div className="sl">{formDate(fields.directorOn)}</div>Date</div>
      <table className="legend"><tbody>
        <tr><td colSpan={2} className="i">*Grading Scheme for Written Assessment: Obtained at least 75% of correct answers out of the total test items (as reflected in the ASSESSMENT PLAN)</td></tr>
        <tr><td className="i b">PASS</td><td className="i b c">75% and Above</td></tr><tr><td className="i b">FAILED</td><td className="i b c">Below 75%</td></tr>
        <tr><td colSpan={2} className="i c">**Grading Scheme for Practical Assessment: Successfully meeting all the Assessment Criteria in all Assessment Tasks</td></tr>
        <tr><td className="b">Legend &nbsp; ✓</td><td className="b c">Performed</td></tr><tr><td className="b c">X</td><td className="b c">Not Performed</td></tr>
      </tbody></table>
    </div>
  </div>;
}
