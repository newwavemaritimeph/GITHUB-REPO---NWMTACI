import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { fileInDrive } from "@/lib/google-drive";
import { depositedOn } from "@/lib/bank-deposits";
import { BILLS, closingCheck, countedCentavos, isCash, isGcash, type DayFigures } from "@/lib/cashier-drawer";

export const runtime = "nodejs";

/**
 * Closing with Cash and GCash (owner, 11 Nov 2026). Multipart: openingCashCentavos, openingGcashCentavos (from today's
 * opening when recorded), counts (JSON of bill → number), actualGcashCentavos, remarks, screenshot (GCash balance).
 * The expected amounts are worked out here from the day's records; remarks are required when either side is over or short.
 */
type Db = ReturnType<typeof createSupabaseAdminClient>;
const manilaDay = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
const sum = (rows: { amount_centavos: number | string }[]) => rows.reduce((s, r) => s + Number(r.amount_centavos), 0);

async function dayFigures(db: Db, date: string, opening: { cash: number; gcash: number }): Promise<DayFigures & { online: number }> {
  const start = `${date}T00:00:00+08:00`, end = `${date}T23:59:59.999+08:00`;
  const [pays, inc, exps, deps] = await Promise.all([
    db.from("payments").select("amount_centavos,method").eq("valid", true).gte("received_at", start).lte("received_at", end),
    db.from("other_income").select("amount_centavos,channel").is("voided_at", null).eq("received_on", date),
    db.from("expenses").select("amount_centavos,payment_channel").eq("status", "Paid").gte("paid_at", start).lte("paid_at", end),
    db.from("bank_deposits").select("status,deposited_on,amount_centavos,source").eq("deposited_on", date),
  ]);
  const p = pays.data ?? [], i = inc.error ? [] : inc.data ?? [], x = exps.data ?? [];
  return {
    openingCash: opening.cash, openingGcash: opening.gcash,
    cashIn: sum(p.filter((r) => isCash(r.method))) + sum(i.filter((r) => isCash(r.channel))),
    gcashIn: sum(p.filter((r) => isGcash(r.method))) + sum(i.filter((r) => isGcash(r.channel))),
    cashExpenses: sum(x.filter((r) => isCash(r.payment_channel))),
    gcashExpenses: sum(x.filter((r) => isGcash(r.payment_channel))),
    deposits: deps.error ? 0 : depositedOn((deps.data ?? []) as Parameters<typeof depositedOn>[0], date),
    gcashDeposits: deps.error ? 0 : depositedOn((deps.data ?? []) as Parameters<typeof depositedOn>[0], date, "GCash"),
    online: sum(p.filter((r) => !isCash(r.method))),
  };
}

const money = z.coerce.number().int().min(0).max(100_000_000_000);
const cents = z.number().int().min(0).max(100_000_000_000);
// Accounting corrects a day (owner, 13 Nov 2026): the opening, the count and the remarks, with a reason; the expected amounts are worked out again.
const editInput = z.object({ action: z.literal("edit"), closingId: z.string().uuid().nullable().optional(), openingId: z.string().uuid().nullable().optional(),
  openingCashCentavos: cents.optional(), openingGcashCentavos: cents.optional(), countedCashCentavos: cents.optional(), countedGcashCentavos: cents.optional(),
  remarks: z.string().trim().max(500).optional(), reason: z.string().trim().min(5, "Give the reason for the edit (5 characters or more).").max(300) });

async function editDay(db: Db, actor: string, role: string, body: z.infer<typeof editInput>) {
  const { data: closing } = body.closingId ? await db.from("cashier_closings").select("*").eq("id", body.closingId).maybeSingle() : { data: null };
  if (body.closingId && !closing) return NextResponse.json({ error: "Closing not found." }, { status: 404 });
  const c = closing as Record<string, unknown> | null;
  const { data: opening } = body.openingId ? await db.from("cashier_openings").select("*").eq("id", body.openingId).maybeSingle()
    : c ? await db.from("cashier_openings").select("*").eq("cashier_id", c.cashier_id as string).eq("opening_date", c.closing_date as string).maybeSingle() : { data: null };
  const o = opening as Record<string, unknown> | null;
  if (!c && !o) return NextResponse.json({ error: "Choose the day to edit." }, { status: 400 });
  const stamp = { edited_at: new Date().toISOString(), edited_by: actor, edit_reason: body.reason };
  const cash = body.openingCashCentavos ?? Number(o?.opening_cash_centavos ?? c?.opening_cash_centavos ?? 0);
  const gcash = body.openingGcashCentavos ?? Number(o?.opening_gcash_centavos ?? c?.opening_gcash_centavos ?? 0);
  const prior: Record<string, unknown> = {}, next: Record<string, unknown> = {};
  if (o) {
    const patch = { opening_cash_centavos: cash, opening_gcash_centavos: gcash };
    const { error } = await db.from("cashier_openings").update({ ...patch, ...stamp }).eq("id", o.id as string);
    if (error) return NextResponse.json({ error: /edited_|edit_reason/.test(error.message) ? "Apply database update 202611130103 first." : error.message }, { status: 400 });
    prior.opening = { opening_cash_centavos: o.opening_cash_centavos, opening_gcash_centavos: o.opening_gcash_centavos }; next.opening = patch;
  }
  if (c) {
    const date = c.closing_date as string;
    const f = await dayFigures(db, date, { cash, gcash });
    const counted = body.countedCashCentavos ?? Number(c.actual_cash_centavos ?? 0), gIn = body.countedGcashCentavos ?? Number(c.actual_gcash_centavos ?? 0);
    const check = closingCheck(f, counted, gIn);
    const patch = {
      opening_cash_centavos: cash, cash_collections_centavos: f.cashIn, online_collections_centavos: f.online, expenses_centavos: f.cashExpenses,
      expected_cash_centavos: check.cash, actual_cash_centavos: counted, variance_centavos: check.cashVariance, remarks: body.remarks ?? (c.remarks as string | null) ?? null,
      cash_expenses_centavos: f.cashExpenses, bank_deposits_centavos: f.deposits, opening_gcash_centavos: gcash, gcash_collections_centavos: f.gcashIn, gcash_expenses_centavos: f.gcashExpenses,
      expected_gcash_centavos: check.gcash, actual_gcash_centavos: gIn, gcash_variance_centavos: check.gcashVariance,
    };
    const { error } = await db.from("cashier_closings").update({ ...patch, ...stamp }).eq("id", c.id as string);
    if (error) return NextResponse.json({ error: /edited_|edit_reason/.test(error.message) ? "Apply database update 202611130103 first." : error.message }, { status: 400 });
    prior.closing = Object.fromEntries(Object.keys(patch).map((k) => [k, c[k] ?? null])); next.closing = patch;
  }
  await db.from("audit_logs").insert({ actor_id: actor, actor_role: role, action: "cashier_close.edited", record_type: c ? "cashier_closing" : "cashier_opening", record_id: (c?.id ?? o?.id) as string, prior_values: prior, new_values: next, reason: body.reason });
  return NextResponse.json({ ok: true });
}

export async function POST(request: Request) {
  const staff = await requireStaff(["admin", "cashier", "accounting"]);
  if (!staff) return NextResponse.json({ error: "Your account cannot submit a cashier closing." }, { status: 403 });
  if ((request.headers.get("content-type") ?? "").includes("application/json")) {
    if (!staff.roleCodes.some((r) => ["accounting", "admin"].includes(r))) return NextResponse.json({ error: "Only Accounting or the Admin can edit an opening or closing." }, { status: 403 });
    const parsed = editInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the details." }, { status: 400 });
    return editDay(createSupabaseAdminClient(), staff.user.id, staff.roleCodes.includes("accounting") ? "accounting" : "admin", parsed.data);
  }
  const form = await request.formData();
  const date = manilaDay();
  const parsed = z.object({ openingCashCentavos: money, openingGcashCentavos: money, actualGcashCentavos: money, remarks: z.string().trim().max(500).default("") })
    .safeParse({ openingCashCentavos: form.get("openingCashCentavos"), openingGcashCentavos: form.get("openingGcashCentavos") ?? 0, actualGcashCentavos: form.get("actualGcashCentavos"), remarks: form.get("remarks") ?? "" });
  if (!parsed.success) return NextResponse.json({ error: "Enter the opening amounts, the cash count and the GCash balance." }, { status: 400 });
  let counts: Record<number, number> = {};
  try { const raw = JSON.parse(String(form.get("counts") ?? "{}")) as Record<string, unknown>; counts = Object.fromEntries(BILLS.map((b) => [b, Math.max(0, Math.floor(Number(raw[b]) || 0))])); }
  catch { return NextResponse.json({ error: "The cash count could not be read." }, { status: 400 }); }
  const db = createSupabaseAdminClient(), body = parsed.data;

  // Today's recorded opening wins over what was typed, so the expected amounts match the morning record.
  const { data: open } = await db.from("cashier_openings").select("opening_cash_centavos,opening_gcash_centavos").eq("cashier_id", staff.user.id).eq("opening_date", date).maybeSingle();
  const opening = { cash: open ? Number(open.opening_cash_centavos) : body.openingCashCentavos, gcash: open?.opening_gcash_centavos != null ? Number(open.opening_gcash_centavos) : body.openingGcashCentavos };
  const f = await dayFigures(db, date, opening);
  const counted = countedCentavos(counts), check = closingCheck(f, counted, body.actualGcashCentavos);
  if (check.needsRemarks && body.remarks.length < 3) return NextResponse.json({ error: "Explain the variance in the remarks." }, { status: 400 });

  let shot: string | null = null;
  const file = form.get("screenshot");
  if (file instanceof File && file.size) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const jpg = bytes[0] === 0xff && bytes[1] === 0xd8, png = bytes[0] === 0x89 && bytes[1] === 0x50;
    if (!(jpg || png) || bytes.length > 10 * 1024 * 1024) return NextResponse.json({ error: "The screenshot must be a JPEG or PNG up to 10 MB." }, { status: 400 });
    try { shot = (await fileInDrive(db, { rootKey: "closings", rootName: "NWMTACI Cashier Closings", folders: [{ key: `closings/${date.slice(0, 7)}`, name: date.slice(0, 7) }], base: `${date} GCash balance`, ext: jpg ? "jpg" : "png", mime: jpg ? "image/jpeg" : "image/png", bytes })).link; }
    catch (e) { console.error("Closing screenshot Drive filing failed:", e instanceof Error ? e.message : e); }
  }
  const row = {
    cashier_id: staff.user.id, closing_date: date, opening_cash_centavos: opening.cash, cash_collections_centavos: f.cashIn, online_collections_centavos: f.online, refunds_centavos: 0,
    expenses_centavos: f.cashExpenses, expected_cash_centavos: check.cash, actual_cash_centavos: counted, variance_centavos: check.cashVariance,
    status: "Submitted", submitted_at: new Date().toISOString(), remarks: body.remarks || null,
  };
  const extra = {
    cash_expenses_centavos: f.cashExpenses, bank_deposits_centavos: f.deposits, denominations: counts,
    opening_gcash_centavos: opening.gcash, gcash_collections_centavos: f.gcashIn, gcash_expenses_centavos: f.gcashExpenses, expected_gcash_centavos: check.gcash,
    actual_gcash_centavos: body.actualGcashCentavos, gcash_variance_centavos: check.gcashVariance, gcash_screenshot_link: shot,
  };
  const { data: saved, error } = await db.from("cashier_closings").insert({ ...row, ...extra }).select("id").single();
  if (error) return NextResponse.json({ error: /duplicate|unique/i.test(error.message) ? "Today's closing is already submitted." : /column/i.test(error.message) ? "Apply database update 202611110099 first." : error.message }, { status: 400 });
  await db.from("audit_logs").insert({ actor_id: staff.user.id, actor_role: staff.roleCodes.includes("cashier") ? "cashier" : staff.roleCodes[0], action: "cashier.closed", record_type: "cashier_closing", record_id: saved.id, new_values: { ...row, ...extra } });
  return NextResponse.json({ ok: true, cashVariance: check.cashVariance, gcashVariance: check.gcashVariance });
}
