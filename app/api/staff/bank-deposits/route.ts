import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { fileInDrive } from "@/lib/google-drive";
import { CHEQUES, depositNumber, depositedOn, drawerExpected, nextStatus, type BankDeposit, type DepositAction, type DepositStatus } from "@/lib/bank-deposits";

export const runtime = "nodejs";

/**
 * Bank Deposits (owner, 11 Nov 2026). Accounting or the Admin request and cancel, confirm or return; the Cashier
 * marks a deposit made (bank reference and deposit slip, filed to Google Drive). Never an expense. Every step is audited.
 * JSON: { action: "request" | "cancel" | "confirm" | "return", … }. Multipart: action=mark, id, reference, depositedOn, slip.
 */
const day = z.string().date();
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("request"), amountCentavos: z.number().int().positive().max(100_000_000_00), account: z.string().trim().min(2).max(80), source: z.string().trim().min(2).max(80).default("Cash"), chequeNo: z.string().trim().max(40).optional().default(""), dueOn: day.optional().nullable(), note: z.string().trim().max(300).optional().default("") }),
  z.object({ action: z.literal("cancel"), id: z.string().uuid(), reason: z.string().trim().min(3).max(300) }),
  z.object({ action: z.literal("confirm"), id: z.string().uuid() }),
  z.object({ action: z.literal("return"), id: z.string().uuid(), reason: z.string().trim().min(3).max(300) }),
]);
const SLIP_TYPES: [string, string, (b: Uint8Array) => boolean][] = [
  ["application/pdf", "pdf", (b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46],
  ["image/jpeg", "jpg", (b) => b[0] === 0xff && b[1] === 0xd8],
  ["image/png", "png", (b) => b[0] === 0x89 && b[1] === 0x50],
];
const manilaDay = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
type Db = ReturnType<typeof createSupabaseAdminClient>;

/** Cash expected in the drawer today, before this deposit: opening + cash in − cash expenses − deposits already made. */
async function drawerToday(db: Db, date: string) {
  const start = `${date}T00:00:00+08:00`, end = `${date}T23:59:59.999+08:00`;
  const [open, pays, income, exps, deps] = await Promise.all([
    db.from("cashier_openings").select("opening_cash_centavos").eq("opening_date", date),
    db.from("payments").select("amount_centavos").eq("valid", true).eq("method", "Cash").gte("received_at", start).lte("received_at", end),
    db.from("other_income").select("amount_centavos,channel").is("voided_at", null).eq("received_on", date),
    db.from("expenses").select("amount_centavos,payment_channel").eq("status", "Paid").gte("paid_at", start).lte("paid_at", end),
    db.from("bank_deposits").select("status,deposited_on,amount_centavos,source").eq("deposited_on", date),
  ]);
  const sum = (rows: { amount_centavos: number }[] | null | undefined) => (rows ?? []).reduce((s, r) => s + Number(r.amount_centavos), 0);
  return drawerExpected({
    opening: sum(open.data?.map((o) => ({ amount_centavos: o.opening_cash_centavos as number }))),
    cashIn: sum(pays.data) + sum((income.data ?? []).filter((i) => i.channel === "Cash")),
    cashExpenses: sum((exps.data ?? []).filter((e) => (e.payment_channel ?? "Cash") === "Cash")),
    deposits: depositedOn((deps.data ?? []) as Pick<BankDeposit, "status" | "deposited_on" | "amount_centavos">[], date),
  });
}

export async function POST(request: Request) {
  const staff = await requireStaff(["admin", "accounting", "cashier"]);
  if (!staff) return NextResponse.json({ error: "Only the Cashier, Accounting or the Admin can work on bank deposits." }, { status: 403 });
  const db = createSupabaseAdminClient();
  const role = staff.roleCodes.includes("admin") ? "admin" : staff.roleCodes.includes("accounting") ? "accounting" : "cashier";
  const audit = (action: string, id: string, prior: unknown, next: unknown, reason?: string) =>
    db.from("audit_logs").insert({ actor_id: staff.user.id, actor_role: role, action, record_type: "bank_deposit", record_id: id, prior_values: prior ?? null, new_values: next ?? null, reason: reason || null });
  const fail = (e: { message: string }) => NextResponse.json({ error: /cheque_no|source/.test(e.message) ? "Apply database update 202611120100 first." : /bank_deposits/.test(e.message) ? "Apply database update 202611110097 first." : e.message }, { status: 400 });
  const load = async (id: string) => (await db.from("bank_deposits").select("id,deposit_no,amount_centavos,account,status,reference,source").eq("id", id).maybeSingle()).data as (Pick<BankDeposit, "id" | "deposit_no" | "amount_centavos" | "account" | "reference" | "source"> & { status: DepositStatus }) | null;
  const move = async (id: string, act: DepositAction, patch: Record<string, unknown>, reason?: string) => {
    const d = await load(id);
    if (!d) return NextResponse.json({ error: "Deposit not found." }, { status: 404 });
    const to = nextStatus(d.status, act);
    if (!to) return NextResponse.json({ error: `This deposit is ${d.status}; it cannot be ${act === "mark" ? "marked deposited" : act === "confirm" ? "confirmed" : act === "return" ? "returned" : "cancelled"} now.` }, { status: 400 });
    // The status guard makes a double click or two people at once harmless.
    const { data: done, error } = await db.from("bank_deposits").update({ ...patch, status: to }).eq("id", id).eq("status", d.status).select("id").maybeSingle();
    if (error) return fail(error);
    if (!done) return NextResponse.json({ error: "Someone else just changed this deposit. Refresh and try again." }, { status: 409 });
    await audit(`bank_deposit.${act}`, id, { status: d.status }, { status: to, ...patch }, reason);
    return NextResponse.json({ ok: true, depositNo: d.deposit_no });
  };

  // The Cashier marks a deposit made, with the slip.
  if ((request.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    if (!staff.roleCodes.some((r) => ["cashier", "admin"].includes(r))) return NextResponse.json({ error: "Only the Cashier marks a deposit made." }, { status: 403 });
    const form = await request.formData();
    const id = z.string().uuid().safeParse(form.get("id")), on = day.safeParse(form.get("depositedOn"));
    const reference = String(form.get("reference") ?? "").trim().slice(0, 60);
    if (!id.success) return NextResponse.json({ error: "Choose the deposit." }, { status: 400 });
    if (!on.success || on.data > manilaDay()) return NextResponse.json({ error: "Enter the deposit date (not a future date)." }, { status: 400 });
    if (reference.length < 3) return NextResponse.json({ error: "Enter the bank reference from the deposit slip." }, { status: 400 });
    const d = await load(id.data);
    if (!d) return NextResponse.json({ error: "Deposit not found." }, { status: 404 });
    // A first deposit leaves the drawer today; a corrected one (Returned) already did.
    if (d.status === "Requested" && on.data === manilaDay() && (d.source || "Cash") === "Cash") {
      const inDrawer = await drawerToday(db, on.data);
      if (d.amount_centavos > inDrawer) return NextResponse.json({ error: `This is more than the cash expected in the drawer (₱${(inDrawer / 100).toLocaleString("en-PH", { minimumFractionDigits: 2 })}).` }, { status: 400 });
    }
    let slipLink: string | null = null;
    const file = form.get("slip");
    if (file instanceof File && file.size) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const type = SLIP_TYPES.find(([, , ok]) => ok(bytes));
      if (!type || bytes.length > 10 * 1024 * 1024) return NextResponse.json({ error: "The slip must be a PDF, JPEG or PNG up to 10 MB." }, { status: 400 });
      try {
        const month = on.data.slice(0, 7);
        slipLink = (await fileInDrive(db, { rootKey: "deposits", rootName: "NWMTACI Bank Deposits", folders: [{ key: `deposits/${month}`, name: month }], base: `${on.data} ${d.deposit_no} ${d.account}`, ext: type[1], mime: type[0], bytes })).link;
      } catch (e) { console.error("Deposit slip Drive filing failed:", e instanceof Error ? e.message : e); }
    }
    return move(id.data, "mark", { deposited_by: staff.user.id, deposited_at: new Date().toISOString(), deposited_on: on.data, reference, ...(slipLink ? { slip_link: slipLink } : {}), reason: null });
  }

  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the details." }, { status: 400 });
  const body = parsed.data;
  if (!staff.roleCodes.some((r) => ["accounting", "admin"].includes(r))) return NextResponse.json({ error: "Only Accounting or the Admin can do this." }, { status: 403 });

  if (body.action === "request") {
    if (body.source === body.account) return NextResponse.json({ error: "From and To cannot be the same account." }, { status: 400 });
    if (body.source === CHEQUES && body.chequeNo.length < 3) return NextResponse.json({ error: "Enter the cheque number." }, { status: 400 });
    const { data: ref, error: refErr } = await db.rpc("next_reference", { prefix: "DEP" });
    if (refErr) return fail(refErr);
    const depositNo = depositNumber(String(ref));
    const row = { deposit_no: depositNo, amount_centavos: body.amountCentavos, account: body.account, source: body.source, cheque_no: body.source === CHEQUES ? body.chequeNo : null, due_on: body.dueOn ?? null, note: body.note || null, requested_by: staff.user.id };
    const { data, error } = await db.from("bank_deposits").insert(row).select("id").single();
    if (error) return fail(error);
    await audit("bank_deposit.request", data.id, null, row);
    return NextResponse.json({ ok: true, depositNo });
  }
  if (body.action === "cancel") return move(body.id, "cancel", { reason: body.reason }, body.reason);
  if (body.action === "return") return move(body.id, "return", { reason: body.reason }, body.reason);
  return move(body.id, "confirm", { confirmed_by: staff.user.id, confirmed_at: new Date().toISOString() });
}
