import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createDailyExpensesPdf } from "@/lib/documents";

export const runtime = "nodejs";

/** Daily expenses summary PDF for a Manila calendar day. Cashier / Accounting / Admin. */
export async function GET(request: Request) {
  const staff = await requireStaff();
  if (!staff || !staff.roleCodes.some((role) => ["admin", "cashier", "accounting"].includes(role))) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  const date = new URL(request.url).searchParams.get("date") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "A valid ?date=YYYY-MM-DD is required." }, { status: 400 });

  const db = createSupabaseAdminClient();
  const start = `${date}T00:00:00+08:00`, end = `${date}T23:59:59.999+08:00`;
  const { data: base } = await db.from("expenses")
    .select("id,expense_number,payee,category,amount_centavos,status,created_at")
    .gte("created_at", start).lte("created_at", end).order("created_at", { ascending: true });
  const rowsBase = base ?? [];
  // Deploy-safe: payment_channel/reference_number arrive with migration 202608100001.
  const extra = new Map<string, { payment_channel?: string | null; reference_number?: string | null }>();
  { const { data } = await db.from("expenses").select("id,payment_channel,reference_number").gte("created_at", start).lte("created_at", end);
    if (data) for (const r of data) extra.set((r as { id: string }).id, r); }

  const { data: profile } = await db.from("profiles").select("complete_name").eq("id", staff.user.id).maybeSingle();

  const rows = rowsBase.map((e) => ({
    number: e.expense_number, payee: e.payee, category: e.category, status: e.status,
    channel: extra.get(e.id)?.payment_channel ?? "", reference: extra.get(e.id)?.reference_number ?? "",
    amountCentavos: Number(e.amount_centavos),
  }));
  const totalCentavos = rows.reduce((s, r) => s + r.amountCentavos, 0);
  const paidCentavos = rowsBase.filter((e) => e.status === "Paid").reduce((s, e) => s + Number(e.amount_centavos), 0);
  const dateLabel = new Intl.DateTimeFormat("en-PH", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(`${date}T00:00:00+08:00`));

  let logoBytes: Uint8Array | undefined;
  try { logoBytes = new Uint8Array(await (await fetch(new URL("/new-wave-emblem.png", request.url))).arrayBuffer()); } catch { logoBytes = undefined; }

  const bytes = await createDailyExpensesPdf({ dateLabel, rows, totalCentavos, paidCentavos, preparedBy: profile?.complete_name ?? staff.user.email ?? "", logoBytes });
  return new Response(bytes as BodyInit, { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="daily-expenses-${date}.pdf"`, "cache-control": "private, no-store" } });
}
