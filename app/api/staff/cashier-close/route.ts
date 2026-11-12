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
export async function POST(request: Request) {
  const staff = await requireStaff(["admin", "cashier", "accounting"]);
  if (!staff) return NextResponse.json({ error: "Your account cannot submit a cashier closing." }, { status: 403 });
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
