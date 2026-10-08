import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createDailyExpensesPdf } from "@/lib/documents";

export const runtime = "nodejs";

/**
 * Expense summary PDF for a date range (owner, 7 Oct 2026): approved and
 * released vouchers between ?from and ?to (Manila dates), with totals per
 * payment channel. Cashier / Accounting / Admin; every export is audited.
 */
export async function GET(request: Request) {
  const staff = await requireStaff();
  if (!staff || !staff.roleCodes.some((role) => ["admin", "cashier", "accounting"].includes(role))) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  const url = new URL(request.url);
  const from = url.searchParams.get("from") ?? "", to = url.searchParams.get("to") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return NextResponse.json({ error: "Choose a valid start and end date." }, { status: 400 });

  const db = createSupabaseAdminClient();
  const start = `${from}T00:00:00+08:00`, end = `${to}T23:59:59.999+08:00`;
  const { data: base } = await db.from("expenses").select("id,expense_number,payee,category,amount_centavos,status,created_at")
    .in("status", ["Approved", "Paid"]).gte("created_at", start).lte("created_at", end).order("created_at", { ascending: true }).limit(5000);
  const rowsBase = base ?? [];
  const extra = new Map<string, { payment_channel?: string | null; reference_number?: string | null }>();
  if (rowsBase.length) { const { data } = await db.from("expenses").select("id,payment_channel,reference_number").in("id", rowsBase.map((r) => r.id)); for (const r of data ?? []) extra.set((r as { id: string }).id, r); }
  const rows = rowsBase.map((e) => ({ number: e.expense_number, payee: e.payee, category: e.category, status: e.status === "Paid" ? "Released" : "Approved", channel: extra.get(e.id)?.payment_channel ?? "", reference: extra.get(e.id)?.reference_number ?? "", amountCentavos: Number(e.amount_centavos) }));
  const byChannel = new Map<string, { count: number; total: number }>();
  for (const r of rows) { const k = r.channel || "Not set"; const c = byChannel.get(k) ?? { count: 0, total: 0 }; c.count += 1; c.total += r.amountCentavos; byChannel.set(k, c); }
  const fmt = (d: string) => new Intl.DateTimeFormat("en-PH", { month: "long", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(`${d}T00:00:00+08:00`));
  const { data: profile } = await db.from("profiles").select("complete_name").eq("id", staff.user.id).maybeSingle();
  let logoBytes: Uint8Array | undefined;
  try { logoBytes = new Uint8Array(await readFile(path.join(process.cwd(), "public", "new-wave-emblem.png"))); } catch { logoBytes = undefined; }

  const bytes = await createDailyExpensesPdf({
    title: "Expense Summary", dateLabel: from === to ? fmt(from) : `${fmt(from)} to ${fmt(to)}`, rows,
    totalCentavos: rows.reduce((s, r) => s + r.amountCentavos, 0),
    paidCentavos: rowsBase.filter((e) => e.status === "Paid").reduce((s, e) => s + Number(e.amount_centavos), 0),
    channelTotals: [...byChannel].map(([channel, c]) => ({ channel, count: c.count, totalCentavos: c.total })).sort((a, b) => b.totalCentavos - a.totalCentavos),
    preparedBy: profile?.complete_name ?? staff.user.email ?? "", logoBytes,
  });
  await db.from("audit_logs").insert({ actor_id: staff.user.id, actor_role: staff.roleCodes[0] ?? "staff", action: "report.exported", record_type: "expense_summary", record_id: `${from}_${to}`, new_values: { from, to, rows: rows.length } });
  return new Response(bytes as BodyInit, { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="expense-summary-${from}-to-${to}.pdf"`, "cache-control": "private, no-store" } });
}
