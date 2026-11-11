import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadBankLedger } from "@/lib/bank-ledger-server";
import { ENTRY_TYPES, entryNumber, isChequeType, signedAmount, type EntryType } from "@/lib/bank-ledger";

export const runtime = "nodejs";

/**
 * Bank Ledger (owner, 11 Nov 2026). Accounting and the Admin only. GET: accounts, encoded entries and the portal
 * records that post by themselves. POST: account-save, entry-add, cheque-encash, cheque-void, entry-reverse.
 * Entries are never edited or deleted (a database trigger enforces it); every action is audited.
 */
const day = z.string().date();
const money = z.number().int().positive().max(100_000_000_000);
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("account-save"), id: z.string().uuid().nullable().optional(), bank: z.string().trim().min(2).max(60), accountName: z.string().trim().min(2).max(80), last4: z.string().trim().max(4).optional().default(""), channel: z.string().trim().min(2).max(60), openingCentavos: z.number().int().min(-100_000_000_000).max(100_000_000_000), openingOn: day, active: z.boolean().default(true) }),
  z.object({ action: z.literal("entry-add"), accountId: z.string().uuid(), type: z.enum(ENTRY_TYPES), on: day, amountCentavos: money, direction: z.union([z.literal(1), z.literal(-1)]).default(1),
    toAccountId: z.string().uuid().optional(), chequeNo: z.string().trim().max(30).optional().default(""), payee: z.string().trim().max(120).optional().default(""), description: z.string().trim().max(300).optional().default(""), expenseId: z.string().uuid().nullable().optional() }),
  z.object({ action: z.literal("cheque-encash"), id: z.string().uuid(), on: day }),
  z.object({ action: z.literal("cheque-void"), id: z.string().uuid(), reason: z.string().trim().min(3).max(300) }),
  z.object({ action: z.literal("entry-reverse"), id: z.string().uuid(), reason: z.string().trim().min(3).max(300) }),
]);
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());

export async function GET() {
  const staff = await requireStaff(["admin", "accounting"]);
  if (!staff) return NextResponse.json({ error: "Only Accounting or the Admin can see bank balances." }, { status: 403 });
  const data = await loadBankLedger(createSupabaseAdminClient());
  if (!data) return NextResponse.json({ error: "Apply database update 202611110098 first." }, { status: 400 });
  return NextResponse.json(data, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const staff = await requireStaff(["admin", "accounting"]);
  if (!staff) return NextResponse.json({ error: "Only Accounting or the Admin can encode bank movements." }, { status: 403 });
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the details." }, { status: 400 });
  const body = parsed.data, db = createSupabaseAdminClient();
  const role = staff.roleCodes.includes("admin") ? "admin" : "accounting";
  const audit = (action: string, id: string, prior: unknown, next: unknown, reason?: string) =>
    db.from("audit_logs").insert({ actor_id: staff.user.id, actor_role: role, action, record_type: "bank_entry", record_id: id, prior_values: prior ?? null, new_values: next ?? null, reason: reason || null });
  const fail = (e: { message: string }) => NextResponse.json({ error: /bank_(accounts|entries)/.test(e.message) && /exist|relation/.test(e.message) ? "Apply database update 202611110098 first." : /cheque_idx|cheque_no/.test(e.message) ? "This cheque number is already used for this account." : /channel/.test(e.message) && /unique|duplicate/.test(e.message) ? "Another bank account already receives this channel." : e.message }, { status: 400 });
  const nextNo = async () => { const { data, error } = await db.rpc("next_reference", { prefix: "BNK" }); if (error) throw error; return entryNumber(String(data)); };

  if (body.action === "account-save") {
    const row = { bank: body.bank, account_name: body.accountName, last4: body.last4 || null, channel: body.channel, opening_balance_centavos: body.openingCentavos, opening_on: body.openingOn, active: body.active };
    if (body.id) {
      const { data: prior } = await db.from("bank_accounts").select("*").eq("id", body.id).maybeSingle();
      const { error } = await db.from("bank_accounts").update(row).eq("id", body.id);
      if (error) return fail(error);
      await audit("bank_account.saved", body.id, prior, row);
      return NextResponse.json({ ok: true });
    }
    const { data, error } = await db.from("bank_accounts").insert({ ...row, created_by: staff.user.id }).select("id").single();
    if (error) return fail(error);
    await audit("bank_account.added", data.id, null, row);
    return NextResponse.json({ ok: true });
  }

  if (body.action === "entry-add") {
    if (body.on > today()) return NextResponse.json({ error: "The date cannot be in the future." }, { status: 400 });
    const cheque = isChequeType(body.type);
    if (cheque && !body.chequeNo) return NextResponse.json({ error: "Enter the cheque number." }, { status: 400 });
    if (body.type === "Cheque Issued" && !body.payee) return NextResponse.json({ error: "Enter who the cheque is for." }, { status: 400 });
    if (body.type === "Adjustment" && body.description.length < 3) return NextResponse.json({ error: "An adjustment needs a reason." }, { status: 400 });
    if (body.type === "Transfer Out" && (!body.toAccountId || body.toAccountId === body.accountId)) return NextResponse.json({ error: "Choose the other account." }, { status: 400 });
    let entryNo: string;
    try { entryNo = await nextNo(); } catch (e) { return fail(e as { message: string }); }
    const base = { entry_no: entryNo, entry_on: body.on, payee: body.payee || null, description: body.description || null, created_by: staff.user.id };
    const pair = body.type === "Transfer Out" ? crypto.randomUUID() : null;
    const rows = [{
      ...base, account_id: body.accountId, entry_type: body.type as EntryType, amount_centavos: signedAmount(body.type, body.amountCentavos, body.direction),
      cheque_no: cheque ? body.chequeNo : null, cheque_status: body.type === "Cheque Issued" ? "Issued" : body.type === "Encashment" ? "Encashed" : null,
      cleared_on: body.type === "Encashment" ? body.on : null, transfer_pair_id: pair, expense_id: body.type === "Cheque Issued" ? body.expenseId ?? null : null,
    }];
    if (pair) rows.push({ ...base, account_id: body.toAccountId!, entry_type: "Transfer In", amount_centavos: body.amountCentavos, cheque_no: null, cheque_status: null, cleared_on: null, transfer_pair_id: pair, expense_id: null });
    const { data, error } = await db.from("bank_entries").insert(rows).select("id");
    if (error) return fail(error);
    await audit("bank_entry.added", data?.[0]?.id ?? entryNo, null, rows);
    return NextResponse.json({ ok: true, entryNo });
  }

  const { data: e } = await db.from("bank_entries").select("id,entry_no,account_id,entry_type,amount_centavos,cheque_no,cheque_status,reversal_of,transfer_pair_id").eq("id", body.id).maybeSingle();
  if (!e) return NextResponse.json({ error: "Entry not found." }, { status: 404 });

  if (body.action === "cheque-encash" || body.action === "cheque-void") {
    if (e.cheque_status !== "Issued") return NextResponse.json({ error: `Cheque ${e.cheque_no} is ${String(e.cheque_status ?? "not a cheque").toLowerCase()}; only an outstanding cheque can change.` }, { status: 400 });
    if (body.action === "cheque-encash" && body.on > today()) return NextResponse.json({ error: "The encashment date cannot be in the future." }, { status: 400 });
    const patch = body.action === "cheque-encash" ? { cheque_status: "Encashed", cleared_on: body.on } : { cheque_status: "Void", reason: body.reason };
    const { data: done, error } = await db.from("bank_entries").update(patch).eq("id", e.id).eq("cheque_status", "Issued").select("id").maybeSingle();
    if (error) return fail(error);
    if (!done) return NextResponse.json({ error: "Someone else just changed this cheque. Refresh and try again." }, { status: 409 });
    await audit(body.action === "cheque-encash" ? "bank_entry.cheque_encashed" : "bank_entry.cheque_voided", e.id, { cheque_status: "Issued" }, patch, body.action === "cheque-void" ? body.reason : undefined);
    return NextResponse.json({ ok: true });
  }

  // entry-reverse: an opposite entry; a transfer reverses both sides; a cheque is voided instead.
  if (e.cheque_status) return NextResponse.json({ error: "A cheque is not reversed; void it while it is outstanding." }, { status: 400 });
  if (e.entry_type === "Reversal" || e.reversal_of) return NextResponse.json({ error: "A reversal cannot be reversed; add a new entry instead." }, { status: 400 });
  const { data: already } = await db.from("bank_entries").select("id").eq("reversal_of", e.id).limit(1);
  if (already?.length) return NextResponse.json({ error: `${e.entry_no} is already reversed.` }, { status: 400 });
  const sides = e.transfer_pair_id ? (await db.from("bank_entries").select("id,account_id,amount_centavos").eq("transfer_pair_id", e.transfer_pair_id)).data ?? [] : [e];
  let entryNo: string;
  try { entryNo = await nextNo(); } catch (x) { return fail(x as { message: string }); }
  const rows = sides.map((s) => ({ entry_no: entryNo, account_id: s.account_id, entry_type: "Reversal", entry_on: today(), amount_centavos: -Number(s.amount_centavos), description: `Reverses ${e.entry_no}`, reversal_of: s.id, reason: body.reason, created_by: staff.user.id }));
  const { error } = await db.from("bank_entries").insert(rows);
  if (error) return fail(error);
  await audit("bank_entry.reversed", e.id, null, rows, body.reason);
  return NextResponse.json({ ok: true, entryNo });
}
