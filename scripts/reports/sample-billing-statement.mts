// Sample Billing Statement with made-up trainees (no database).
import { readFileSync, writeFileSync } from "node:fs";
import { createBillingStatementPdf } from "../../lib/print/billing-statement";

const r = (enrolled: string, name: string, training: string, status: string, amount: number) => ({ enrolled, name, training, status, amount });
const rows = [r("August 25, 2026", "EVANGELIO, JOEY", "APC", "Completed", 60000), r("August 26, 2026", "NAPARATE, MELVIN", "APC", "Completed", 60000), r("September 12, 2026", "FABRIGAR, LEE MAYNARD", "APC", "Completed", 60000), r("September 14, 2026", "FABRIGAR, LEE MAYNARD", "HAZMAT-CFR", "Completed", 60000), r("September 15, 2026", "TRILLANA, JAYRICO", "MARPOL", "Completed", 150000), r("September 18, 2026", "ALE, DOMINIC", "HAZMAT-CFR", "Ongoing", 60000), r("September 20, 2026", "MALINGIN, DONNIE", "APC", "Scheduled", 60000)];
const bytes = await createBillingStatementPdf({ bsNumber: "000029", date: "September 20, 2026", billTo: "MARINE FORCE INTERNATIONAL INC.", kind: "Agency", coverage: "Aug 21 - Sep 20, 2026 (as per date enrolled)", rows, total: rows.reduce((t, x) => t + x.amount, 0) }, readFileSync("public/new-wave-emblem.png"));
writeFileSync(process.argv[2] ?? "design/sample-billing-statement.pdf", bytes);
console.log("written");
