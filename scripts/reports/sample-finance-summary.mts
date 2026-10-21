// Sample Cash and Sales Summary PDF with made-up October figures (no database).
import { writeFileSync } from "node:fs";
import { summarize, type SaleIn } from "../../lib/finance-summary";
import { createFinanceSummaryPdf } from "../../lib/print/finance-summary";

const pay = (amount: number, channel: string, endorsement = false) => ({ amount, channel, allocations: [{ amount, endorsement }] });
const payments = [pay(18240000, "Cash"), pay(9650000, "GCash"), pay(4120000, "PSBank"), pay(1800000, "UnionBank"), pay(435000, "Cash"), pay(120000, "GCash"), pay(3300000, "Cash", true), pay(2200000, "GCash", true), pay(1100000, "PSBank", true)];
const income = [{ amount: 330000, channel: "Cash", source: "Endorsement Rebate" }, { amount: 900000, channel: "PSBank", source: "Endorsement Rebate" }, { amount: 500000, channel: "Cash", source: "Rental" }, { amount: 1288, channel: "PSBank", source: "Interest" }];
const expenses = [{ amount: 5500000, channel: "PSBank", category: "Partnered Center Payment" }, { amount: 1100000, channel: "Cash", category: "Partnered Center Payment" }, { amount: 12000000, channel: "UnionBank", category: "Salary" }, { amount: 1845000, channel: "PSBank", category: "Utilities" }, { amount: 623000, channel: "Cash", category: "Office Supplies" }, { amount: 580000, channel: "GCash", category: "Repairs & Maintenance" }, { amount: 340000, channel: "Cash", category: "Transportation" }, { amount: 210000, channel: "Cash", category: "Representation" }];
const base = { center: "", payable: 0, rebate: 0, share: 0, charges: 0, discounts: 0, rebateReceived: 0 };
const sales: SaleIn[] = [];
for (const [code, name, n, price] of [["UBT-PSSR", "Updating Training on Basic Training - PSSR", 96, 130000], ["STPPDSPPS", "Safety (Passenger Spaces)", 40, 150000], ["PSCMT", "Crowd Management", 30, 180000], ["PSCMHBT", "Crisis Management and Human Behaviour", 28, 240000], ["ABC", "Awareness on Basic Computer", 8, 315000], ["ESEA", "Enclosed Space Entry Awareness", 12, 180000]] as const)
  for (let i = 0; i < n; i++) sales.push({ ...base, endorsement: false, code, name, price, collected: i % 12 === 0 ? 0 : price, charges: i % 40 === 0 ? 111000 : 0, discounts: i % 51 === 0 ? 105000 : 0 });
for (const [center, n, rebate, received, share] of [["Nautical Options", 7, 130000, 130000, 100000], ["Altitude Maritime", 3, 120000, 40000, 0], ["Mariana", 2, 100000, 100000, 50000]] as const)
  for (let i = 0; i < n; i++) sales.push({ ...base, endorsement: true, code: "BT", name: "Basic Training", center, price: 550000, payable: 550000, rebate, share, collected: 550000, rebateReceived: i === 0 || received === rebate ? received : 0 });
const s = summarize({ payments, income, expenses, sales });
const bytes = await createFinanceSummaryPdf({ ...s, title: "October 2026", from: "2026-10-01", to: "2026-10-31" }, "2026-10-21");
writeFileSync(process.argv[2] ?? "design/sample-cash-and-sales-summary.pdf", bytes);
console.log("written");
