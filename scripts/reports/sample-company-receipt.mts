// Sample company Acknowledgement Receipt on the Billing Statement template (made-up trainees, no database).
import { readFileSync, writeFileSync } from "node:fs";
import { createBillingStatementPdf } from "../../lib/print/billing-statement";

const r = (enrolled: string, name: string, training: string, amount: number) => ({ enrolled, name, training, status: "Paid", amount });
const rows = [r("October 6, 2026", "SANTOS, RAMON P.", "PSCMT", 110000), r("October 9, 2026", "VILLAR, NOEL S.", "STPPDSPPS", 110000), r("October 14, 2026", "TAN, MARK L.", "UBT-PSSR", 80000)];
const total = rows.reduce((s, x) => s + x.amount, 0);
const bytes = await createBillingStatementPdf({ bsNumber: "000031", date: "November 5, 2026", billTo: "MARINE FORCE INTERNATIONAL INC.", kind: "Consultancy", coverage: "Oct 1 - Oct 31, 2026 (as per date enrolled)", rows, total },
  new Uint8Array(readFileSync("public/new-wave-emblem.png")), { method: "PSBank", reference: "PS20261105-0042", receivedOn: "November 5, 2026", amount: total, words: "Three thousand pesos only", cashier: "K. Mallari" });
writeFileSync(process.argv[2] ?? "design/sample-company-receipt.pdf", bytes);
console.log("written");
