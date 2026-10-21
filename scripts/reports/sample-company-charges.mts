// Sample Company Charge List (Statement of Account) with made-up trainees (no database).
import { readFileSync, writeFileSync } from "node:fs";
import { createCompanyStatementPdf } from "../../lib/print/company-charges";

const bytes = await createCompanyStatementPdf([
  { statementNo: "CCL-2026-10-001", company: "COSTA MARITIME", kind: "Consultancy", rule: "Deducted on Any Payment", periodLabel: "October 1 - 31, 2026", printedOn: "October 22, 2026", rows: [
    { name: "SANTOS, Mark", number: "NWMTACI-2026-0412", course: "UBT-PSSR", training: "Oct 22", fee: 130000, paid: 65000, rebate: 65000, rebateStatus: "Deducted" },
    { name: "REYES, Ana", number: "NWMTACI-2026-0415", course: "PSCMT", training: "Oct 27 - 28", fee: 160000, paid: 80000, rebate: 80000, rebateStatus: "Deducted" },
    { name: "GARCIA, Leo", number: "NWMTACI-2026-0420", course: "CCI Package", training: "Oct 26 - 31", fee: 410000, paid: 200000, rebate: 0, rebateStatus: "None" },
    { name: "DELA CRUZ, Juan", number: "NWMTACI-2026-0424", course: "STPPDSPPS", training: "Oct 26", fee: 120000, paid: 0, rebate: 60000, rebateStatus: "Deducted" },
  ] },
], readFileSync("public/new-wave-emblem.png"));
writeFileSync(process.argv[2] ?? "design/sample-company-charge-list.pdf", bytes);
console.log("written");
