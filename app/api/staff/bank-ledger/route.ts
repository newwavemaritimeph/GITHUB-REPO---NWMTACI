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
const entryFields = { accountId: z.string().uuid(), type: z.enum(ENTRY_TYPES), on: day, amountCentavos: money, direction: z.union([z.literal(1), z.literal(-1)]).default(1),
  toAccountId: z.string().uuid().optional(), chequeNo: z.string().trim().max(30).optional().default(""), payee: z.string().trim().max(120).optional().default(""), description: z.string().trim().max(300).optional().default(""), expenseId: z.string().uuid().nullable().optional() };
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("account-save"), id: z.string().uuid().nullable().optional(), bank: z.string().trim().min(2).max(60), accountName: z.string().trim().min(2).max(80), last4: z.string().trim().max(4).optional().default(""), channel: z.string().trim().min(2).max(60), openingCentavos: z.number().int().min(-100_000_000_000).max(100_000_000_000), openingOn: day, active: z.boolean().default(true) }),
  z.object({ action: z.literal("entry-add"), ...entryFields }),
  // Edit (owner, 13 Nov 2026): the entry is reversed (or its cheque voided) and the corrected entry added, with the reason.
  z.object({ action: z.literal("entry-edit"), id: z.string().uuid(), reason: z.string().trim().min(3).max(300), ...entryFields }),
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

  type Entry = { accountId: string; type: EntryType; on: string; amountCentavos: number; direction: 1 | -1; toAccountId?: string; chequeNo: string; payee: string; description: string; expenseId?: string | null };
  const entryProblem = (b: Entry) => {
    if (b.on > today()) return "The date cannot be in the future.";
    if (isChequeType(b.type) && !b.chequeNo) return "Enter the cheque number.";
    if (b.type === "Cheque Issued" && !b.payee) return "Enter who the cheque is for.";
    if (b.type === "Adjustment" && b.description.length < 3) return "An adjustment needs a reason.";
    if (b.type === "Transfer Out" && (!b.toAccountId || b.toAccountId === b.accountId)) return "Choose the other account.";
    return null;
  };
  const addEntry = async (b: Entry, note?: string) => {
    const cheque = isChequeType(b.type);
    const entryNo = await nextNo();
    const base = { entry_no: entryNo, entry_on: b.on, payee: b.payee || null, description: b.description || null, created_by: staff.user.id, ...(note ? { reason: note } : {}) };
    const pair = b.type === "Transfer Out" ? crypto.randomUUID() : null;
    const rows = [{
      ...base, account_id: b.accountId, entry_type: b.type, amount_centavos: signedAmount(b.type, b.amountCentavos, b.direction),
      cheque_no: cheque ? b.chequeNo : null, cheque_status: b.type === "Cheque Issued" ? "Issued" : b.type === "Encashment" ? "Encashed" : null,
      cleared_on: b.type === "Encashment" ? b.on : null, transfer_pair_id: pair, expense_id: b.type === "Cheque Issued" ? b.expenseId ?? null : null,
    }];
    if (pair) rows.push({ ...base, account_id: b.toAccountId!, entry_type: "Transfer In", amount_centavos: b.amountCentavos, cheque_no: null, cheque_status: null, cleared_on: null, transfer_pair_id: pair, expense_id: null });
    const { data, error } = await db.from("bank_entries").insert(rows).select("id");
    if (error) throw error;
    await audit("bank_entry.added", data?.[0]?.id ?? entryNo, null, rows, note);
    return entryNo;
  };

  if (body.action === "entry-add") {
    const problem = entryProblem(body as Entry);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    try { return NextResponse.json({ ok: true, entryNo: await addEntry(body as Entry) }); } catch (e) { return fail(e as { message: string }); }
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

  // A reversal is an opposite entry; a transfer reverses both sides; a cheque is voided instead.
  const reverseProblem = async () => {
    if (e.entry_type === "Reversal" || e.reversal_of) return "A reversal cannot be changed; add a new entry instead.";
    const { data: already } = await db.from("bank_entries").select("id").eq("reversal_of", e.id).limit(1);
    return already?.length ? `${e.entry_no} is already reversed.` : null;
  };
  const reverse = async (reason: string) => {
    const sides = e.transfer_pair_id ? (await db.from("bank_entries").select("id,account_id,amount_centavos").eq("transfer_pair_id", e.transfer_pair_id)).data ?? [] : [e];
    const entryNo = await nextNo();
    const rows = sides.map((x) => ({ entry_no: entryNo, account_id: x.account_id, entry_type: "Reversal", entry_on: today(), amount_centavos: -Number(x.amount_centavos), description: `Reverses ${e.entry_no}`, reversal_of: x.id, reason, created_by: staff.user.id }));
    const { error } = await db.from("bank_entries").insert(rows);
    if (error) throw error;
    await audit("bank_entry.reversed", e.id, null, rows, reason);
    return entryNo;
  };

  if (body.action === "entry-edit") {
    if (e.cheque_status && e.cheque_status !== "Issued") return NextResponse.json({ error: `Cheque ${e.cheque_no} is ${String(e.cheque_status).toLowerCase()}; it cannot be edited. Add an adjustment instead.` }, { status: 400 });
    const problem = (!e.cheque_status && await reverseProblem()) || entryProblem(body as Entry);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    const why = `Edited: ${body.reason}`;
    try {
      // The old line stays on record (reversed, or its cheque void); the corrected line is added.
      if (e.cheque_status === "Issued") {
        const { data: done, error } = await db.from("bank_entries").update({ cheque_status: "Void", reason: why }).eq("id", e.id).eq("cheque_status", "Issued").select("id").maybeSingle();
        if (error) return fail(error);
        if (!done) return NextResponse.json({ error: "Someone else just changed this cheque. Refresh and try again." }, { status: 409 });
      } else await reverse(why);
      const entryNo = await addEntry(body as Entry, `Corrects ${e.entry_no}: ${body.reason}`);
      await audit("bank_entry.edited", e.id, { entry_no: e.entry_no }, { corrected_by: entryNo }, body.reason);
      return NextResponse.json({ ok: true, entryNo });
    } catch (x) { return fail(x as { message: string }); }
  }

  if (e.cheque_status) return NextResponse.json({ error: "A cheque is not reversed; void it while it is outstanding." }, { status: 400 });
  const problem = await reverseProblem();
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });
  try { return NextResponse.json({ ok: true, entryNo: await reverse(body.reason) }); } catch (x) { return fail(x as { message: string }); }
}
